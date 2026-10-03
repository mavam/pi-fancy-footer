import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage, Usage } from "@earendil-works/pi-ai";
import type { ConversationView, EntryRecord } from "@earendil-works/pi-durable";
import { durableContextTokens, durableUsageMetrics } from "./durable.ts";

const usage: Usage = { input: 80, output: 20, cacheRead: 100, cacheWrite: 10, totalTokens: 210,
  cost: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1, total: 4 } };
function assistant(id: number, stopReason = "stop"): EntryRecord {
  return { id, kind: "pi.assistant", model: [{ role: "assistant", usage, stopReason } as AssistantMessage] } as EntryRecord;
}
function view(entries: EntryRecord[] = [], docs: ConversationView["docs"] = {}): ConversationView {
  return { conversation: { id: 1 }, entries, docs } as ConversationView;
}

test("durable totals include history and tool spend that are absent from the active transcript", () => {
  const value = view([assistant(1)], { "pi.usage": { models: { main: usage, compaction: usage }, tools: { nested: usage } } });
  assert.deepEqual(durableUsageMetrics(value), {
    latest: { input: 80, cacheRead: 100, cacheWrite: 10, cost: 4 },
    totalCost: 12, totalCacheRead: 300, totalCacheWrite: 30,
  });
});

test("compacted kept entries cannot supply post-compaction context usage", () => {
  const value = view([{ id: 5, kind: "pi.compaction" } as EntryRecord, assistant(3)]);
  assert.equal(durableContextTokens(value), null);
  assert.equal(durableContextTokens(view([...value.entries, assistant(6)])), 210);
});

test("reset, interrupted answers, and empty conversations keep context usage unknown", () => {
  assert.equal(durableContextTokens(view()), null);
  assert.equal(durableContextTokens(view([assistant(1), { id: 2, kind: "pi.reset" } as EntryRecord])), null);
  assert.equal(durableContextTokens(view([assistant(1, "aborted"), assistant(2, "error")])), null);
});

test("failed answers do not replace the latest successful prompt's cache metrics", () => {
  assert.deepEqual(durableUsageMetrics(view([assistant(1), assistant(2, "aborted")])).latest,
    { input: 80, cacheRead: 100, cacheWrite: 10, cost: 4 });
});
