const router = require("express").Router();
const octokitMain = require("../services/octokit");
const authenticate = require("../middleware/auth");
const { paginateLimited, cached, userKey } = require("../services/github");

// mounted on: /api/lead_time
//
// Lead time is calculated from the 300 most recently closed PRs, not the
// repo's entire history.

function getRecentMergedPRs(req, octokit, owner, repo) {
  return cached(userKey(req, "merged-prs", owner, repo), async () => {
    const closed = await paginateLimited(
      octokit,
      "GET /repos/{owner}/{repo}/pulls",
      { owner, repo, state: "closed", sort: "updated", direction: "desc" },
      3
    );
    return closed
      .filter((pr) => pr.merged_at)
      .map((pr) => ({ created_at: pr.created_at, merged_at: pr.merged_at }))
      .sort((a, b) => new Date(b.merged_at) - new Date(a.merged_at)); // newest first
  });
}

router.get("/:owner/:repo", authenticate, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);
    const merged = await getRecentMergedPRs(req, octokit, owner, repo);

    if (merged.length === 0) {
      return res.json({ average_lead_time: "No merged PRs" });
    }
    const sum = merged.reduce(
      (acc, pr) => acc + (new Date(pr.merged_at) - new Date(pr.created_at)),
      0
    );
    res.json({ average_lead_time: formatMilliseconds(sum / merged.length) });
  } catch (error) {
    console.log("Error in lead_time route", error.message);
    next(error);
  }
});

router.get("/running_average/:owner/:repo", authenticate, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);
    const merged = await getRecentMergedPRs(req, octokit, owner, repo);

    // walk oldest -> newest, then return newest first (same shape as before)
    let sum = 0;
    const running_average = [];
    for (let i = merged.length - 1, count = 1; i >= 0; i--, count++) {
      const pr = merged[i];
      const merged_at = new Date(pr.merged_at);
      sum += merged_at - new Date(pr.created_at);
      running_average.push({ merged_at, average: formatMilliseconds(sum / count) });
    }
    res.json(running_average.reverse());
  } catch (error) {
    console.log("Error in lead_time/running_average route", error.message);
    next(error);
  }
});

function formatMilliseconds(milliseconds) {
  const day = 24 * 60 * 60 * 1000;
  const hour = 60 * 60 * 1000;
  const minute = 60 * 1000;

  const days = Math.floor(milliseconds / day);
  milliseconds %= day;
  const hours = Math.floor(milliseconds / hour);
  milliseconds %= hour;
  const minutes = Math.floor(milliseconds / minute);
  milliseconds %= minute;
  const seconds = Math.floor(milliseconds / 1000);

  const parts = [];
  if (days > 0) parts.push(`${days} days`);
  if (hours > 0) parts.push(`${hours} hours`);
  if (minutes > 0) parts.push(`${minutes} minutes`);
  if (seconds > 0) parts.push(`${seconds} seconds`);
  return parts.join(", ") || "0 seconds";
}

module.exports = router;
