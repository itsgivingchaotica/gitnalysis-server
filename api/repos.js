const router = require("express").Router();
const octokitMain = require("../services/octokit");
const authenticateUser = require("../middleware/auth");
const { calcTimeAgo } = require("../services/helperFunctions");
const { Repo } = require("../db/models");
const { User } = require("../db/models");
const { paginateLimited, cached, userKey, mapLimit } = require("../services/github");

// mounted on : http://localhost:8080/api/repos

//get a repository
router.get(
  "/:owner/:repo/getRepo",
  authenticateUser,
  async (req, res, next) => {
    console.log("hit get repo");
    try {
      const { owner, repo } = req.params;
      console.log(repo, "IS THE REPO");
      console.log(owner); //105296511

      const cachedData = await Repo.findOne({ where: { repoName: repo } });
      console.log("tried to access cachedData");
      if (cachedData) {
        console.log("CACHED DATA");
        const lastUpdated = new Date(cachedData.updatedAt);
        if (Date.now() - lastUpdated < 3600000) {
          res.json(cachedData);
          console.log(cachedData);
          return;
        } else {
          const octokit = octokitMain(req.user.githubAccessToken);
          const response = await octokit.request("GET /repos/:owner/:repo", {
            owner,
            repo,
          });
          const repoData = response.data;
          console.log(repoData, "LOOKING FOR REPO DATA");

          await cachedData.update({
            name: repoData.name,
            full_name: repoData.full_name,
            url: repoData.html_url,
            stargazers: repoData.stargazer_count,
          });
          console.log(cachedData);
          res.json({
            repoData,
          });
        }
      } else {
        console.log("create new row");
        const octokit = octokitMain(req.user.githubAccessToken);
        const response = await octokit.request("GET /repos/:owner/:repo", {
          owner,
          repo,
        });
        const repoData = response.data;
        console.log(repoData, "NEW DATA");
        const cachedUser = await User.findOne({
          where: { githubID: repoData.owner.id },
        });
        if (!cachedUser) {
          await User.create({
            githubID: repoData.owner.id,
            username: repoData.owner.login,
            profilePhoto: repoData.owner.avatar_url,
          });
        }
        await Repo.create({
          repoId: repoData.id,
          name: repoData.name,
          full_name: repoData.full_name,
          url: repoData.html_url,
          id: repoData.owner.id,
          stargazers: repoData.stargazer_count,
        });
        res.json({
          repoData,
        });
      }
    } catch (error) {
      console.error("Error in /getRepo:", error);
      res.status(500).json({ error: "Internal Service Error" });
    }
  }
);

//get a repository created, updated, pushed dates & timeAgo
// ex. response
// {
//   "repoDates": {
//       "createdAt": "2023-08-09",
//       "updatedAt": "2023-08-20",
//       "pushedAt": "2023-08-21",
//       "createdTimeAgo": "12 days ago",
//       "updatedTimeAgo": "20 hours ago",
//       "pushedTimeAgo": "9 hours ago"
//   }
// }
router.get(
  "/:owner/:repo/getRepo/dates",
  authenticateUser,
  async (req, res, next) => {
    try {
      const { owner, repo } = req.params;
      const octokit = octokitMain(req.user.githubAccessToken);
      const response = await octokit.request("GET /repos/:owner/:repo", {
        owner,
        repo,
      });
      const repoData = response.data;

      res.json({
        repoDates: {
          createdAt: repoData.created_at.split("T")[0],
          updatedAt: repoData.updated_at.split("T")[0],
          pushedAt: repoData.pushed_at.split("T")[0],
          createdTimeAgo: calcTimeAgo(new Date(repoData.created_at)),
          updatedTimeAgo: calcTimeAgo(new Date(repoData.updated_at)),
          pushedTimeAgo: calcTimeAgo(new Date(repoData.pushed_at)),
        },
      });
    } catch (error) {
      console.log("Error in retrieving repo", error);
      next(error);
    }
  }
);

//list repository activities (notifications for speciic repository)
// ex response:
// {
//     "repoActivityArray": [
//         {
//             "activityType": "pr_merge",
//             "timeAgo": "4 hours ago",
//             "userName": "andreatranchina",
//             "userAvatar": "https://avatars.githubusercontent.com/u/105296511?v=4"
//         },
//         {
//             "activityType": "push",
//             "timeAgo": "5 hours ago",
//             "userName": "shoaibashfaq",
//             "userAvatar": "https://avatars.githubusercontent.com/u/85181888?v=4"
//         },
//         {
//             "activityType": "branch_creation",
//             "timeAgo": "16 hours ago",
//             "userName": "andreatranchina",
//             "userAvatar": "https://avatars.githubusercontent.com/u/105296511?v=4"
//         },
//         {
//             "activityType": "branch_deletion",
//             "timeAgo": "22 hours ago",
//             "userName": "shoaibashfaq",
//             "userAvatar": "https://avatars.githubusercontent.com/u/85181888?v=4"
//         },
//     ]
// }
router.get(
  "/:owner/:repo/getActivity/:timePeriod",
  authenticateUser,
  async (req, res, next) => {
    //NOTE timePeriod param should be = "day" or "week" or "month" or "quarter" or "year"
    try {
      const { owner, repo, timePeriod } = req.params;
      const octokit = octokitMain(req.user.githubAccessToken);
      // capped at 1,000 events so huge repos don't exhaust memory
      const repoActivityData = await paginateLimited(
        octokit,
        "GET /repos/{owner}/{repo}/activity",
        { owner, repo, time_period: timePeriod },
        10
      );

      let repoActivityArray = [];

      for (const repoActivity of repoActivityData) {
        const timeAgo = calcTimeAgo(new Date(repoActivity.timestamp));

        repoActivityArray.push({
          activityType: repoActivity.activity_type,
          activityTime: repoActivity.timestamp,
          timeAgo: timeAgo,
          userName: repoActivity.actor.login,
          userAvatar: repoActivity.actor.avatar_url,
        });
      }

      if (timePeriod === "month") {
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(toDate.getDate() - 7);

        const activitiesPerWeekObject = {
          "0 weeks ago": 0,
          "1 weeks ago": 0,
          "2 weeks ago": 0,
          "3 weeks ago": 0,
        };
        let weeksAgo = 0;

        while (weeksAgo <= 3) {
          repoActivityArray.map((activity) => {
            const activityDate = new Date(activity.activityTime);
            if (activityDate <= toDate && activityDate >= fromDate) {
              activitiesPerWeekObject[`${weeksAgo} weeks ago`]++;
            }
          }); //end map

          weeksAgo++;
          toDate.setDate(toDate.getDate() - 7);
          fromDate.setDate(fromDate.getDate() - 7);
        }

        res.json({
          repoActivityArray,
          activitiesTimelineChartObject: activitiesPerWeekObject,
        });
      } else if (timePeriod === "week") {
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(toDate.getDate() - 1);

        const activitiesPerDayObject = {
          "0 days ago": 0,
          "1 days ago": 0,
          "2 days ago": 0,
          "3 days ago": 0,
          "4 days ago": 0,
          "5 days ago": 0,
          "6 days ago": 0,
        };
        let daysAgo = 0;

        while (daysAgo <= 6) {
          repoActivityArray.map((activity) => {
            const activityDate = new Date(activity.activityTime);
            if (activityDate <= toDate && activityDate >= fromDate) {
              activitiesPerDayObject[`${daysAgo} days ago`]++;
            }
          }); //end map

          daysAgo++;
          toDate.setDate(toDate.getDate() - 1);
          fromDate.setDate(fromDate.getDate() - 1);
        }

        res.json({
          repoActivityArray,
          activitiesTimelineChartObject: activitiesPerDayObject,
        });
      } else if (timePeriod === "year") {
        const toDate = new Date();
        const fromDate = new Date();
        fromDate.setDate(toDate.getDate() - 30);

        const activitiesPerMonthObject = {
          "0 months ago": 0,
          "1 months ago": 0,
          "2 months ago": 0,
          "3 months ago": 0,
          "4 months ago": 0,
          "5 months ago": 0,
          "6 months ago": 0,
          "7 months ago": 0,
          "8 months ago": 0,
          "9 months ago": 0,
          "10 months ago": 0,
          "11 months ago": 0,
        };
        let monthsAgo = 0;

        while (monthsAgo <= 11) {
          repoActivityArray.map((activity) => {
            const activityDate = new Date(activity.activityTime);
            if (activityDate <= toDate && activityDate >= fromDate) {
              activitiesPerMonthObject[`${monthsAgo} months ago`]++;
            }
          }); //end map

          monthsAgo++;
          toDate.setDate(toDate.getDate() - 30);
          fromDate.setDate(fromDate.getDate() - 30);
        }

        res.json({
          repoActivityArray,
          activitiesTimelineChartObject: activitiesPerMonthObject,
        });
      } else {
        // "day" / "quarter": no chart buckets, but always respond
        res.json({ repoActivityArray, activitiesTimelineChartObject: {} });
      }
    } catch (error) {
      console.log("Error in retrieving repo activity", error);
      next(error);
    }
  }
);

/* comment-per-code ratio for a repo.
 * Lists the whole file tree in one call, then samples up to 60 source files
 * (instead of downloading every file, which burns the GitHub rate limit on big
 * repos).
 */
const CODE_FILE = /\.(js|jsx|ts|tsx|py|java|cpp|c|h|php|html|css|rb|go|rs)$/i;
const SKIP_PATH = /(^|\/)(node_modules|vendor|dist|build|coverage|\.next)\/|\.min\.js$/i;
const MAX_FILES = 60;

router.get(
  "/comments-per-code/:owner/:repo",
  authenticateUser,
  async (req, res, next) => {
    try {
      const { owner, repo } = req.params;
      const octokit = octokitMain(req.user.githubAccessToken);

      const result = await cached(userKey(req, "comments-per-code", owner, repo), async () => {
        const { data: repoData } = await octokit.request("GET /repos/{owner}/{repo}", {
          owner,
          repo,
        });
        const { data: tree } = await octokit.request(
          "GET /repos/{owner}/{repo}/git/trees/{tree_sha}",
          { owner, repo, tree_sha: repoData.default_branch, recursive: "1" }
        );

        const codeFiles = tree.tree.filter(
          (item) =>
            item.type === "blob" &&
            CODE_FILE.test(item.path) &&
            !SKIP_PATH.test(item.path) &&
            (item.size || 0) < 200000
        );
        const sample = codeFiles.slice(0, MAX_FILES);

        let linesOfCode = 0;
        let linesOfComments = 0;
        await mapLimit(sample, 6, async (file) => {
          const { data: blob } = await octokit.request(
            "GET /repos/{owner}/{repo}/git/blobs/{file_sha}",
            { owner, repo, file_sha: file.sha }
          );
          const counts = getCodeAndComments(blob.content);
          linesOfCode += counts.linesOfCode;
          linesOfComments += counts.linesOfComments;
        });

        return {
          totalLinesOfCode: linesOfCode,
          totalLinesOfComments: linesOfComments,
          commentsPerCodeRatio:
            linesOfCode > 0 ? (linesOfComments / linesOfCode).toFixed(2) : "0.00",
          filesAnalyzed: sample.length,
          totalCodeFiles: codeFiles.length,
        };
      });

      res.json(result);
    } catch (error) {
      // empty repos have no tree (409)
      if (error.status === 409) {
        return res.json({
          totalLinesOfCode: 0,
          totalLinesOfComments: 0,
          commentsPerCodeRatio: "0.00",
          filesAnalyzed: 0,
          totalCodeFiles: 0,
        });
      }
      console.error("Error in comments-per-code:", error.message);
      next(error);
    }
  }
);

// extract lines of code and lines of comments from file content
function getCodeAndComments(content) {
  // decode base64-encoded content
  const decodedContent = Buffer.from(content, "base64").toString("utf-8");
  const lines = decodedContent.split("\n");
  let linesOfCode = 0;
  let linesOfComments = 0;
  let insideCommentBlock = false;

  for (const line of lines) {
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith("//")) {
      linesOfComments++;
    }

    if (trimmedLine.startsWith("/*") || trimmedLine.startsWith("<!--")) {
      insideCommentBlock = true;
    }

    if (insideCommentBlock) {
      linesOfComments++;
    } else if (trimmedLine.length > 0 && !trimmedLine.startsWith("//")) {
      linesOfCode++;
    }

    if (trimmedLine.endsWith("*/") || trimmedLine.endsWith("-->")) {
      insideCommentBlock = false;
    }
  }

  return {
    linesOfCode: linesOfCode,
    linesOfComments: linesOfComments,
  };
}

router.get(
  "/:owner/:repo/timeline/pastMonth",
  authenticateUser,
  async (req, res, next) => {
    try {
      const { owner, repo } = req.params;
      const octokit = octokitMain(req.user.githubAccessToken);
      const responseAll = await paginateLimited(octokit, 
        "GET /repos/:owner/:repo/issues?state=all",
        {
          owner,
          repo,
          per_page: 100,
        }
      );

      const toDate = new Date();

      const issuesPerWeekObject = {
        "0 weeks ago": {},
        "1 weeks ago": {},
        "2 weeks ago": {},
        "3 weeks ago": {},
        "4 weeks ago": {},
      };
      let weeksAgo = 0;

      while (weeksAgo <= 4) {
        responseAll.map((issue) => {
          issueCreationDate = new Date(issue.created_at);

          if (issueCreationDate <= toDate) {
            if (
              issue.state === "closed" &&
              new Date(issue.closed_at) <= toDate
            ) {
              if ("closed" in issuesPerWeekObject[`${weeksAgo} weeks ago`]) {
                issuesPerWeekObject[`${weeksAgo} weeks ago`].closed++;
              } else {
                issuesPerWeekObject[`${weeksAgo} weeks ago`].closed = 1;
              }
            } else {
              if ("open" in issuesPerWeekObject[`${weeksAgo} weeks ago`]) {
                issuesPerWeekObject[`${weeksAgo} weeks ago`].open++;
              } else {
                issuesPerWeekObject[`${weeksAgo} weeks ago`].open = 1;
              }
            }
          }
        }); //end map
        issuesPerWeekObject[`${weeksAgo} weeks ago`].all =
          (issuesPerWeekObject[`${weeksAgo} weeks ago`].closed || 0) +
          (issuesPerWeekObject[`${weeksAgo} weeks ago`].open || 0);

        !issuesPerWeekObject[`${weeksAgo} weeks ago`].closed
          ? (issuesPerWeekObject[`${weeksAgo} weeks ago`].closed = 0)
          : null;

        !issuesPerWeekObject[`${weeksAgo} weeks ago`].open
          ? (issuesPerWeekObject[`${weeksAgo} weeks ago`].open = 0)
          : null;

        weeksAgo++;
        toDate.setDate(toDate.getDate() - 7);
      }

      res.json(issuesPerWeekObject);
    } catch (error) {
      console.log("Error in retrieving issue timeline", error);
      next(error);
    }
  }
);

//get timesline of issues (open/closed/all) over the past year
router.get(
  "/:owner/:repo/timeline/pastYear",
  authenticateUser,
  async (req, res, next) => {
    console.log("hit");
    try {
      const { owner, repo } = req.params;
      const octokit = octokitMain(req.user.githubAccessToken);
      const responseAll = await paginateLimited(octokit, 
        "GET /repos/:owner/:repo/issues?state=all",
        {
          owner,
          repo,
          per_page: 100,
        }
      );

      const toDate = new Date();

      const issuesPerMonthObject = {
        "0 months ago": {},
        "1 months ago": {},
        "2 months ago": {},
        "3 months ago": {},
        "4 months ago": {},
        "5 months ago": {},
        "6 months ago": {},
        "7 months ago": {},
        "8 months ago": {},
        "9 months ago": {},
        "10 months ago": {},
        "11 months ago": {},
        "12 months ago": {},
      };
      let monthsAgo = 0;

      while (monthsAgo <= 12) {
        responseAll.map((issue) => {
          issueCreationDate = new Date(issue.created_at);

          if (issueCreationDate <= toDate) {
            if (
              issue.state === "closed" &&
              new Date(issue.closed_at) <= toDate
            ) {
              if ("closed" in issuesPerMonthObject[`${monthsAgo} months ago`]) {
                issuesPerMonthObject[`${monthsAgo} months ago`].closed++;
              } else {
                issuesPerMonthObject[`${monthsAgo} months ago`].closed = 1;
              }
            } else {
              if ("open" in issuesPerMonthObject[`${monthsAgo} months ago`]) {
                issuesPerMonthObject[`${monthsAgo} months ago`].open++;
              } else {
                issuesPerMonthObject[`${monthsAgo} months ago`].open = 1;
              }
            }
          }
        }); //end map

        issuesPerMonthObject[`${monthsAgo} months ago`].all =
          (issuesPerMonthObject[`${monthsAgo} months ago`].closed || 0) +
          (issuesPerMonthObject[`${monthsAgo} months ago`].open || 0);

        !issuesPerMonthObject[`${monthsAgo} months ago`].closed
          ? (issuesPerMonthObject[`${monthsAgo} months ago`].closed = 0)
          : null;

        !issuesPerMonthObject[`${monthsAgo} months ago`].open
          ? (issuesPerMonthObject[`${monthsAgo} months ago`].open = 0)
          : null;

        monthsAgo++;
        toDate.setDate(toDate.getDate() - 30);
      }

      res.json(issuesPerMonthObject);
    } catch (error) {
      console.log("Error in retrieving issue timeline", error);
      next(error);
    }
  }
);

//get timeline of issues (open/closed/all) of issues over past week
router.get(
  "/:owner/:repo/timeline/pastWeek",
  authenticateUser,
  async (req, res, next) => {
    try {
      const { owner, repo } = req.params;
      const octokit = octokitMain(req.user.githubAccessToken);
      const responseAll = await paginateLimited(octokit, 
        "GET /repos/:owner/:repo/issues?state=all",
        {
          owner,
          repo,
          per_page: 100,
        }
      );

      const toDate = new Date();
      console.log(toDate);

      const issuesPerDayObject = {
        "0 days ago": {},
        "1 days ago": {},
        "2 days ago": {},
        "3 days ago": {},
        "4 days ago": {},
        "5 days ago": {},
        "6 days ago": {},
        "7 days ago": {},
      };

      let daysAgo = 0;

      while (daysAgo <= 7) {
        responseAll.map((issue) => {
          issueCreationDate = new Date(issue.created_at);

          if (issueCreationDate <= toDate) {
            if (
              issue.state === "closed" &&
              new Date(issue.closed_at) <= toDate
            ) {
              if ("closed" in issuesPerDayObject[`${daysAgo} days ago`]) {
                issuesPerDayObject[`${daysAgo} days ago`].closed++;
              } else {
                issuesPerDayObject[`${daysAgo} days ago`].closed = 1;
              }
            } else {
              if ("open" in issuesPerDayObject[`${daysAgo} days ago`]) {
                issuesPerDayObject[`${daysAgo} days ago`].open++;
              } else {
                issuesPerDayObject[`${daysAgo} days ago`].open = 1;
              }
            }
          }
        }); //end map
        issuesPerDayObject[`${daysAgo} days ago`].all =
          (issuesPerDayObject[`${daysAgo} days ago`].closed || 0) +
          (issuesPerDayObject[`${daysAgo} days ago`].open || 0);

        !issuesPerDayObject[`${daysAgo} days ago`].closed
          ? (issuesPerDayObject[`${daysAgo} days ago`].closed = 0)
          : null;

        !issuesPerDayObject[`${daysAgo} days ago`].open
          ? (issuesPerDayObject[`${daysAgo} days ago`].open = 0)
          : null;

        daysAgo++;
        toDate.setDate(toDate.getDate() - 1);
        console.log(toDate);
      }

      res.json(issuesPerDayObject);
    } catch (error) {
      console.log("Error in average route", error);
      next(error);
    }
  }
);

module.exports = router;
