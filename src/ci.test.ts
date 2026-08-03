import assert from "node:assert/strict";
import test from "node:test";
import { buildWorkflowRunsPath, selectPullRequestCiStatus } from "./ci.ts";

function runs(workflowRuns: unknown[]) {
  return JSON.stringify({ workflow_runs: workflowRuns });
}

test("selectPullRequestCiStatus ignores a failure superseded by a successful run", () => {
  assert.deepEqual(
    selectPullRequestCiStatus(
      runs([
        {
          workflow_id: 1,
          run_number: 10,
          status: "completed",
          conclusion: "failure",
          html_url: "https://github.com/org/repo/actions/runs/1",
          created_at: "2026-01-01T09:00:00Z",
          updated_at: "2026-01-01T11:00:00Z",
        },
        {
          workflow_id: 1,
          run_number: 11,
          status: "completed",
          conclusion: "success",
          html_url: "https://github.com/org/repo/actions/runs/2",
          created_at: "2026-01-01T10:00:00Z",
          updated_at: "2026-01-01T10:30:00Z",
        },
      ]),
    ),
    { state: "okay", url: "https://github.com/org/repo/actions/runs/2" },
  );
});

test("selectPullRequestCiStatus reports a newer run as running", () => {
  assert.deepEqual(
    selectPullRequestCiStatus(
      runs([
        {
          workflow_id: 1,
          run_number: 20,
          status: "completed",
          conclusion: "failure",
          html_url: "https://github.com/org/repo/actions/runs/3",
          created_at: "2026-01-01T09:00:00Z",
          updated_at: "2026-01-01T09:30:00Z",
        },
        {
          workflow_id: 1,
          run_number: 21,
          status: "in_progress",
          conclusion: null,
          html_url: "https://github.com/org/repo/actions/runs/4",
          created_at: "2026-01-01T10:00:00Z",
          updated_at: "2026-01-01T10:01:00Z",
        },
      ]),
    ),
    { state: "running", url: "https://github.com/org/repo/actions/runs/4" },
  );
});

test("selectPullRequestCiStatus reports a current failure across workflows", () => {
  assert.deepEqual(
    selectPullRequestCiStatus(
      runs([
        {
          workflow_id: 1,
          run_number: 30,
          status: "completed",
          conclusion: "success",
          html_url: "https://github.com/org/repo/actions/runs/5",
          created_at: "2026-01-01T10:00:00Z",
          updated_at: "2026-01-01T10:30:00Z",
        },
        {
          workflow_id: 2,
          run_number: 40,
          status: "completed",
          conclusion: "failure",
          html_url: "https://github.com/org/repo/actions/runs/6",
          created_at: "2026-01-01T11:00:00Z",
          updated_at: "2026-01-01T11:30:00Z",
        },
        {
          workflow_id: 3,
          run_number: 50,
          status: "completed",
          conclusion: "skipped",
          html_url: "https://github.com/org/repo/actions/runs/7",
          created_at: "2026-01-01T12:00:00Z",
          updated_at: "2026-01-01T12:01:00Z",
        },
      ]),
    ),
    { state: "failed", url: "https://github.com/org/repo/actions/runs/6" },
  );
});

test("selectPullRequestCiStatus reports okay for successful and skipped workflows", () => {
  assert.deepEqual(
    selectPullRequestCiStatus(
      runs([
        {
          workflow_id: 1,
          run_number: 60,
          status: "completed",
          conclusion: "success",
          html_url: "https://github.com/org/repo/actions/runs/8",
          created_at: "2026-01-01T10:00:00Z",
          updated_at: "2026-01-01T10:00:00Z",
        },
        {
          workflow_id: 2,
          run_number: 70,
          status: "completed",
          conclusion: "skipped",
          html_url: "https://github.com/org/repo/actions/runs/9",
          created_at: "2026-01-01T09:00:00Z",
          updated_at: "2026-01-01T09:00:00Z",
        },
      ]),
    ),
    { state: "okay", url: "https://github.com/org/repo/actions/runs/8" },
  );
});

test("selectPullRequestCiStatus hides malformed or empty responses", () => {
  assert.equal(selectPullRequestCiStatus("not json"), undefined);
  assert.equal(selectPullRequestCiStatus("{}"), undefined);
  assert.equal(selectPullRequestCiStatus(runs([])), undefined);
  assert.equal(
    selectPullRequestCiStatus(
      runs([
        null,
        {},
        {
          workflow_id: "1",
          run_number: 1,
          status: "completed",
          conclusion: "success",
          html_url: "https://github.com/org/repo/actions/runs/10",
        },
        {
          workflow_id: 1,
          status: "completed",
          conclusion: "success",
          html_url: "https://github.com/org/repo/actions/runs/11",
        },
      ]),
    ),
    undefined,
  );
});

test("buildWorkflowRunsPath creates GitHub Actions runs endpoint", () => {
  assert.equal(
    buildWorkflowRunsPath("https://github.com/org/repo/pull/42", "abc123"),
    "repos/org/repo/actions/runs?head_sha=abc123&per_page=100",
  );
  assert.equal(
    buildWorkflowRunsPath(
      "https://github.example.com/org/repo/pull/42",
      "abc123",
    ),
    "repos/org/repo/actions/runs?head_sha=abc123&per_page=100",
  );
  assert.equal(
    buildWorkflowRunsPath("https://example.com/x/y/pull/1", "abc"),
    undefined,
  );
});
