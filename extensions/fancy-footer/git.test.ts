import assert from "node:assert/strict";
import test from "node:test";
import { collectGitInfo, collectPullRequestInfo, shouldRefreshPullRequest } from "./git.ts";

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

function createPi(execImpl: (call: ExecInvocation) => ExecResult | Promise<ExecResult>) {
  const calls: ExecInvocation[] = [];

  return {
    calls,
    pi: {
      async exec(command: string, args: string[], options: { cwd: string; timeout?: number }) {
        const call = { command, args, cwd: options.cwd, timeout: options.timeout };
        calls.push(call);
        return await execImpl(call);
      },
    } as {
      exec(command: string, args: string[], options: { cwd: string; timeout?: number }): Promise<ExecResult>;
    },
  };
}

test("collectPullRequestInfo ignores foreign branch-name matches and falls back to gh pr view", async () => {
  const { pi, calls } = createPi(({ command, args }) => {
    if (command === "git" && args[0] === "rev-parse") {
      return { code: 0, stdout: "origin/fix-ci\n", stderr: "" };
    }

    if (command === "git" && args[0] === "config") {
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
    calls.some((call) => call.command === "gh" && call.args[0] === "pr" && call.args[1] === "view"),
    true,
  );
});

test("collectPullRequestInfo skips GitHub CLI lookups when the repository has no GitHub remote", async () => {
  const { pi, calls } = createPi(({ command, args }) => {
    if (command === "git" && args[0] === "rev-parse") {
      return { code: 0, stdout: "origin/main\n", stderr: "" };
    }

    if (command === "git" && args[0] === "config") {
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
  assert.equal(calls.every((call) => call.command === "git"), true);
});

test("collectGitInfo disables periodic PR refreshes for non-GitHub repositories", async () => {
  const { pi } = createPi(({ command, args }) => {
    if (command === "git" && args[0] === "status") {
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

    if (command === "git" && args[0] === "config") {
      return {
        code: 0,
        stdout: "remote.origin.url ssh://git.example.com/team/repo.git",
        stderr: "",
      };
    }

    if (command === "git" && args[0] === "diff") {
      return { code: 0, stdout: "", stderr: "" };
    }

    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  });

  const git = await collectGitInfo(pi as never, "/repo");

  assert.equal(git.pullRequestLookupEnabled, false);
  assert.equal(shouldRefreshPullRequest(git), false);
});
