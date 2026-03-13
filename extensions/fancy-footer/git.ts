import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { EMPTY_GIT_INFO, type GitInfo, parseGitHubRemote, parseNumstat, toNumber } from "./shared.ts";

async function exec(
  pi: ExtensionAPI,
  command: string,
  args: string[],
  cwd: string,
): Promise<string> {
  try {
    const result = await pi.exec(command, args, { cwd, timeout: 2000 });
    if (result.code !== 0) return "";
    // Keep leading whitespace (git porcelain uses it), only drop trailing newlines.
    return result.stdout.replace(/[\r\n]+$/, "");
  } catch {
    return "";
  }
}

async function collectPullRequest(
  pi: ExtensionAPI,
  cwd: string,
  repository: string,
  branch: string,
): Promise<GitInfo["pullRequest"]> {
  if (!repository || !branch) return undefined;

  const output = await exec(
    pi,
    "gh",
    ["pr", "list", "--repo", repository, "--head", branch, "--state", "open", "--limit", "1", "--json", "number,url"],
    cwd,
  );
  if (!output) return undefined;

  try {
    const parsed = JSON.parse(output) as Array<{ number?: unknown; url?: unknown }>;
    const first = Array.isArray(parsed) ? parsed[0] : undefined;
    const number = Math.max(0, Math.floor(toNumber(first?.number)));
    const url = typeof first?.url === "string" ? first.url : "";
    if (number <= 0) return undefined;
    return { number, url };
  } catch {
    return undefined;
  }
}

export async function collectGitInfo(pi: ExtensionAPI, cwd: string): Promise<GitInfo> {
  const [porcelainV2, remoteUrl] = await Promise.all([
    exec(pi, "git", ["status", "--porcelain=2", "--branch"], cwd),
    exec(pi, "git", ["config", "--get", "remote.origin.url"], cwd),
  ]);

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

    if (line.startsWith("1 ") || line.startsWith("2 ") || line.startsWith("u ")) {
      const xy = line.split(" ")[1] || "..";
      const x = xy[0] || ".";
      const y = xy[1] || ".";
      if (x !== ".") staged += 1;
      if (y !== ".") modified += 1;
    }
  }

  const repository = parseGitHubRemote(remoteUrl);
  const pullRequestPromise = collectPullRequest(pi, cwd, repository, branch);

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
    pullRequest: await pullRequestPromise,
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
