const router = require("express").Router();
const octokitMain = require("../services/octokit");
const authenticateUser = require("../middleware/auth");
const { cached, userKey, getRepoCounts } = require("../services/github");
// mounted on : /api/branches

// get the 100 most recently updated branches, newest first
// ex response
// "branches": [
//     {
//         "name": "cookie-dev",
//         "commitDate": "2023-08-21T01:01:55Z",
//         "commitDateNoTime": "2023-08-21"
//     }, ...
// ]
//
// One GraphQL call instead of one REST call per branch.
router.get("/:owner/:repo", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);

    const branches = await cached(userKey(req, "branches", owner, repo), async () => {
      const { repository } = await octokit.graphql(
        `query ($owner: String!, $name: String!) {
          repository(owner: $owner, name: $name) {
            refs(refPrefix: "refs/heads/", first: 100,
                 orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) {
              nodes {
                name
                target { ... on Commit { committedDate } }
              }
            }
          }
        }`,
        { owner, name: repo }
      );
      return repository.refs.nodes
        .filter((ref) => ref.target && ref.target.committedDate)
        .map((ref) => ({
          name: ref.name,
          commitDate: ref.target.committedDate,
          commitDateNoTime: ref.target.committedDate.split("T")[0],
        }))
        .sort((a, b) => new Date(b.commitDate) - new Date(a.commitDate));
    });

    res.json({ branches });
  } catch (error) {
    console.log("Error in retrieving branches", error.message);
    next(error);
  }
});

// get number of branches linked to a repo
router.get("/count/:owner/:repo", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);
    const counts = await getRepoCounts(req, octokit, owner, repo);
    res.json({ branches: counts.branches });
  } catch (error) {
    console.log("Error in retrieving num of branches", error.message);
    next(error);
  }
});

// get all data for an individual branch linked to a repo
router.get("/singleBranch/:owner/:repo/:branch", authenticateUser, async (req, res, next) => {
  try {
    const { owner, repo, branch } = req.params;
    const octokit = octokitMain(req.user.githubAccessToken);
    const response = await octokit.request("GET /repos/{owner}/{repo}/branches/{branch}", {
      owner,
      repo,
      branch,
    });
    res.json({ branch: response.data });
  } catch (error) {
    console.log("Error in single branch route", error.message);
    next(error);
  }
});

module.exports = router;
