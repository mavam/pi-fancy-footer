import assert from "node:assert/strict";
import test from "node:test";
import { selectPullRequestCiStatus } from "./ci.ts";

function checks(statusChecks: unknown[]) {
  return JSON.stringify(statusChecks);
}

test("selectPullRequestCiStatus keeps a failed PR check when a later check passes", () => {
  assert.deepEqual(
    selectPullRequestCiStatus(
      checks([
        {
          bucket: "fail",
          link: "https://github.com/org/repo/actions/runs/1/job/1",
          startedAt: "2026-01-01T09:00:00Z",
          completedAt: "2026-01-01T09:30:00Z",
        },
        {
          bucket: "pass",
          link: "https://github.com/org/repo/actions/runs/2/job/2",
          startedAt: "2026-01-01T10:00:00Z",
          completedAt: "2026-01-01T10:30:00Z",
        },
      ]),
    ),
    {
      state: "failed",
      url: "https://github.com/org/repo/actions/runs/1/job/1",
    },
  );
});

test("selectPullRequestCiStatus reports running when no PR check failed", () => {
  assert.deepEqual(
    selectPullRequestCiStatus(
      checks([
        {
          bucket: "pass",
          link: "https://github.com/org/repo/actions/runs/3/job/3",
          startedAt: "2026-01-01T09:00:00Z",
          completedAt: "2026-01-01T09:30:00Z",
        },
        {
          bucket: "pending",
          link: "https://github.com/org/repo/actions/runs/4/job/4",
          startedAt: "2026-01-01T10:00:00Z",
          completedAt: "",
        },
      ]),
    ),
    {
      state: "running",
      url: "https://github.com/org/repo/actions/runs/4/job/4",
    },
  );
});

test("selectPullRequestCiStatus reports okay for passing and skipped checks", () => {
  assert.deepEqual(
    selectPullRequestCiStatus(
      checks([
        {
          bucket: "skipping",
          link: "https://github.com/org/repo/actions/runs/5/job/5",
          startedAt: "2026-01-01T09:00:00Z",
          completedAt: "2026-01-01T09:01:00Z",
        },
        {
          bucket: "pass",
          link: "https://ci.example.com/check/6",
          startedAt: "2026-01-01T10:00:00Z",
          completedAt: "2026-01-01T10:30:00Z",
        },
      ]),
    ),
    { state: "okay", url: "https://ci.example.com/check/6" },
  );
});

test("selectPullRequestCiStatus treats cancelled checks as failed", () => {
  assert.deepEqual(
    selectPullRequestCiStatus(
      checks([
        {
          bucket: "cancel",
          link: "",
          startedAt: "2026-01-01T10:00:00Z",
          completedAt: "2026-01-01T10:01:00Z",
        },
      ]),
      "https://github.com/org/repo/pull/42",
    ),
    { state: "failed", url: "https://github.com/org/repo/pull/42" },
  );
});

test("selectPullRequestCiStatus hides malformed or empty check output", () => {
  assert.equal(selectPullRequestCiStatus("not json"), undefined);
  assert.equal(selectPullRequestCiStatus("{}"), undefined);
  assert.equal(selectPullRequestCiStatus(checks([])), undefined);
  assert.equal(selectPullRequestCiStatus(checks([null])), undefined);
  assert.equal(
    selectPullRequestCiStatus(checks([{ bucket: "unknown", link: "" }])),
    undefined,
  );
});
