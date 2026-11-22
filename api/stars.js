const router = require("express").Router();
const octokitMain = require("../services/octokit");
const authenticateUser = require("../middleware/auth");
const { cached, userKey, paginateLimited } = require("../services/github");

// mounted on : /api/stars

// get the 50 most recent stargazers of a repo, plus the total count.
// (GitHub won't let you page through all stargazers of a popular repo.)
router.get("/:owner/:repo/stargazers", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);

    const result = await cached(userKey(req, "stargazers", owner, repo), async () => {
      const { repository } = await octokit.graphql(
        `query ($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            stargazers(first: 50, orderBy: { field: STARRED_AT, direction: DESC }) {
              totalCount
              nodes { login avatarUrl url }
            }
          }
        }`,
        { owner, name: repo }
      );
      return {
        count: repository.stargazers.totalCount,
        stargazers: repository.stargazers.nodes.map((s) => ({
          username: s.login,
          avatarUrl: s.avatarUrl,
          profileUrl: s.url,
        })),
      };
    });

    res.json(result);
  } catch (error) {
    console.log("Error in repo stargazers", error.message);
    next(error);
  }
});

// get the authenticated user's starred repos (capped at 500)
router.get("/me/starred", authenticateUser, async (req, res, next) => {
  try {
    const octokit = octokitMain(req.user.githubAccessToken);
    const starred = await paginateLimited(octokit, "GET /user/starred", {}, 5);
    res.json({
      starredRepos: starred.map((starredRepo) => ({
        name: starredRepo.name,
        full_name: starredRepo.full_name,
        url: starredRepo.url,
        owner: starredRepo.owner.login,
        ownerAvatarUrl: starredRepo.owner.avatar_url,
        ownerProfileUrl: starredRepo.owner.url,
      })),
    });
  } catch (error) {
    console.log("Error in starred repos", error.message);
    next(error);
  }
});

module.exports = router;
