const router = require("express").Router();
const octokitMain = require("../services/octokit");
const authenticateUser = require("../middleware/auth");
const { paginateLimited, cached, userKey } = require("../services/github");

// mounted on: /api/collaborators
//
// GitHub only shows a repo's collaborators to people with push access. For any
// other repo we fall back to its public contributors list, and say so in
// `source` so the frontend can label it correctly.

function getPeople(req, owner, repo) {
  return cached(userKey(req, "collaborators", owner, repo), async () => {
    const octokit = octokitMain(req.user.githubAccessToken);
    try {
      const collaborators = await paginateLimited(
        octokit,
        "GET /repos/{owner}/{repo}/collaborators",
        { owner, repo },
        3
      );
      return { source: "collaborators", collaborators };
    } catch (error) {
      if (error.status !== 403 && error.status !== 404) throw error;
      const contributors = await paginateLimited(
        octokit,
        "GET /repos/{owner}/{repo}/contributors",
        { owner, repo },
        1
      );
      return { source: "contributors", collaborators: contributors };
    }
  });
}

// get collaborators (or contributors) for a given repo
router.get("/:owner/:repo", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    res.json(await getPeople(req, owner, repo));
  } catch (error) {
    console.log("Error in retrieving collaborators", error.message);
    next(error);
  }
});

// get number of collaborators (or contributors) for a given repo
router.get("/count/:owner/:repo", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    const { source, collaborators } = await getPeople(req, owner, repo);
    res.json({ source, numCollaborators: collaborators.length });
  } catch (error) {
    console.log("Error in retrieving num of collaborators", error.message);
    next(error);
  }
});

module.exports = router;
