// Shared helpers for talking to GitHub without downloading a repo's entire history.
//
// Big public repos (express, react, ...) have tens of thousands of PRs, issues,
// forks and stars. Paginating all of them on every dashboard load runs the free
// Render instance out of memory and burns through the GitHub rate limit, so
// every route should use counts from GraphQL and only a capped number of pages
// of recent items.

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const cache = new Map(); // key -> { expires, promise }

// Cache (and de-duplicate) an async call. The dashboard fires the same request
// several times at once (e.g. merge-success-rate is used by 4 charts), so
// concurrent callers share one in-flight promise.
function cached(key, fn, ttlMs = CACHE_TTL_MS) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise;

  const promise = Promise.resolve()
    .then(fn)
    .catch((err) => {
      cache.delete(key); // never cache failures
      throw err;
    });
  cache.set(key, { expires: Date.now() + ttlMs, promise });

  // keep the cache from growing forever
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
  }
  return promise;
}

// Cache key scoped to the logged-in user, so private repo data is never shared
// between users.
function userKey(req, ...parts) {
  const id = req.user ? req.user.githubID : "anon";
  return [id, ...parts].join(":");
}

// Like octokit.paginate, but stops after `maxPages` pages.
async function paginateLimited(octokit, route, params, maxPages = 3) {
  let pages = 0;
  return octokit.paginate(
    route,
    { per_page: 100, ...params },
    (response, done) => {
      pages++;
      if (pages >= maxPages) done();
      return response.data;
    }
  );
}

// One GraphQL call that returns every total the dashboard needs.
const REPO_COUNTS_QUERY = `
  query ($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      stargazerCount
      forkCount
      openIssues: issues(states: OPEN) { totalCount }
      closedIssues: issues(states: CLOSED) { totalCount }
      openPRs: pullRequests(states: OPEN) { totalCount }
      closedPRs: pullRequests(states: CLOSED) { totalCount }
      mergedPRs: pullRequests(states: MERGED) { totalCount }
      allPRs: pullRequests { totalCount }
      deployments { totalCount }
      refs(refPrefix: "refs/heads/") { totalCount }
      defaultBranchRef {
        name
        target { ... on Commit { history { totalCount } } }
      }
    }
  }
`;

function getRepoCounts(req, octokit, owner, repo) {
  return cached(userKey(req, "counts", owner, repo), async () => {
    const { repository: r } = await octokit.graphql(REPO_COUNTS_QUERY, {
      owner,
      name: repo,
    });
    return {
      stars: r.stargazerCount,
      forks: r.forkCount,
      openIssues: r.openIssues.totalCount,
      closedIssues: r.closedIssues.totalCount,
      openPRs: r.openPRs.totalCount,
      // REST "closed" PRs include merged ones; GraphQL CLOSED excludes them
      closedPRs: r.closedPRs.totalCount + r.mergedPRs.totalCount,
      mergedPRs: r.mergedPRs.totalCount,
      allPRs: r.allPRs.totalCount,
      deployments: r.deployments.totalCount,
      branches: r.refs.totalCount,
      defaultBranch: r.defaultBranchRef ? r.defaultBranchRef.name : null,
      commits:
        r.defaultBranchRef && r.defaultBranchRef.target
          ? r.defaultBranchRef.target.history.totalCount
          : 0,
    };
  });
}

// Run async work over a list with limited concurrency.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

// Translate a timeRange param (pastDay/pastWeek/pastMonth/pastYear) to days.
function daysForRange(timeRange, fallback = 7) {
  return (
    { pastDay: 1, pastWeek: 7, pastMonth: 30, pastYear: 365 }[timeRange] ||
    fallback
  );
}

module.exports = {
  cached,
  userKey,
  paginateLimited,
  getRepoCounts,
  mapLimit,
  daysForRange,
};
