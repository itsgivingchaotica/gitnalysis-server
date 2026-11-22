const router = require("express").Router();
const octokitMain = require("../services/octokit");
const authenticateUser = require("../middleware/auth");
const { paginateLimited, getRepoCounts, cached, userKey, daysForRange } = require("../services/github");

// mounted on: /api/commits

// get the most recent commits to a repo (capped at 300)
router.get("/:owner/:repo", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);
    const commits = await paginateLimited(
      octokit,
      "GET /repos/{owner}/{repo}/commits",
      { owner, repo },
      3
    );
    res.json(commits);
  } catch (error) {
    console.log("Error in commits route", error.message);
    next(error);
  }
});

// get total num of commits on the default branch and commits in the last 24h
router.get("/count/:owner/:repo", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);
    const counts = await getRepoCounts(req, octokit, owner, repo);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const todaysCommits = await paginateLimited(
      octokit,
      "GET /repos/{owner}/{repo}/commits",
      { owner, repo, since: yesterday.toISOString() },
      2
    );

    res.json({
      commits: counts.commits,
      todaysCommits: todaysCommits.length,
    });
  } catch (error) {
    // an empty repo makes GitHub return 409 - treat it as "no commits"
    if (error.status === 409) return res.json({ commits: 0, todaysCommits: 0 });
    console.log("Error in commit count route", error.message);
    next(error);
  }
});

// number of commits per day over a time range (pastDay/pastWeek/pastMonth/pastYear)
router.get("/timeline/:owner/:repo/:timeRange", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo, timeRange } = req.params;
    const daysAgo = daysForRange(timeRange);
    const octokit = octokitMain(req.user.githubAccessToken);

    const result = await cached(userKey(req, "commit-timeline", owner, repo, timeRange), async () => {
      const since = new Date();
      since.setDate(since.getDate() - daysAgo);

      // up to 1,000 commits in the range is plenty for a chart
      const commits = await paginateLimited(
        octokit,
        "GET /repos/{owner}/{repo}/commits",
        { owner, repo, since: since.toISOString() },
        10
      );

      const commitsByDate = {};
      for (const commit of commits) {
        const key = new Date(commit.commit.author.date).toISOString().split("T")[0];
        commitsByDate[key] = (commitsByDate[key] || 0) + 1;
      }
      return commitsByDate;
    });

    res.json(result);
  } catch (error) {
    // an empty repo makes GitHub return 409 - treat it as "no commits"
    if (error.status === 409) return res.json({});
    console.log("Error in commit timeline route", error.message);
    next(error);
  }
});

module.exports = router;
