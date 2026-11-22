const router = require("express").Router();
const octokitMain = require("../services/octokit");
const authenticateUser = require("../middleware/auth");
const { getRepoCounts, cached, userKey, daysForRange } = require("../services/github");

// mounted on: /api/deployments
//
// Many repos (express included) never use GitHub Deployments. Every route here
// returns a normal 200 response with null / 0 values in that case instead of
// an error, so the dashboard can show "No deployments".

// The 100 most recent deployments with their statuses, in one GraphQL call.
function getRecentDeployments(req, octokit, owner, repo) {
  return cached(userKey(req, "deployments", owner, repo), async () => {
    const { repository } = await octokit.graphql(
      `query ($owner: String!, $name: String!) {
        repository(owner: $owner, name: $name) {
          deployments(last: 100) {
            nodes {
              createdAt
              statuses(first: 20) { nodes { state createdAt } }
            }
          }
        }
      }`,
      { owner, name: repo }
    );
    return repository.deployments.nodes
      .map((d) => ({
        createdAt: d.createdAt,
        statuses: d.statuses.nodes
          .map((s) => ({ state: s.state.toLowerCase(), createdAt: s.createdAt }))
          .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
      }))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  });
}

const isFailure = (state) => state === "failure" || state === "error";

// get the total number of deployments linked to a repo
router.get("/:owner/:repo/count/getNum", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);
    const counts = await getRepoCounts(req, octokit, owner, repo);
    res.json({ numDeployments: counts.deployments });
  } catch (error) {
    console.log("Error in retrieving num of deployments", error.message);
    next(error);
  }
});

// number of deployments over a time range (pastDay/pastWeek/pastMonth/pastYear)
router.get(
  "/:owner/:repo/deploymentFrequency/:timeRange",
  authenticateUser,
  async (req, res, next) => {
    try {
      const { owner, repo, timeRange } = req.params;
      const daysAgo = daysForRange(timeRange);
      const octokit = octokitMain(req.user.githubAccessToken);
      const deployments = await getRecentDeployments(req, octokit, owner, repo);

      const toDate = new Date();
      const fromDate = new Date();
      fromDate.setDate(toDate.getDate() - daysAgo);

      const inRange = deployments.filter((d) => {
        const created = new Date(d.createdAt);
        return created >= fromDate && created <= toDate;
      });

      const deploymentsPerDayObject = {};
      for (const d of inRange) {
        const day = d.createdAt.split("T")[0];
        deploymentsPerDayObject[day] = (deploymentsPerDayObject[day] || 0) + 1;
      }

      res.json({
        numDeploymentsInRange: inRange.length,
        deploymentFrequency: inRange.length / daysAgo,
        deploymentsPerDayObject,
        fromDate,
        toDate,
      });
    } catch (error) {
      console.log("Error in retrieving deployment frequency", error.message);
      next(error);
    }
  }
);

// Change Failure Rate: % of recent deployments that had a failed status.
// Returns a number (e.g. 12.5), or null if the repo has no deployments.
router.get("/:owner/:repo/cfr", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);
    const deployments = await getRecentDeployments(req, octokit, owner, repo);

    if (deployments.length === 0) return res.json(null);

    const failed = deployments.filter((d) => d.statuses.some((s) => isFailure(s.state)));
    res.json(parseFloat(((failed.length / deployments.length) * 100).toFixed(2)));
  } catch (error) {
    console.log("Error calculating CFR", error.message);
    next(error);
  }
});

// Mean Time To Recovery: average time between a failed deployment status and
// the next successful one. { mttr: hours } or { mttr: null, message } if there
// is nothing to measure.
router.get("/:owner/:repo/mttr", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);
    const deployments = await getRecentDeployments(req, octokit, owner, repo);

    if (deployments.length === 0) {
      return res.json({ mttr: null, message: "No deployments found." });
    }

    const allStatuses = deployments.flatMap((d) => d.statuses);
    const recoveryTimes = [];
    for (let i = 0; i < allStatuses.length - 1; i++) {
      if (isFailure(allStatuses[i].state) && allStatuses[i + 1].state === "success") {
        recoveryTimes.push(
          new Date(allStatuses[i + 1].createdAt) - new Date(allStatuses[i].createdAt)
        );
      }
    }

    if (recoveryTimes.length === 0) {
      return res.json({ mttr: null, message: "No failures to recover from." });
    }

    const avg = recoveryTimes.reduce((a, b) => a + b, 0) / recoveryTimes.length;
    res.json({ mttr: parseFloat((avg / (1000 * 60 * 60)).toFixed(2)) });
  } catch (error) {
    console.error("Error calculating MTTR", error.message);
    next(error);
  }
});

module.exports = router;
