import assert from "node:assert/strict";
import test from "node:test";
import {
  createGitHubRepositoryContext,
  parseGitHubPullRequestUrl,
  parsePullRequest,
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
    baseRepositories: [
      {
        host: "github.com",
        owner: "org",
        name: "repo",
        repository: "org/repo",
      },
      {
        host: "github.com",
        owner: "me",
        name: "repo",
        repository: "me/repo",
      },
    ],
    headOwners: ["me", "org"],
    allowCurrentBranchFallback: true,
  });
});

test("createGitHubRepositoryContext supports GitHub Enterprise hosts", () => {
  const context = createGitHubRepositoryContext(
    "remote.origin.url git@github.example.com:org/repo.git",
    "origin/main",
  );

  assert.equal(context.repository, "org/repo");
  assert.equal(context.pullRequestLookupEnabled, true);
  assert.deepEqual(context.pullRequestLookupPlan, {
    baseRepositories: [
      {
        host: "github.example.com",
        owner: "org",
        name: "repo",
        repository: "org/repo",
      },
    ],
    headOwners: ["org"],
    allowCurrentBranchFallback: true,
  });
});

test("createGitHubRepositoryContext supports GitHub Enterprise SSH URLs with ports", () => {
  const context = createGitHubRepositoryContext(
    "remote.origin.url ssh://git@github.example.com:2222/org/repo.git",
    "origin/main",
  );

  assert.equal(context.repository, "org/repo");
  assert.deepEqual(context.pullRequestLookupPlan?.baseRepositories, [
    {
      host: "github.example.com",
      owner: "org",
      name: "repo",
      repository: "org/repo",
    },
  ]);
});

test("createGitHubRepositoryContext excludes non-GitHub hosts", () => {
  const context = createGitHubRepositoryContext(
    [
      "remote.origin.url git@notgithub.com:org/repo.git",
      "remote.upstream.url https://gitlab.githubmirror.com/org/repo.git",
      "remote.fork.url https://gitlab.com/org/repo.git",
    ].join("\n"),
    "origin/main",
  );

  assert.equal(context.repository, "");
  assert.equal(context.pullRequestLookupEnabled, false);
  assert.equal(context.pullRequestLookupPlan, undefined);
});

test("parseGitHubPullRequestUrl extracts owner, repository, and PR number", () => {
  assert.deepEqual(
    parseGitHubPullRequestUrl("https://github.com/org/repo/pull/42"),
    {
      host: "github.com",
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
      host: "github.com",
      owner: "org",
      name: "repo",
      number: 42,
    },
  );
  assert.deepEqual(
    parseGitHubPullRequestUrl("https://github.example.com/org/repo/pull/42"),
    {
      host: "github.example.com",
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

test("parsePullRequest reads PR state and auto-merge status", () => {
  assert.deepEqual(
    parsePullRequest(
      JSON.stringify({
        number: 42,
        url: "https://github.com/org/repo/pull/42",
        state: "MERGED",
      }),
    ),
    {
      number: 42,
      url: "https://github.com/org/repo/pull/42",
      state: "merged",
      host: "github.com",
    },
  );
  assert.deepEqual(
    parsePullRequest(
      JSON.stringify({
        number: 43,
        url: "https://github.com/org/repo/pull/43",
        state: "OPEN",
        autoMergeRequest: { enabledAt: "2026-07-26T08:00:00Z" },
      }),
    ),
    {
      number: 43,
      url: "https://github.com/org/repo/pull/43",
      state: "open",
      autoMergeEnabled: true,
      host: "github.com",
    },
  );
  assert.equal(
    parsePullRequest(
      JSON.stringify({
        number: 42,
        url: "https://github.com/org/repo/pull/42",
        state: "CLOSED",
      }),
    ),
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
              state: "OPEN",
              headRepositoryOwner: { login: "someone-else" },
            },
            {
              number: 8,
              url: "https://github.com/org/repo/pull/8",
              state: "MERGED",
              headRepositoryOwner: { login: "me" },
            },
            {
              number: 7,
              url: "https://github.com/org/repo/pull/7",
              state: "OPEN",
              autoMergeRequest: { enabledAt: "2026-07-26T08:00:00Z" },
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
    state: "open",
    autoMergeEnabled: true,
    host: "github.com",
  });
  assert.equal(selectPullRequestFromGraphQL(output, ["unknown"]), undefined);
});

test("selectPullRequestFromGraphQL prefers the tracked owner before PR state", () => {
  const output = JSON.stringify({
    data: {
      repository: {
        pullRequests: {
          nodes: [
            {
              number: 9,
              url: "https://github.com/org/repo/pull/9",
              state: "OPEN",
              headRepositoryOwner: { login: "org" },
            },
            {
              number: 8,
              url: "https://github.com/org/repo/pull/8",
              state: "MERGED",
              headRepositoryOwner: { login: "me" },
            },
          ],
        },
      },
    },
  });

  assert.deepEqual(selectPullRequestFromGraphQL(output, ["me", "org"]), {
    number: 8,
    url: "https://github.com/org/repo/pull/8",
    state: "merged",
    host: "github.com",
  });
});
