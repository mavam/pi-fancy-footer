import { parseGitHubPullRequestUrl } from "./pull-request.ts";

export type PullRequestCiState = "running" | "failed" | "okay";

export interface PullRequestCiStatus {
  state: PullRequestCiState;
  url: string;
}

interface WorkflowRun {
  status: string;
  conclusion: string;
  url: string;
  updatedAt: string;
}

const FAILED_CONCLUSIONS = new Set([
  "action_required",
  "cancelled",
  "failure",
  "startup_failure",
  "timed_out",
]);

const RUNNING_STATUSES = new Set([
  "in_progress",
  "pending",
  "queued",
  "requested",
  "waiting",
]);

function parseWorkflowRuns(output: string): WorkflowRun[] {
  try {
    const parsed = JSON.parse(output) as {
      workflow_runs?: Array<{
        status?: unknown;
        conclusion?: unknown;
        html_url?: unknown;
        updated_at?: unknown;
      }>;
    };
    const runs = parsed.workflow_runs;
    if (!Array.isArray(runs)) return [];

    return runs
      .map((run) => ({
        status: typeof run.status === "string" ? run.status : "",
        conclusion: typeof run.conclusion === "string" ? run.conclusion : "",
        url: typeof run.html_url === "string" ? run.html_url : "",
        updatedAt: typeof run.updated_at === "string" ? run.updated_at : "",
      }))
      .filter((run) => run.url !== "");
  } catch {
    return [];
  }
}

function newestFirst(runs: WorkflowRun[]): WorkflowRun[] {
  return [...runs].sort((a, b) => {
    const at = Date.parse(a.updatedAt);
    const bt = Date.parse(b.updatedAt);
    return (Number.isFinite(bt) ? bt : 0) - (Number.isFinite(at) ? at : 0);
  });
}

export function selectPullRequestCiStatus(
  output: string,
): PullRequestCiStatus | undefined {
  const runs = newestFirst(parseWorkflowRuns(output));
  if (runs.length === 0) return undefined;

  const failed = runs.find((run) => FAILED_CONCLUSIONS.has(run.conclusion));
  if (failed) return { state: "failed", url: failed.url };

  const running = runs.find((run) => RUNNING_STATUSES.has(run.status));
  if (running) return { state: "running", url: running.url };

  return { state: "okay", url: runs[0]!.url };
}

export function buildWorkflowRunsPath(
  pullRequestUrl: string,
  headRefOid: string,
): string | undefined {
  const location = parseGitHubPullRequestUrl(pullRequestUrl);
  if (!location || !headRefOid) return undefined;
  const headSha = encodeURIComponent(headRefOid);
  return `repos/${location.owner}/${location.name}/actions/runs?head_sha=${headSha}&per_page=100`;
}
