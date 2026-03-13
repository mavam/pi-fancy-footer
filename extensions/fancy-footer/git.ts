import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { EMPTY_GIT_INFO, type GitInfo, parseGitHubRemote, parseNumstat, toNumber } from "./shared.ts";

interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

interface GitHubRemote {
  name: string;
  repository: string;
  owner: string;
}

interface PullRequestCandidate {
  number: number;
  url: string;
  headOwner: string;
}

interface PullRequestLookupPlan {
  baseRepositories: string[];
  headOwners: string[];
  allowCurrentBranchFallback: boolean;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 2_000;
const GITHUB_COMMAND_TIMEOUT_MS = 5_000;
const PULL_REQUEST_REFRESH_MS = 60_000;
const PULL_REQUEST_QUERY = [
  "query($owner: String!, $name: String!, $branch: String!) {",
  "  repository(owner: $owner, name: $name) {",
  "    pullRequests(states: OPEN, headRefName: $branch, first: 20, orderBy: { field: CREATED_AT, direction: DESC }) {",
  "      nodes {",
  "        number",
  "        url",
  "        headRepositoryOwner { login }",
  "      }",
  "    }",
  "  }",
  "}",
].join(" ");

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

function parseRepositoryOwner(repository: string): string {
  const slash = repository.indexOf("/");
  if (slash <= 0) return "";
  return repository.slice(0, slash);
}

function splitRepository(repository: string): { owner: string; name: string } | undefined {
  const slash = repository.indexOf("/");
  if (slash <= 0 || slash >= repository.length - 1) return undefined;
  return {
    owner: repository.slice(0, slash),
    name: repository.slice(slash + 1),
  };
}

function parseGitHubRemotes(remoteUrls: string): GitHubRemote[] {
  const remotes: GitHubRemote[] = [];

  for (const [name, url] of parseRemoteUrls(remoteUrls)) {
    const repository = parseGitHubRemote(url);
    if (!repository) continue;
    const owner = parseRepositoryOwner(repository);
    if (!owner) continue;
    remotes.push({ name, repository, owner });
  }

  return remotes;
}

function orderedRemoteValues<T>(
  remotes: GitHubRemote[],
  preferredNames: string[],
  pick: (remote: GitHubRemote) => T,
): T[] {
  const byName = new Map(remotes.map((remote) => [remote.name, remote]));
  const ordered: T[] = [];
  const seen = new Set<string>();

  for (const remoteName of [...preferredNames, ...remotes.map((remote) => remote.name)]) {
    if (!remoteName) continue;
    const remote = byName.get(remoteName);
    if (!remote) continue;
    const value = pick(remote);
    const key = String(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    ordered.push(value);
  }

  return ordered;
}

function selectGitHubRepository(remotes: GitHubRemote[], preferredRemote: string): string {
  return orderedRemoteValues(remotes, [preferredRemote, "origin", "upstream"], (remote) => remote.repository)[0] ?? "";
}

function selectPullRequestBaseRepositories(remotes: GitHubRemote[], preferredRemote: string): string[] {
  // PRs often live in the upstream repo even when the branch tracks a fork remote.
  return orderedRemoteValues(remotes, ["upstream", preferredRemote, "origin"], (remote) => remote.repository);
}

function selectPullRequestHeadOwners(remotes: GitHubRemote[], preferredRemote: string): string[] {
  return orderedRemoteValues(remotes, [preferredRemote, "origin", "upstream"], (remote) => remote.owner);
}

function createPullRequestLookupPlan(remoteUrls: string, upstream: string): PullRequestLookupPlan | undefined {
  const preferredRemote = parseRemoteName(upstream);
  const remotes = parseGitHubRemotes(remoteUrls);
  if (remotes.length === 0) return undefined;

  return {
    baseRepositories: selectPullRequestBaseRepositories(remotes, preferredRemote),
    headOwners: selectPullRequestHeadOwners(remotes, preferredRemote),
    allowCurrentBranchFallback: true,
  };
}

function selectPullRequest(candidates: PullRequestCandidate[], headOwners: string[]): GitInfo["pullRequest"] {
  if (candidates.length === 0 || headOwners.length === 0) return undefined;

  let bestCandidate: PullRequestCandidate | undefined;
  let bestRank = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const rank = headOwners.indexOf(candidate.headOwner);
    if (rank >= 0 && rank < bestRank) {
      bestCandidate = candidate;
      bestRank = rank;
    }
  }

  if (!bestCandidate) return undefined;

  return {
    number: bestCandidate.number,
    url: bestCandidate.url,
  };
}

function parsePullRequest(output: string): GitInfo["pullRequest"] {
  try {
    const parsed = JSON.parse(output) as { number?: unknown; url?: unknown };
    const number = Math.max(0, Math.floor(toNumber(parsed?.number)));
    const url = typeof parsed?.url === "string" ? parsed.url : "";
    if (number <= 0 || !url) return undefined;
    return { number, url };
  } catch {
    return undefined;
  }
}

function parsePullRequestCandidates(output: string): PullRequestCandidate[] {
  try {
    const parsed = JSON.parse(output) as {
      data?: {
        repository?: {
          pullRequests?: {
            nodes?: Array<{
              number?: unknown;
              url?: unknown;
              headRepositoryOwner?: { login?: unknown } | null;
            }>;
          };
        } | null;
      };
    };

    const nodes = parsed?.data?.repository?.pullRequests?.nodes;
    if (!Array.isArray(nodes)) return [];

    const candidates: PullRequestCandidate[] = [];
    for (const node of nodes) {
      const number = Math.max(0, Math.floor(toNumber(node?.number)));
      const url = typeof node?.url === "string" ? node.url : "";
      const headOwner = typeof node?.headRepositoryOwner?.login === "string" ? node.headRepositoryOwner.login : "";
      if (number <= 0 || !url) continue;
      candidates.push({ number, url, headOwner });
    }

    return candidates;
  } catch {
    return [];
  }
}

async function collectPullRequestFromBaseRepository(
  pi: ExtensionAPI,
  cwd: string,
  baseRepository: string,
  branch: string,
  headOwners: string[],
): Promise<GitInfo["pullRequest"]> {
  const repository = splitRepository(baseRepository);
  if (!repository || !branch) return undefined;

  const result = await execResult(
    pi,
    "gh",
    [
      "api",
      "graphql",
      "-f",
      `query=${PULL_REQUEST_QUERY}`,
      "-F",
      `owner=${repository.owner}`,
      "-F",
      `name=${repository.name}`,
      "-F",
      `branch=${branch}`,
    ],
    cwd,
    GITHUB_COMMAND_TIMEOUT_MS,
  );
  if (result.code !== 0 || !result.stdout) return undefined;

  return selectPullRequest(parsePullRequestCandidates(result.stdout), headOwners);
}

async function collectCurrentBranchPullRequest(
  pi: ExtensionAPI,
  cwd: string,
): Promise<GitInfo["pullRequest"]> {
  const result = await execResult(
    pi,
    "gh",
    ["pr", "view", "--json", "number,url"],
    cwd,
    GITHUB_COMMAND_TIMEOUT_MS,
  );
  if (result.code !== 0 || !result.stdout) return undefined;

  return parsePullRequest(result.stdout);
}

export function shouldRefreshPullRequest(
  git: Pick<GitInfo, "branch" | "pullRequestLookupEnabled" | "pullRequestLookupAt">,
): boolean {
  return git.pullRequestLookupEnabled && !!git.branch && Date.now() - git.pullRequestLookupAt >= PULL_REQUEST_REFRESH_MS;
}

export async function collectPullRequestInfo(
  pi: ExtensionAPI,
  cwd: string,
  branch: string,
): Promise<Pick<GitInfo, "pullRequest" | "pullRequestLookupEnabled" | "pullRequestLookupAt">> {
  if (!branch) {
    return {
      pullRequest: undefined,
      pullRequestLookupEnabled: false,
      pullRequestLookupAt: 0,
    };
  }

  const [upstream, remoteUrls] = await Promise.all([
    exec(pi, "git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"], cwd),
    exec(pi, "git", ["config", "--get-regexp", "^remote\\..*\\.url$"], cwd),
  ]);

  const plan = createPullRequestLookupPlan(remoteUrls, upstream);
  const pullRequestLookupAt = Date.now();
  if (!plan) {
    return {
      pullRequest: undefined,
      pullRequestLookupEnabled: false,
      pullRequestLookupAt,
    };
  }

  for (const baseRepository of plan.baseRepositories) {
    const pullRequest = await collectPullRequestFromBaseRepository(pi, cwd, baseRepository, branch, plan.headOwners);
    if (pullRequest) {
      return {
        pullRequest,
        pullRequestLookupEnabled: true,
        pullRequestLookupAt,
      };
    }
  }

  const fallbackPullRequest = plan.allowCurrentBranchFallback
    ? await collectCurrentBranchPullRequest(pi, cwd)
    : undefined;
  return {
    pullRequest: fallbackPullRequest,
    pullRequestLookupEnabled: true,
    pullRequestLookupAt,
  };
}

export async function collectGitInfo(
  pi: ExtensionAPI,
  cwd: string,
  previousGit: Pick<GitInfo, "repository" | "branch" | "pullRequest" | "pullRequestLookupEnabled" | "pullRequestLookupAt"> | undefined = undefined,
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

  const remotes = parseGitHubRemotes(remoteUrls);
  const repository = selectGitHubRepository(remotes, parseRemoteName(upstream));
  const pullRequestLookupEnabled = remotes.length > 0;
  const samePullRequestTarget = previousGit !== undefined
    && previousGit.repository === repository
    && previousGit.branch === branch;

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
    pullRequest: samePullRequestTarget ? previousGit?.pullRequest : undefined,
    pullRequestLookupEnabled,
    pullRequestLookupAt: samePullRequestTarget ? previousGit?.pullRequestLookupAt ?? 0 : 0,
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
