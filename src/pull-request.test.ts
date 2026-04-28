import assert from "node:assert/strict";
import test from "node:test";
import {
  createGitHubRepositoryContext,
  parseGitHubPullRequestUrl,
  parsePullRequestReviewThreadsPage,
  selectPullRequestFromGraphQL,
} from "./pull-request.ts";

test("createGitHubRepositoryContext derives repository and PR lookup plan from remotes", () => {
  const context = createGitHubRepositoryContext(
    [
      "remote.origin.url https://github.com/me/repo.git",
      "remote.upstream.url https://github.com/org/repo.git",
    ].join("\n"),
    "origin/fix-ci",
  );

  assert.equal(context.repository, "me/repo");
  assert.equal(context.pullRequestLookupEnabled, true);
  assert.deepEqual(context.pullRequestLookupPlan, {
    baseRepositories: ["org/repo", "me/repo"],
    headOwners: ["me", "org"],
    allowCurrentBranchFallback: true,
  });
});

test("parseGitHubPullRequestUrl extracts owner, repository, and PR number", () => {
  assert.deepEqual(
    parseGitHubPullRequestUrl("https://github.com/org/repo/pull/42"),
    {
      owner: "org",
      name: "repo",
      number: 42,
    },
  );
  assert.deepEqual(
    parseGitHubPullRequestUrl(
      "https://github.com/org/repo/pull/42#discussion_r1",
    ),
    {
      owner: "org",
      name: "repo",
      number: 42,
    },
  );
  assert.equal(
    parseGitHubPullRequestUrl("https://example.com/org/repo/pull/42"),
    undefined,
  );
});

test("parsePullRequestReviewThreadsPage counts unresolved review threads", () => {
  const output = JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: {
              hasNextPage: true,
              endCursor: "cursor-1",
            },
            nodes: [
              { isResolved: false },
              { isResolved: true },
              { isResolved: false },
            ],
          },
        },
      },
    },
  });

  assert.deepEqual(parsePullRequestReviewThreadsPage(output), {
    unresolvedCount: 2,
    hasNextPage: true,
    endCursor: "cursor-1",
  });
});

test("selectPullRequestFromGraphQL accepts only candidates from known head owners", () => {
  const output = JSON.stringify({
    data: {
      repository: {
        pullRequests: {
          nodes: [
            {
              number: 42,
              url: "https://github.com/org/repo/pull/42",
              headRepositoryOwner: { login: "someone-else" },
            },
            {
              number: 7,
              url: "https://github.com/org/repo/pull/7",
              headRepositoryOwner: { login: "me" },
            },
          ],
        },
      },
    },
  });

  assert.deepEqual(selectPullRequestFromGraphQL(output, ["me", "org"]), {
    number: 7,
    url: "https://github.com/org/repo/pull/7",
  });
  assert.equal(selectPullRequestFromGraphQL(output, ["unknown"]), undefined);
});
