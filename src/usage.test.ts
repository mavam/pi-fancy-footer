import assert from "node:assert/strict";
import test from "node:test";
import type { Usage } from "@earendil-works/pi-ai";
import type {
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { collectSessionUsageMetrics } from "./render.ts";

function usage(cost = 1, cacheRead = 100, cacheWrite = 10): Usage {
  return {
    input: 90,
    output: 5,
    cacheRead,
    cacheWrite,
    totalTokens: 95 + cacheRead + cacheWrite,
    cost: { input: cost, output: 0, cacheRead: 0, cacheWrite: 0, total: cost },
  };
}

function entry(id: string, fields: Record<string, unknown>): SessionEntry {
  return {
    id,
    parentId: null,
    timestamp: "2026-09-30T12:00:00Z",
    ...fields,
  } as unknown as SessionEntry;
}

function assistant(id: string, value: Usage): SessionEntry {
  return entry(id, {
    type: "message",
    message: { role: "assistant", usage: value },
  });
}

function context(
  entries: SessionEntry[],
  branch = entries,
): ExtensionContext {
  return {
    sessionManager: {
      getSessionId: () => "session",
      getLeafId: () => branch.at(-1)?.id ?? null,
      getEntryCount: () => entries.length,
      getEntries: () => entries,
      getBranch: () => branch,
    },
  } as unknown as ExtensionContext;
}

test("session totals include every recorded usage source, not nested metadata", () => {
  const main = assistant("main", usage(1, 100, 10));
  const entries = [
    main,
    entry("codemode", {
      type: "message",
      message: {
        role: "toolResult",
        toolName: "codemode",
        usage: usage(2, 200, 20),
        details: { usage: usage(100, 10_000, 1_000) },
        nestedCalls: {
          complete: true,
          calls: [{ toolName: "classifier", cost: 2 }],
        },
      },
    }),
    entry("warming", {
      type: "usage",
      kind: "cache_warm",
      usage: usage(3, 300, 30),
    }),
    entry("compact", { type: "compaction", usage: usage(4, 400, 40) }),
    entry("summary", { type: "branch_summary", usage: usage(5, 500, 50) }),
    // Unrelated entries/messages are not billable usage sources.
    entry("custom", { type: "custom", usage: usage(100) }),
    entry("user", {
      type: "message",
      message: { role: "user", usage: usage(100) },
    }),
  ];

  assert.deepEqual(collectSessionUsageMetrics(context(entries)), {
    latest: { input: 90, cacheRead: 100, cacheWrite: 10, cost: 1 },
    totalCost: 15,
    totalCacheRead: 1500,
    totalCacheWrite: 150,
  });
});

test("totals cover other branches while latest usage follows only the active branch", () => {
  const root = assistant("root", usage(1, 100, 10));
  const current = assistant("current", usage(2, 200, 20));
  const other = assistant("other", usage(3, 30_000, 3_000));
  const entries = [root, current, other];

  assert.deepEqual(collectSessionUsageMetrics(context(entries, [root, current])), {
    latest: { input: 90, cacheRead: 200, cacheWrite: 20, cost: 2 },
    totalCost: 6,
    totalCacheRead: 30_300,
    totalCacheWrite: 3030,
  });
});

test("an empty active branch never borrows another branch's prompt usage", () => {
  const metrics = collectSessionUsageMetrics(
    context([assistant("other", usage())], []),
  );
  assert.equal(metrics.latest, undefined);
  assert.equal(metrics.totalCost, 1);
});

test("empty and legacy sessions without optional usage fields are supported", () => {
  const empty = {
    latest: undefined,
    totalCost: 0,
    totalCacheRead: 0,
    totalCacheWrite: 0,
  };
  assert.deepEqual(collectSessionUsageMetrics(context([])), empty);

  const entries = [
    entry("read", { type: "message", message: { role: "toolResult" } }),
    entry("compact", { type: "compaction" }),
    entry("summary", { type: "branch_summary" }),
    entry("usage", { type: "usage" }),
  ];
  assert.deepEqual(collectSessionUsageMetrics(context(entries)), empty);
});

test("invalid usage values cannot produce negative or non-finite metrics", () => {
  const malformed = {
    input: NaN,
    cacheRead: -1,
    cacheWrite: Infinity,
    cost: { total: -2 },
  } as Usage;
  const entries = [
    assistant("main", malformed),
    entry("tool", {
      type: "message",
      message: { role: "toolResult", usage: malformed },
    }),
    entry("warm", { type: "usage", usage: malformed }),
  ];
  assert.deepEqual(collectSessionUsageMetrics(context(entries)), {
    latest: { input: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    totalCost: 0,
    totalCacheRead: 0,
    totalCacheWrite: 0,
  });
});

test("cached metrics refresh on appends, tree navigation, and session replacement", () => {
  let entries = [
    assistant("root", usage(1)),
    assistant("other", usage(2, 200, 20)),
  ];
  let branch = [entries[0]];
  let sessionId = "first";
  let entryReads = 0;
  let branchReads = 0;
  const ctx = {
    sessionManager: {
      getSessionId: () => sessionId,
      getLeafId: () => branch.at(-1)?.id ?? null,
      getEntryCount: () => entries.length,
      getEntries() {
        entryReads += 1;
        return entries;
      },
      getBranch() {
        branchReads += 1;
        return branch;
      },
    },
  } as unknown as ExtensionContext;

  const first = collectSessionUsageMetrics(ctx);
  assert.strictEqual(collectSessionUsageMetrics(ctx), first);
  assert.equal(entryReads, 1);
  assert.equal(branchReads, 1);

  branch = [entries[0], entries[1]];
  const navigated = collectSessionUsageMetrics(ctx);
  assert.equal(navigated.latest?.cost, 2);
  assert.equal(navigated.totalCost, 3);
  assert.notStrictEqual(navigated, first);

  // Entry count also invalidates the cache if the branch has not moved.
  entries.push(entry("warm", { type: "usage", usage: usage(3) }));
  assert.equal(collectSessionUsageMetrics(ctx).totalCost, 6);

  // A replacement can reuse leaf IDs and entry counts.
  sessionId = "second";
  entries = [
    assistant("root", usage(4)),
    assistant("other", usage(5)),
    entry("warm", { type: "usage" }),
  ];
  branch = entries.slice(0, 2);
  const replaced = collectSessionUsageMetrics(ctx);
  assert.equal(replaced.totalCost, 9);
  assert.equal(replaced.latest?.cost, 5);
});

test("older Pi versions fall back to counting entries without getEntryCount", () => {
  const entries = [assistant("main", usage())];
  const ctx = context(entries);
  delete (
    ctx.sessionManager as unknown as { getEntryCount?: () => number }
  ).getEntryCount;

  const first = collectSessionUsageMetrics(ctx);
  assert.strictEqual(collectSessionUsageMetrics(ctx), first);
  entries.push(
    entry("codemode", {
      type: "message",
      message: { role: "toolResult", usage: usage(2) },
    }),
  );
  assert.equal(collectSessionUsageMetrics(ctx).totalCost, 3);
});
