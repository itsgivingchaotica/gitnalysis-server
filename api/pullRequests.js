const router = require("express").Router();
const octokitMain = require("../services/octokit");
const authenticateUser = require("../middleware/auth");
const { paginateLimited, getRepoCounts } = require("../services/github");

// mounted on: /api/pull-requests

// get the most recent pull requests for a repo (capped at 300)
router.get("/:owner/:repo", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);
    const pullRequests = await paginateLimited(
      octokit,
      "GET /repos/{owner}/{repo}/pulls",
      { owner, repo },
      3
    );
    res.json({ pullRequests });
  } catch (error) {
    console.log("Error fetching pull requests", error.message);
    next(error);
  }
});

// get number of pull requests (open, closed, all) linked to repository
// ex: { pullRequests: { numOpen: 3, numClosed: 5, numAll: 8 } }
router.get("/:owner/:repo/count/getNum", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);
    const counts = await getRepoCounts(req, octokit, owner, repo);
    res.json({
      pullRequests: {
        numOpen: counts.openPRs,
        numClosed: counts.closedPRs,
        numAll: counts.allPRs,
      },
    });
  } catch (error) {
    console.log("Error in retrieving num of pull requests", error.message);
    next(error);
  }
});

// get merge success rate
router.get("/merge-success-rate/:owner/:repo", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);
    const counts = await getRepoCounts(req, octokit, owner, repo);

    const totalPullRequests = counts.allPRs;
    const successfullyMergedPRs = counts.mergedPRs;
    const mergeSuccessRate =
      totalPullRequests > 0 ? (successfullyMergedPRs / totalPullRequests) * 100 : 0;

    res.json({
      successfullyMergedPRs,
      totalPullRequests,
      mergeSuccessRate: mergeSuccessRate.toFixed(2),
    });
  } catch (error) {
    console.error("Error in merge success rate:", error.message);
    next(error);
  }
});

module.exports = router;
