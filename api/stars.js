const router = require("express").Router();
const octokitMain = require("../services/octokit");
const authenticateUser = require("../middleware/auth");
const { cached, userKey, paginateLimited } = require("../services/github");

// mounted on : /api/stars

// get the 50 most recent stargazers of a repo, plus the total count.
// GitHub hides the stargazer list for most repos the user doesn't own (the
// list comes back empty with totalCount 0), so the total comes from
// stargazerCount, which is always available. `stargazers` may be [].
router.get("/:owner/:repo/stargazers", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);

    const result = await cached(userKey(req, "stargazers", owner, repo), async () => {
      const { repository } = await octokit.graphql(
        `query ($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            stargazerCount
            stargazers(first: 50, orderBy: { field: STARRED_AT, direction: DESC }) {
              nodes { login avatarUrl url }
            }
          }
        }`,
        { owner, name: repo }
      );
      return {
        count: repository.stargazerCount,
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
