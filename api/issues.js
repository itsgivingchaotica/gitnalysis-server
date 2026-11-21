const router = require("express").Router();
const octokitMain = require("../services/octokit");
const authenticateUser = require("../middleware/auth");
const { paginateLimited, getRepoCounts, cached, userKey } = require("../services/github");

// mounted on: /api/issues
//
// Note: GitHub's REST /issues endpoint also returns pull requests. These routes
// count real issues only.

// get number of issues linked to repository
// ex: { issues: { numOpen: 3, numClosed: 5, numAll: 8 } }
router.get("/:owner/:repo/count/getNum", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);
    const counts = await getRepoCounts(req, octokit, owner, repo);
    res.json({
      issues: {
        numOpen: counts.openIssues,
        numClosed: counts.closedIssues,
        numAll: counts.openIssues + counts.closedIssues,
      },
    });
  } catch (error) {
    console.log("Error in retrieving num of issues", error.message);
    next(error);
  }
});

// Timeline of how many issues were open / closed at each point in the past.
//
// Instead of downloading every issue the repo ever had, start from today's
// totals and "rewind" using only the issues that changed during the period
// (GitHub's `since` filter returns issues updated after a date, which includes
// every issue created or closed in that window).
const TIMELINES = {
  pastWeek: { buckets: 8, stepDays: 1, label: "days" },
  pastMonth: { buckets: 5, stepDays: 7, label: "weeks" },
  pastYear: { buckets: 13, stepDays: 30, label: "months" },
};

router.get("/:owner/:repo/timeline/:timeRange", authenticateUser, async (req, res, next) => {
  const config = TIMELINES[req.params.timeRange];
  if (!config) return next(); // fall through to /:owner/:repo/:state etc.

  try {
    const { owner, repo, timeRange } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);

    const result = await cached(userKey(req, "issues-timeline", owner, repo, timeRange), async () => {
      const counts = await getRepoCounts(req, octokit, owner, repo);

      const now = new Date();
      const bucketDates = [];
      for (let i = 0; i < config.buckets; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i * config.stepDays);
        bucketDates.push(d);
      }
      const earliest = bucketDates[bucketDates.length - 1];

      const changed = (
        await paginateLimited(
          octokit,
          "GET /repos/{owner}/{repo}/issues",
          { owner, repo, state: "all", since: earliest.toISOString() },
          10
        )
      ).filter((issue) => !issue.pull_request);

      const result = {};
      bucketDates.forEach((date, i) => {
        let open = counts.openIssues;
        let closed = counts.closedIssues;

        for (const issue of changed) {
          const created = new Date(issue.created_at);
          const closedAt = issue.closed_at ? new Date(issue.closed_at) : null;

          // remove the issue from today's totals...
          if (issue.state === "closed") closed--;
          else open--;

          // ...and add it back as it was at `date`
          if (created <= date) {
            if (closedAt && closedAt <= date) closed++;
            else open++;
          }
        }

        open = Math.max(open, 0);
        closed = Math.max(closed, 0);
        result[`${i} ${config.label} ago`] = { open, closed, all: open + closed };
      });
      return result;
    });

    res.json(result);
  } catch (error) {
    console.log("Error in retrieving issue timeline", error.message);
    next(error);
  }
});

// get the most recent issues (capped at 300) --> state = open, closed, OR all
router.get("/:owner/:repo/:state", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo, state } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);
    const issues = await paginateLimited(
      octokit,
      "GET /repos/{owner}/{repo}/issues",
      { owner, repo, state },
      3
    );
    res.json({ issues: issues.filter((issue) => !issue.pull_request) });
  } catch (error) {
    console.log("Error in retrieving issues", error.message);
    next(error);
  }
});

router.get("/:owner/:repo/events/getEvents", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);
    const allEvents = await paginateLimited(
      octokit,
      "GET /repos/{owner}/{repo}/issues/events",
      { owner, repo },
      3
    );
    res.json({ allEvents });
  } catch (error) {
    console.log("Error in retrieving events", error.message);
    next(error);
  }
});

module.exports = router;
