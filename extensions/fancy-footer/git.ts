import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { EMPTY_GIT_INFO, type GitInfo, parseGitHubRemote, parseNumstat, toNumber } from "./shared.ts";

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function execResult(
  pi: ExtensionAPI,
  command: string,
  args: string[],
  cwd: string,
): Promise<ExecResult> {
  try {
    const result = await pi.exec(command, args, { cwd, timeout: 2000 });
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

function parseRemoteUrls(output: string): Map<string, string> {
  const remotes = new Map<string, string>();

  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^remote\.([^\s]+)\.url\s+(.+)$/);
    if (!match) continue;
    const [, remoteName, url] = match;
    if (!remoteName || !url) continue;
    remotes.set(remoteName, url.trim());
  }

  return remotes;
}

function parseRemoteName(ref: string): string {
  const slash = ref.indexOf("/");
  if (slash <= 0) return "";
  return ref.slice(0, slash);
}

function selectGitHubRepository(remoteUrls: string, preferredRemote: string): string {
  const remotes = parseRemoteUrls(remoteUrls);
  const candidateNames = [preferredRemote, "origin", "upstream", ...remotes.keys()];
  const seen = new Set<string>();

  for (const candidate of candidateNames) {
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    const repository = parseGitHubRemote(remotes.get(candidate) ?? "");
    if (repository) return repository;
  }

  return "";
}

async function collectPullRequest(
  pi: ExtensionAPI,
  cwd: string,
  repository: string,
  branch: string,
): Promise<GitInfo["pullRequest"]> {
  if (!repository || !branch) return undefined;

  const result = await execResult(pi, "gh", ["pr", "view", branch, "--json", "number,url"], cwd);
  if (result.code !== 0 || !result.stdout) return undefined;

  try {
    const parsed = JSON.parse(result.stdout) as { number?: unknown; url?: unknown };
    const number = Math.max(0, Math.floor(toNumber(parsed?.number)));
    const url = typeof parsed?.url === "string" ? parsed.url : "";
    if (number <= 0 || !url) return undefined;
    return { number, url };
  } catch {
    return undefined;
  }
}

export async function collectGitInfo(
  pi: ExtensionAPI,
  cwd: string,
  previousGit: Pick<GitInfo, "repository" | "branch" | "pullRequest"> | undefined = undefined,
): Promise<GitInfo> {
  const [porcelainV2, remoteUrls] = await Promise.all([
    exec(pi, "git", ["status", "--porcelain=2", "--branch"], cwd),
    exec(pi, "git", ["config", "--get-regexp", "^remote\\..*\\.url$"], cwd),
  ]);

  if (!porcelainV2) return { ...EMPTY_GIT_INFO };

  let branch = "";
  let commit = "";
  let upstream = "";
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

    if (line.startsWith("# branch.upstream ")) {
      upstream = line.slice("# branch.upstream ".length).trim();
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

    if (line.startsWith("1 ") || line.startsWith("2 ") || line.startsWith("u ")) {
      const xy = line.split(" ")[1] || "..";
      const x = xy[0] || ".";
      const y = xy[1] || ".";
      if (x !== ".") staged += 1;
      if (y !== ".") modified += 1;
    }
  }

  const repository = selectGitHubRepository(remoteUrls, parseRemoteName(upstream));
  const pullRequest = previousGit && previousGit.repository === repository && previousGit.branch === branch
    ? previousGit.pullRequest
    : await collectPullRequest(pi, cwd, repository, branch);

  let added = 0;
  let removed = 0;

  const headDiff = await exec(pi, "git", ["diff", "--numstat", "HEAD"], cwd);
  if (headDiff) {
    const stats = parseNumstat(headDiff);
    added = stats.added;
    removed = stats.removed;
  } else {
    const [stagedDiff, unstagedDiff] = await Promise.all([
      exec(pi, "git", ["diff", "--numstat", "--cached"], cwd),
      exec(pi, "git", ["diff", "--numstat"], cwd),
    ]);
    const stagedStats = parseNumstat(stagedDiff);
    const unstagedStats = parseNumstat(unstagedDiff);
    added = stagedStats.added + unstagedStats.added;
    removed = stagedStats.removed + unstagedStats.removed;
  }

  return {
    repository,
    branch,
    commit,
    pullRequest,
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
