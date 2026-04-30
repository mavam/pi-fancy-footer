import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkflowRunsPath, selectPullRequestCiStatus } from "./ci.ts";

function runs(workflowRuns: unknown[]) {
  return JSON.stringify({ workflow_runs: workflowRuns });
}

test("selectPullRequestCiStatus reports failed as soon as one workflow failed", () => {
  assert.deepEqual(
    selectPullRequestCiStatus(
      runs([
        {
          status: "in_progress",
          conclusion: null,
          html_url: "https://github.com/org/repo/actions/runs/1",
          updated_at: "2026-01-01T10:00:00Z",
        },
        {
          status: "completed",
          conclusion: "failure",
          html_url: "https://github.com/org/repo/actions/runs/2",
          updated_at: "2026-01-01T09:00:00Z",
        },
      ]),
    ),
    { state: "failed", url: "https://github.com/org/repo/actions/runs/2" },
  );
});

test("selectPullRequestCiStatus reports running when workflows are active and none failed", () => {
  assert.deepEqual(
    selectPullRequestCiStatus(
      runs([
        {
          status: "queued",
          conclusion: null,
          html_url: "https://github.com/org/repo/actions/runs/3",
          updated_at: "2026-01-01T10:00:00Z",
        },
      ]),
    ),
    { state: "running", url: "https://github.com/org/repo/actions/runs/3" },
  );
});

test("selectPullRequestCiStatus reports okay for completed non-failing workflows", () => {
  assert.deepEqual(
    selectPullRequestCiStatus(
      runs([
        {
          status: "completed",
          conclusion: "success",
          html_url: "https://github.com/org/repo/actions/runs/4",
          updated_at: "2026-01-01T10:00:00Z",
        },
        {
          status: "completed",
          conclusion: "skipped",
          html_url: "https://github.com/org/repo/actions/runs/5",
          updated_at: "2026-01-01T09:00:00Z",
        },
      ]),
    ),
    { state: "okay", url: "https://github.com/org/repo/actions/runs/4" },
  );
});

test("selectPullRequestCiStatus hides malformed or empty responses", () => {
  assert.equal(selectPullRequestCiStatus("not json"), undefined);
  assert.equal(selectPullRequestCiStatus(runs([])), undefined);
});

test("buildWorkflowRunsPath creates GitHub Actions runs endpoint", () => {
  assert.equal(
    buildWorkflowRunsPath("https://github.com/org/repo/pull/42", "abc123"),
    "repos/org/repo/actions/runs?head_sha=abc123&per_page=100",
  );
  assert.equal(
    buildWorkflowRunsPath("https://example.com/x/y/pull/1", "abc"),
    undefined,
  );
});
