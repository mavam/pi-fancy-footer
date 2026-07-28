import {
  type GitHubPullRequest,
  type GitHubRepositoryRef,
  type PullRequestState,
  parseGitHubRemote,
  toNumber,
} from "./shared.ts";

interface GitHubRemote {
  name: string;
  ref: GitHubRepositoryRef;
}

interface PullRequestCandidate {
  number: number;
  url: string;
  state: PullRequestState;
  isDraft: boolean;
  autoMergeEnabled: boolean;
  headOwner: string;
  headRefOid?: string;
}

interface PullRequestCandidateNode {
  number?: unknown;
  url?: unknown;
  state?: unknown;
  isDraft?: unknown;
  autoMergeRequest?: unknown;
  headRefOid?: unknown;
  headRepositoryOwner?: { login?: unknown } | null;
}

interface PullRequestCandidateConnection {
  nodes?: PullRequestCandidateNode[];
}

export interface GitHubPullRequestLocation {
  host: string;
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
  baseRepositories: GitHubRepositoryRef[];
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

function parseGitHubRemotes(remoteUrls: string): GitHubRemote[] {
  const remotes: GitHubRemote[] = [];

  for (const [name, url] of parseRemoteUrls(remoteUrls)) {
    const ref = parseGitHubRemote(url);
    if (!ref) continue;
    remotes.push({ name, ref });
  }

  return remotes;
}

function orderedRemoteValues<T>(
  remotes: GitHubRemote[],
  preferredNames: string[],
  pick: (remote: GitHubRemote) => T,
  keyFor: (value: T) => string = String,
): T[] {
  const byName = new Map(remotes.map((remote) => [remote.name, remote]));
  const ordered: T[] = [];
  const seen = new Set<string>();

  for (const remoteName of [
    ...preferredNames,
    ...remotes.map((remote) => remote.name),
  ]) {
    if (!remoteName) continue;
    const remote = byName.get(remoteName);
    if (!remote) continue;
    const value = pick(remote);
    const key = keyFor(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    ordered.push(value);
  }

  return ordered;
}

function selectGitHubRepository(
  remotes: GitHubRemote[],
  preferredRemote: string,
): string {
  return (
    orderedRemoteValues(
      remotes,
      [preferredRemote, "origin", "upstream"],
      (remote) => remote.ref.repository,
    )[0] ?? ""
  );
}

function selectPullRequestBaseRepositories(
  remotes: GitHubRemote[],
  preferredRemote: string,
): GitHubRepositoryRef[] {
  // PRs often live in the upstream repo even when the branch tracks a fork remote.
  return orderedRemoteValues(
    remotes,
    ["upstream", preferredRemote, "origin"],
    (remote) => remote.ref,
    (ref) => `${ref.host}/${ref.repository}`,
  );
}

function selectPullRequestHeadOwners(
  remotes: GitHubRemote[],
  preferredRemote: string,
): string[] {
  return orderedRemoteValues(
    remotes,
    [preferredRemote, "origin", "upstream"],
    (remote) => remote.ref.owner,
  );
}

function createPullRequestLookupPlan(
  remotes: GitHubRemote[],
  preferredRemote: string,
): PullRequestLookupPlan | undefined {
  if (remotes.length === 0) return undefined;

  return {
    baseRepositories: selectPullRequestBaseRepositories(
      remotes,
      preferredRemote,
    ),
    headOwners: selectPullRequestHeadOwners(remotes, preferredRemote),
    allowCurrentBranchFallback: true,
  };
}

function parsePullRequestState(value: unknown): PullRequestState | undefined {
  if (typeof value !== "string") return undefined;
  const state = value.toLowerCase();
  return state === "open" || state === "merged" ? state : undefined;
}

function parseAutoMergeEnabled(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

function selectPullRequest(
  candidates: PullRequestCandidate[],
  headOwners: string[],
): GitHubPullRequest | undefined {
  if (candidates.length === 0 || headOwners.length === 0) return undefined;

  let bestCandidate: PullRequestCandidate | undefined;
  let bestStateRank = Number.POSITIVE_INFINITY;
  let bestOwnerRank = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const ownerRank = headOwners.indexOf(candidate.headOwner);
    if (ownerRank < 0) continue;

    // Within the most likely head owner, prefer an active PR when a branch name
    // has also been used by a merged PR.
    const stateRank = candidate.state === "open" ? 0 : 1;
    if (
      ownerRank < bestOwnerRank ||
      (ownerRank === bestOwnerRank && stateRank < bestStateRank)
    ) {
      bestCandidate = candidate;
      bestStateRank = stateRank;
      bestOwnerRank = ownerRank;
    }
  }

  if (!bestCandidate) return undefined;

  const location = parseGitHubPullRequestUrl(bestCandidate.url);

  return {
    number: bestCandidate.number,
    url: bestCandidate.url,
    state: bestCandidate.state,
    ...(bestCandidate.isDraft ? { isDraft: true } : {}),
    ...(bestCandidate.autoMergeEnabled ? { autoMergeEnabled: true } : {}),
    ...(location ? { host: location.host } : {}),
    ...(bestCandidate.headRefOid
      ? { headRefOid: bestCandidate.headRefOid }
      : {}),
  };
}

function parsePullRequestCandidates(output: string): PullRequestCandidate[] {
  try {
    const parsed = JSON.parse(output) as {
      data?: {
        repository?: {
          open?: PullRequestCandidateConnection;
          merged?: PullRequestCandidateConnection;
          pullRequests?: PullRequestCandidateConnection;
        } | null;
      };
    };

    const repository = parsed?.data?.repository;
    const nodes = [
      ...(Array.isArray(repository?.open?.nodes) ? repository.open.nodes : []),
      ...(Array.isArray(repository?.merged?.nodes)
        ? repository.merged.nodes
        : []),
      ...(Array.isArray(repository?.pullRequests?.nodes)
        ? repository.pullRequests.nodes
        : []),
    ];

    const candidates: PullRequestCandidate[] = [];
    for (const node of nodes) {
      const number = Math.max(0, Math.floor(toNumber(node?.number)));
      const url = typeof node?.url === "string" ? node.url : "";
      const state = parsePullRequestState(node?.state);
      const isDraft = node?.isDraft === true;
      const autoMergeEnabled = parseAutoMergeEnabled(node?.autoMergeRequest);
      const headOwner =
        typeof node?.headRepositoryOwner?.login === "string"
          ? node.headRepositoryOwner.login
          : "";
      const headRefOid =
        typeof node?.headRefOid === "string" ? node.headRefOid : undefined;
      if (number <= 0 || !url || !state) continue;
      candidates.push({
        number,
        url,
        state,
        isDraft,
        autoMergeEnabled,
        headOwner,
        headRefOid,
      });
    }

    return candidates;
  } catch {
    return [];
  }
}

export function createGitHubRepositoryContext(
  remoteUrls: string,
  upstream: string,
): GitHubRepositoryContext {
  const preferredRemote = parseRemoteName(upstream);
  const remotes = parseGitHubRemotes(remoteUrls);

  return {
    repository: selectGitHubRepository(remotes, preferredRemote),
    pullRequestLookupEnabled: remotes.length > 0,
    pullRequestLookupPlan: createPullRequestLookupPlan(
      remotes,
      preferredRemote,
    ),
  };
}

export function parsePullRequest(
  output: string,
): GitHubPullRequest | undefined {
  try {
    const parsed = JSON.parse(output) as {
      number?: unknown;
      url?: unknown;
      state?: unknown;
      isDraft?: unknown;
      autoMergeRequest?: unknown;
      headRefOid?: unknown;
    };
    const number = Math.max(0, Math.floor(toNumber(parsed?.number)));
    const url = typeof parsed?.url === "string" ? parsed.url : "";
    const state = parsePullRequestState(parsed?.state);
    const isDraft = parsed?.isDraft === true;
    const autoMergeEnabled = parseAutoMergeEnabled(parsed?.autoMergeRequest);
    const headRefOid =
      typeof parsed?.headRefOid === "string" ? parsed.headRefOid : undefined;
    if (number <= 0 || !url || !state) return undefined;
    const location = parseGitHubPullRequestUrl(url);
    return {
      number,
      url,
      state,
      ...(isDraft ? { isDraft: true } : {}),
      ...(autoMergeEnabled ? { autoMergeEnabled: true } : {}),
      ...(location ? { host: location.host } : {}),
      ...(headRefOid ? { headRefOid } : {}),
    };
  } catch {
    return undefined;
  }
}

export function parseGitHubPullRequestUrl(
  url: string,
): GitHubPullRequestLocation | undefined {
  const match = url.match(
    /^https:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#].*)?$/,
  );
  if (!match) return undefined;

  const [, rawHost, owner, name, numberText] = match;
  const hostRef = parseGitHubRemote(`https://${rawHost}/${owner}/${name}.git`);
  const number = Math.max(0, Math.floor(toNumber(numberText)));
  if (!hostRef || number <= 0) return undefined;
  return { host: hostRef.host, owner, name, number };
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
