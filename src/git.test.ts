import assert from "node:assert/strict";
import test from "node:test";
import {
  collectGitInfo,
  collectPullRequestInfo,
  shouldRefreshPullRequest,
} from "./git.ts";

interface ExecInvocation {
  command: string;
  args: string[];
  cwd: string;
  timeout?: number;
}

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

function gitSubcommand(args: string[]): string {
  return args[0] === "--no-optional-locks" ? (args[1] ?? "") : (args[0] ?? "");
}

function createPi(
  execImpl: (call: ExecInvocation) => ExecResult | Promise<ExecResult>,
) {
  const calls: ExecInvocation[] = [];

  return {
    calls,
    pi: {
      async exec(
        command: string,
        args: string[],
        options: { cwd: string; timeout?: number },
      ) {
        const call = {
          command,
          args,
          cwd: options.cwd,
          timeout: options.timeout,
        };
        calls.push(call);
        return await execImpl(call);
      },
    } as {
      exec(
        command: string,
        args: string[],
        options: { cwd: string; timeout?: number },
      ): Promise<ExecResult>;
    },
  };
}

test("collectPullRequestInfo ignores foreign branch-name matches and falls back to gh pr view", async () => {
  const { pi, calls } = createPi(({ command, args }) => {
    if (command === "git" && gitSubcommand(args) === "rev-parse") {
      return { code: 0, stdout: "origin/fix-ci\n", stderr: "" };
    }

    if (command === "git" && gitSubcommand(args) === "config") {
      return {
        code: 0,
        stdout: [
          "remote.origin.url https://github.com/me/repo.git",
          "remote.upstream.url https://github.com/org/repo.git",
        ].join("\n"),
        stderr: "",
      };
    }

    if (command === "gh" && args[0] === "api") {
      if (args.includes("owner=org")) {
        return {
          code: 0,
          stdout: JSON.stringify({
            data: {
              repository: {
                pullRequests: {
                  nodes: [
                    {
                      number: 42,
                      url: "https://github.com/org/repo/pull/42",
                      headRepositoryOwner: { login: "someone-else" },
                    },
                  ],
                },
              },
            },
          }),
          stderr: "",
        };
      }

      return {
        code: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequests: {
                nodes: [],
              },
            },
          },
        }),
        stderr: "",
      };
    }

    if (command === "gh" && args[0] === "pr" && args[1] === "view") {
      return {
        code: 0,
        stdout: JSON.stringify({
          number: 7,
          url: "https://github.com/org/repo/pull/7",
        }),
        stderr: "",
      };
    }

    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  });

  const result = await collectPullRequestInfo(pi as never, "/repo", "fix-ci");

  assert.deepEqual(result.pullRequest, {
    number: 7,
    url: "https://github.com/org/repo/pull/7",
  });
  assert.equal(result.pullRequestLookupEnabled, true);
  assert.notEqual(result.pullRequestLookupAt, 0);
  assert.equal(
    calls.some(
      (call) =>
        call.command === "gh" &&
        call.args[0] === "pr" &&
        call.args[1] === "view",
    ),
    true,
  );
  assert.equal(
    calls
      .filter((call) => call.command === "git")
      .every((call) => call.args[0] === "--no-optional-locks"),
    true,
  );
});

test("collectPullRequestInfo includes unresolved review thread count", async () => {
  const { pi } = createPi(({ command, args }) => {
    if (command === "git" && gitSubcommand(args) === "rev-parse") {
      return { code: 0, stdout: "origin/feature\n", stderr: "" };
    }

    if (command === "git" && gitSubcommand(args) === "config") {
      return {
        code: 0,
        stdout: "remote.origin.url https://github.com/me/repo.git",
        stderr: "",
      };
    }

    if (
      command === "gh" &&
      args[0] === "api" &&
      args.includes("branch=feature")
    ) {
      return {
        code: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequests: {
                nodes: [
                  {
                    number: 12,
                    url: "https://github.com/me/repo/pull/12",
                    headRepositoryOwner: { login: "me" },
                  },
                ],
              },
            },
          },
        }),
        stderr: "",
      };
    }

    if (command === "gh" && args[0] === "api" && args.includes("number=12")) {
      return {
        code: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: {
                    hasNextPage: false,
                    endCursor: null,
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
        }),
        stderr: "",
      };
    }

    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  });

  const result = await collectPullRequestInfo(pi as never, "/repo", "feature");

  assert.deepEqual(result.pullRequest, {
    number: 12,
    url: "https://github.com/me/repo/pull/12",
    unresolvedReviewThreadCount: 2,
  });
});

test("collectPullRequestInfo includes PR CI status when requested", async () => {
  const { pi } = createPi(({ command, args }) => {
    if (command === "git" && gitSubcommand(args) === "rev-parse") {
      return { code: 0, stdout: "origin/feature\n", stderr: "" };
    }

    if (command === "git" && gitSubcommand(args) === "config") {
      return {
        code: 0,
        stdout: "remote.origin.url https://github.com/me/repo.git",
        stderr: "",
      };
    }

    if (
      command === "gh" &&
      args[0] === "api" &&
      args.includes("branch=feature")
    ) {
      return {
        code: 0,
        stdout: JSON.stringify({
          data: {
            repository: {
              pullRequests: {
                nodes: [
                  {
                    number: 12,
                    url: "https://github.com/me/repo/pull/12",
                    headRefOid: "abc123",
                    headRepositoryOwner: { login: "me" },
                  },
                ],
              },
            },
          },
        }),
        stderr: "",
      };
    }

    if (
      command === "gh" &&
      args[0] === "api" &&
      args[1] === "repos/me/repo/actions/runs?head_sha=abc123&per_page=100"
    ) {
      return {
        code: 0,
        stdout: JSON.stringify({
          workflow_runs: [
            {
              status: "in_progress",
              conclusion: null,
              html_url: "https://github.com/me/repo/actions/runs/1",
              updated_at: "2026-01-01T10:00:00Z",
            },
            {
              status: "completed",
              conclusion: "failure",
              html_url: "https://github.com/me/repo/actions/runs/2",
              updated_at: "2026-01-01T09:00:00Z",
            },
          ],
        }),
        stderr: "",
      };
    }

    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  });

  const result = await collectPullRequestInfo(pi as never, "/repo", "feature", {
    includeReviewThreads: false,
    includeCiStatus: true,
  });

  assert.deepEqual(result.pullRequest, {
    number: 12,
    url: "https://github.com/me/repo/pull/12",
    headRefOid: "abc123",
    ciStatus: {
      state: "failed",
      url: "https://github.com/me/repo/actions/runs/2",
    },
  });
});

test("collectPullRequestInfo skips GitHub CLI lookups when the repository has no GitHub remote", async () => {
  const { pi, calls } = createPi(({ command, args }) => {
    if (command === "git" && gitSubcommand(args) === "rev-parse") {
      return { code: 0, stdout: "origin/main\n", stderr: "" };
    }

    if (command === "git" && gitSubcommand(args) === "config") {
      return {
        code: 0,
        stdout: "remote.origin.url ssh://git.example.com/team/repo.git",
        stderr: "",
      };
    }

    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  });

  const result = await collectPullRequestInfo(pi as never, "/repo", "main");

  assert.equal(result.pullRequest, undefined);
  assert.equal(result.pullRequestLookupEnabled, false);
  assert.equal(
    calls.every((call) => call.command === "git"),
    true,
  );
  assert.equal(
    calls.every((call) => call.args[0] === "--no-optional-locks"),
    true,
  );
});

test("collectGitInfo disables periodic PR refreshes for non-GitHub repositories", async () => {
  const { pi, calls } = createPi(({ command, args }) => {
    if (command === "git" && gitSubcommand(args) === "status") {
      return {
        code: 0,
        stdout: [
          "# branch.oid abcdef1234567890",
          "# branch.head main",
          "# branch.upstream origin/main",
          "# branch.ab +0 -0",
        ].join("\n"),
        stderr: "",
      };
    }

    if (command === "git" && gitSubcommand(args) === "config") {
      return {
        code: 0,
        stdout: "remote.origin.url ssh://git.example.com/team/repo.git",
        stderr: "",
      };
    }

    if (command === "git" && gitSubcommand(args) === "diff") {
      return { code: 0, stdout: "", stderr: "" };
    }

    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  });

  const git = await collectGitInfo(pi as never, "/repo");

  assert.equal(git.pullRequestLookupEnabled, false);
  assert.equal(shouldRefreshPullRequest(git), false);
  assert.equal(
    calls.every((call) => call.args[0] === "--no-optional-locks"),
    true,
  );
});
