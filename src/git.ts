import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  EMPTY_GIT_INFO,
  type GitInfo,
  parseNumstat,
  toNumber,
} from "./shared.ts";

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 2_000;
const PULL_REQUEST_REFRESH_MS = 60_000;
const GIT_NO_OPTIONAL_LOCKS_ARG = "--no-optional-locks";
async function execResult(
  pi: ExtensionAPI,
  command: string,
  args: string[],
  cwd: string,
  timeout = DEFAULT_COMMAND_TIMEOUT_MS,
): Promise<ExecResult> {
  try {
    const result = await pi.exec(command, args, { cwd, timeout });
    return {
      code: result.code,
      // Keep leading whitespace (git porcelain uses it), only drop trailing newlines.
      stdout: result.stdout.replace(/[\r\n]+$/, ""),
      stderr: result.stderr.replace(/[\r\n]+$/, ""),
    };
  } catch {
    return { code: -1, stdout: "", stderr: "" };
  }
}

async function exec(
  pi: ExtensionAPI,
  command: string,
  args: string[],
  cwd: string,
): Promise<string> {
  const result = await execResult(pi, command, args, cwd);
  if (result.code !== 0) return "";
  return result.stdout;
}

async function execGitResult(
  pi: ExtensionAPI,
  args: string[],
  cwd: string,
  timeout = DEFAULT_COMMAND_TIMEOUT_MS,
): Promise<ExecResult> {
  return execResult(
    pi,
    "git",
    [GIT_NO_OPTIONAL_LOCKS_ARG, ...args],
    cwd,
    timeout,
  );
}

async function execGit(
  pi: ExtensionAPI,
  args: string[],
  cwd: string,
): Promise<string> {
  const result = await execGitResult(pi, args, cwd);
  if (result.code !== 0) return "";
  return result.stdout;
}

export async function collectGitInfo(
  pi: ExtensionAPI,
  cwd: string,
): Promise<GitInfo> {
  const porcelainV2 = await execGit(
    pi,
    ["status", "--porcelain=2", "--branch"],
    cwd,
  );

  if (!porcelainV2) return { ...EMPTY_GIT_INFO };

  let branch = "";
  let commit = "";
  let staged = 0;
  let modified = 0;
  let untracked = 0;
  let ahead = 0;
  let behind = 0;

  for (const line of porcelainV2.split(/\r?\n/)) {
    if (!line) continue;

    if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length).trim();
      branch = head === "(detached)" ? "" : head;
      continue;
    }

    if (line.startsWith("# branch.oid ")) {
      const oid = line.slice("# branch.oid ".length).trim();
      if (oid && oid !== "(initial)") commit = oid.slice(0, 7);
      continue;
    }

    if (line.startsWith("# branch.ab ")) {
      const match = line.match(/^# branch\.ab \+(\d+) -(\d+)$/);
      if (match) {
        ahead = Math.max(0, Math.floor(toNumber(match[1])));
        behind = Math.max(0, Math.floor(toNumber(match[2])));
      }
      continue;
    }

    if (line.startsWith("? ")) {
      untracked += 1;
      continue;
    }

    if (
      line.startsWith("1 ") ||
      line.startsWith("2 ") ||
      line.startsWith("u ")
    ) {
      const xy = line.split(" ")[1] || "..";
      const x = xy[0] || ".";
      const y = xy[1] || ".";
      if (x !== ".") staged += 1;
      if (y !== ".") modified += 1;
    }
  }

  let added = 0;
  let removed = 0;

  const headDiff = await execGit(pi, ["diff", "--numstat", "HEAD"], cwd);
  if (headDiff) {
    const stats = parseNumstat(headDiff);
    added = stats.added;
    removed = stats.removed;
  } else {
    const [stagedDiff, unstagedDiff] = await Promise.all([
      execGit(pi, ["diff", "--numstat", "--cached"], cwd),
      execGit(pi, ["diff", "--numstat"], cwd),
    ]);
    const stagedStats = parseNumstat(stagedDiff);
    const unstagedStats = parseNumstat(unstagedDiff);
    added = stagedStats.added + unstagedStats.added;
    removed = stagedStats.removed + unstagedStats.removed;
  }

  return {
    branch,
    commit,
    added,
    removed,
    counts: {
      staged,
      modified,
      untracked,
      ahead,
      behind,
    },
  };
}
