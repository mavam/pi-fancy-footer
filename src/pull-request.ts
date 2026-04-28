import { type GitHubPullRequest, parseGitHubRemote, toNumber } from "./shared.ts";

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

export interface GitHubPullRequestLocation {
  owner: string;
  name: string;
  number: number;
}

export interface PullRequestReviewThreadsPage {
  unresolvedCount: number;
  hasNextPage: boolean;
  endCursor: string;
}

export interface PullRequestLookupPlan {
  baseRepositories: string[];
  headOwners: string[];
  allowCurrentBranchFallback: boolean;
}

export interface GitHubRepositoryContext {
  repository: string;
  pullRequestLookupEnabled: boolean;
  pullRequestLookupPlan: PullRequestLookupPlan | undefined;
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

function createPullRequestLookupPlan(remotes: GitHubRemote[], preferredRemote: string): PullRequestLookupPlan | undefined {
  if (remotes.length === 0) return undefined;

  return {
    baseRepositories: selectPullRequestBaseRepositories(remotes, preferredRemote),
    headOwners: selectPullRequestHeadOwners(remotes, preferredRemote),
    allowCurrentBranchFallback: true,
  };
}

function selectPullRequest(candidates: PullRequestCandidate[], headOwners: string[]): GitHubPullRequest | undefined {
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

export function createGitHubRepositoryContext(remoteUrls: string, upstream: string): GitHubRepositoryContext {
  const preferredRemote = parseRemoteName(upstream);
  const remotes = parseGitHubRemotes(remoteUrls);

  return {
    repository: selectGitHubRepository(remotes, preferredRemote),
    pullRequestLookupEnabled: remotes.length > 0,
    pullRequestLookupPlan: createPullRequestLookupPlan(remotes, preferredRemote),
  };
}

export function splitGitHubRepository(repository: string): { owner: string; name: string } | undefined {
  const slash = repository.indexOf("/");
  if (slash <= 0 || slash >= repository.length - 1) return undefined;
  return {
    owner: repository.slice(0, slash),
    name: repository.slice(slash + 1),
  };
}

export function parsePullRequest(output: string): GitHubPullRequest | undefined {
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

export function parseGitHubPullRequestUrl(
  url: string,
): GitHubPullRequestLocation | undefined {
  const match = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/,
  );
  if (!match) return undefined;

  const [, owner, name, numberText] = match;
  const number = Math.max(0, Math.floor(toNumber(numberText)));
  if (!owner || !name || number <= 0) return undefined;
  return { owner, name, number };
}

export function parsePullRequestReviewThreadsPage(
  output: string,
): PullRequestReviewThreadsPage | undefined {
  try {
    const parsed = JSON.parse(output) as {
      data?: {
        repository?: {
          pullRequest?: {
            reviewThreads?: {
              pageInfo?: {
                hasNextPage?: unknown;
                endCursor?: unknown;
              };
              nodes?: Array<{ isResolved?: unknown }>;
            };
          } | null;
        } | null;
      };
    };

    const reviewThreads = parsed?.data?.repository?.pullRequest?.reviewThreads;
    const nodes = reviewThreads?.nodes;
    if (!Array.isArray(nodes)) return undefined;

    return {
      unresolvedCount: nodes.filter((node) => node?.isResolved === false)
        .length,
      hasNextPage: reviewThreads?.pageInfo?.hasNextPage === true,
      endCursor:
        typeof reviewThreads?.pageInfo?.endCursor === "string"
          ? reviewThreads.pageInfo.endCursor
          : "",
    };
  } catch {
    return undefined;
  }
}

export function selectPullRequestFromGraphQL(
  output: string,
  headOwners: string[],
): GitHubPullRequest | undefined {
  return selectPullRequest(parsePullRequestCandidates(output), headOwners);
}
