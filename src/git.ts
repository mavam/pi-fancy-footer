import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  createGitHubRepositoryContext,
  parsePullRequest,
  selectPullRequestFromGraphQL,
  splitGitHubRepository,
} from "./pull-request.ts";
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
const GITHUB_COMMAND_TIMEOUT_MS = 5_000;
const PULL_REQUEST_REFRESH_MS = 60_000;
const GIT_NO_OPTIONAL_LOCKS_ARG = "--no-optional-locks";
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

async function collectPullRequestFromBaseRepository(
  pi: ExtensionAPI,
  cwd: string,
  baseRepository: string,
  branch: string,
  headOwners: string[],
): Promise<GitInfo["pullRequest"]> {
  const repository = splitGitHubRepository(baseRepository);
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

  return selectPullRequestFromGraphQL(result.stdout, headOwners);
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
  git: Pick<
    GitInfo,
    "branch" | "pullRequestLookupEnabled" | "pullRequestLookupAt"
  >,
): boolean {
  return (
    git.pullRequestLookupEnabled &&
    !!git.branch &&
    Date.now() - git.pullRequestLookupAt >= PULL_REQUEST_REFRESH_MS
  );
}

export async function collectPullRequestInfo(
  pi: ExtensionAPI,
  cwd: string,
  branch: string,
): Promise<
  Pick<
    GitInfo,
    "pullRequest" | "pullRequestLookupEnabled" | "pullRequestLookupAt"
  >
> {
  if (!branch) {
    return {
      pullRequest: undefined,
      pullRequestLookupEnabled: false,
      pullRequestLookupAt: 0,
    };
  }

  const [upstream, remoteUrls] = await Promise.all([
    execGit(
      pi,
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      cwd,
    ),
    execGit(pi, ["config", "--get-regexp", "^remote\\..*\\.url$"], cwd),
  ]);

  const repositoryContext = createGitHubRepositoryContext(remoteUrls, upstream);
  const plan = repositoryContext.pullRequestLookupPlan;
  const pullRequestLookupAt = Date.now();
  if (!plan) {
    return {
      pullRequest: undefined,
      pullRequestLookupEnabled: repositoryContext.pullRequestLookupEnabled,
      pullRequestLookupAt,
    };
  }

  for (const baseRepository of plan.baseRepositories) {
    const pullRequest = await collectPullRequestFromBaseRepository(
      pi,
      cwd,
      baseRepository,
      branch,
      plan.headOwners,
    );
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
  previousGit:
    | Pick<
        GitInfo,
        | "repository"
        | "branch"
        | "pullRequest"
        | "pullRequestLookupEnabled"
        | "pullRequestLookupAt"
      >
    | undefined = undefined,
): Promise<GitInfo> {
  const [porcelainV2, remoteUrls] = await Promise.all([
    execGit(pi, ["status", "--porcelain=2", "--branch"], cwd),
    execGit(pi, ["config", "--get-regexp", "^remote\\..*\\.url$"], cwd),
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

  const repositoryContext = createGitHubRepositoryContext(remoteUrls, upstream);
  const samePullRequestTarget =
    previousGit !== undefined &&
    previousGit.repository === repositoryContext.repository &&
    previousGit.branch === branch;

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
    repository: repositoryContext.repository,
    branch,
    commit,
    pullRequest: samePullRequestTarget ? previousGit?.pullRequest : undefined,
    pullRequestLookupEnabled: repositoryContext.pullRequestLookupEnabled,
    pullRequestLookupAt: samePullRequestTarget
      ? (previousGit?.pullRequestLookupAt ?? 0)
      : 0,
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
