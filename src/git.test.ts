import assert from "node:assert/strict";
import test from "node:test";
import { collectGitInfo } from "./git.ts";

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

const STATUS = [
  "# branch.oid abcdef1234567890",
  "# branch.head main",
  "# branch.upstream origin/main",
  "# branch.ab +2 -1",
  "1 M. N... 100644 100644 100644 aaa bbb src/index.ts",
  "1 .M N... 100644 100644 100644 ccc ddd src/render.ts",
  "? notes.txt",
].join("\n");

test("collectGitInfo reads branch, commit, and working tree counts", async () => {
  const { pi, calls } = createPi(({ command, args }) => {
    if (command === "git" && gitSubcommand(args) === "status") {
      return { code: 0, stdout: STATUS, stderr: "" };
    }
    if (command === "git" && gitSubcommand(args) === "diff") {
      return { code: 0, stdout: "4\t2\tsrc/index.ts", stderr: "" };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  });

  const git = await collectGitInfo(pi as never, "/repo");

  assert.equal(git.branch, "main");
  assert.equal(git.commit, "abcdef1");
  assert.equal(git.added, 4);
  assert.equal(git.removed, 2);
  assert.deepEqual(git.counts, {
    staged: 1,
    modified: 1,
    untracked: 1,
    ahead: 2,
    behind: 1,
  });
  assert.equal(
    calls.every((call) => call.args[0] === "--no-optional-locks"),
    true,
  );
});

test("collectGitInfo never invokes the GitHub CLI", async () => {
  const { pi, calls } = createPi(({ command, args }) => {
    if (command !== "git") {
      throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
    }
    if (gitSubcommand(args) === "status") {
      return { code: 0, stdout: STATUS, stderr: "" };
    }
    return { code: 0, stdout: "", stderr: "" };
  });

  await collectGitInfo(pi as never, "/repo");

  assert.equal(
    calls.some((call) => call.command === "gh"),
    false,
  );
});

test("collectGitInfo sums staged and unstaged diffs without a HEAD commit", async () => {
  const { pi } = createPi(({ command, args }) => {
    if (command === "git" && gitSubcommand(args) === "status") {
      return { code: 0, stdout: "# branch.head main", stderr: "" };
    }
    if (command === "git" && args.includes("HEAD")) {
      return { code: 1, stdout: "", stderr: "no HEAD" };
    }
    if (command === "git" && args.includes("--cached")) {
      return { code: 0, stdout: "3\t1\tsrc/a.ts", stderr: "" };
    }
    if (command === "git" && gitSubcommand(args) === "diff") {
      return { code: 0, stdout: "1\t1\tsrc/b.ts", stderr: "" };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  });

  const git = await collectGitInfo(pi as never, "/repo");

  assert.equal(git.added, 4);
  assert.equal(git.removed, 2);
});

test("collectGitInfo returns empty info outside a repository", async () => {
  const { pi } = createPi(() => ({ code: 128, stdout: "", stderr: "" }));

  const git = await collectGitInfo(pi as never, "/tmp");

  assert.equal(git.branch, "");
  assert.equal(git.commit, "");
});
