const router = require("express").Router();
const octokitMain = require("../services/octokit");
const authenticateUser = require("../middleware/auth");
const { calcTimeAgo } = require("../services/helperFunctions");
const { paginateLimited, getRepoCounts } = require("../services/github");

// mounted on: /api/forks
//
// Returns the 100 newest forks plus the repo's real total in `count`.

async function getNewestForks(octokit, owner, repo) {
  return paginateLimited(
    octokit,
    "GET /repos/{owner}/{repo}/forks",
    { owner, repo, sort: "newest" },
    1
  );
}

router.get("/:owner/:repo", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);
    const [forks, counts] = await Promise.all([
      getNewestForks(octokit, owner, repo),
      getRepoCounts(req, octokit, owner, repo),
    ]);
    res.json({ forks, count: counts.forks });
  } catch (error) {
    console.log("Error in retrieving forks", error.message);
    next(error);
  }
});

router.get("/:owner/:repo/personalized", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);
    const [forks, counts] = await Promise.all([
      getNewestForks(octokit, owner, repo),
      getRepoCounts(req, octokit, owner, repo),
    ]);

    res.json({
      count: counts.forks,
      forks: forks.map((fork) => ({
        forkedRepoName: fork.name,
        forkedFullRepoName: fork.full_name,
        forkedRepoUrl: fork.url,
        forkerName: fork.owner.login,
        forkerVisitGithubUrl: fork.owner.url,
        forkerAvatar: fork.owner.avatar_url,
        forkedtime: fork.created_at,
        forkedTimeAgo: calcTimeAgo(new Date(fork.created_at)),
      })),
    });
  } catch (error) {
    console.log("Error in retrieving forks", error.message);
    next(error);
  }
});

module.exports = router;
