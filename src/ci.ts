import { parseGitHubPullRequestUrl } from "./pull-request.ts";

export type PullRequestCiState = "running" | "failed" | "okay";

export interface PullRequestCiStatus {
  state: PullRequestCiState;
  url: string;
}

interface WorkflowRun {
  workflowId: number;
  runNumber: number;
  runAttempt: number;
  status: string;
  conclusion: string;
  url: string;
  createdAt: string;
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

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value > 0
  );
}

function parseWorkflowRuns(output: string): WorkflowRun[] {
  try {
    const parsed = JSON.parse(output) as { workflow_runs?: unknown };
    if (!Array.isArray(parsed.workflow_runs)) return [];

    return parsed.workflow_runs.flatMap((value) => {
      if (typeof value !== "object" || value === null) return [];
      const run = value as Record<string, unknown>;
      if (
        !isPositiveSafeInteger(run.workflow_id) ||
        !isPositiveSafeInteger(run.run_number) ||
        typeof run.status !== "string" ||
        typeof run.html_url !== "string" ||
        run.html_url === ""
      ) {
        return [];
      }

      return [
        {
          workflowId: run.workflow_id,
          runNumber: run.run_number,
          runAttempt: isPositiveSafeInteger(run.run_attempt)
            ? run.run_attempt
            : 0,
          status: run.status,
          conclusion:
            typeof run.conclusion === "string" ? run.conclusion : "",
          url: run.html_url,
          createdAt:
            typeof run.created_at === "string" ? run.created_at : "",
          updatedAt:
            typeof run.updated_at === "string" ? run.updated_at : "",
        },
      ];
    });
  } catch {
    return [];
  }
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareWorkflowRunRecency(a: WorkflowRun, b: WorkflowRun): number {
  return (
    a.runNumber - b.runNumber ||
    a.runAttempt - b.runAttempt ||
    timestamp(a.createdAt) - timestamp(b.createdAt) ||
    timestamp(a.updatedAt) - timestamp(b.updatedAt)
  );
}

function latestWorkflowRuns(runs: WorkflowRun[]): WorkflowRun[] {
  const latest = new Map<number, WorkflowRun>();
  for (const run of runs) {
    const previous = latest.get(run.workflowId);
    if (!previous || compareWorkflowRunRecency(run, previous) > 0) {
      latest.set(run.workflowId, run);
    }
  }
  return [...latest.values()];
}

function newestFirst(runs: WorkflowRun[]): WorkflowRun[] {
  return [...runs].sort(
    (a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt),
  );
}

export function selectPullRequestCiStatus(
  output: string,
): PullRequestCiStatus | undefined {
  const runs = newestFirst(latestWorkflowRuns(parseWorkflowRuns(output)));
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
