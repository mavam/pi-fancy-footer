import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildProviderStatusGauge,
  collectProviderStatus,
  formatProviderStatusText,
  normalizeCodexUsageResponse,
  parseCodexRateLimitHeaders,
  providerStatusColor,
  updateProviderStatusFromHeaders,
} from "./provider-status.ts";
import {
  getGaugeStyle,
  type ProviderStatusConfigSnapshot,
} from "./shared.ts";

const now = new Date("2026-05-06T10:00:00Z");
const providerStatusConfig: ProviderStatusConfigSnapshot = {
  refreshMs: 60_000,
  cacheTtlMs: 60_000,
  providers: ["openai-codex"],
  display: "gauge",
  showCredits: false,
  showReset: false,
};

test("normalizeCodexUsageResponse extracts primary and secondary quota windows", () => {
  const snapshot = normalizeCodexUsageResponse(
    {
      rate_limit: {
        primary_window: {
          used_percent: 5,
          reset_at: 1_778_064_000,
        },
        secondary_window: {
          used_percent: 12.5,
          reset_at: 1_778_150_400,
        },
      },
      credits: {
        balance: "553.9",
      },
    },
    now,
  );

  assert.deepEqual(snapshot?.primary, {
    label: "5h",
    usedPercent: 5,
    leftPercent: 95,
    resetAt: 1_778_064_000,
  });
  assert.deepEqual(snapshot?.secondary, {
    label: "7d",
    usedPercent: 12.5,
    leftPercent: 87.5,
    resetAt: 1_778_150_400,
  });
  assert.equal(snapshot?.credits, "553.9");
  assert.equal(snapshot?.state, "ok");
});

test("parseCodexRateLimitHeaders accepts case-insensitive x-codex headers", () => {
  const snapshot = parseCodexRateLimitHeaders(
    {
      "X-Codex-Primary-Used-Percent": "76",
      "x-codex-secondary-used-percent": 10,
      "x-codex-credits-balance": "42",
    },
    now,
  );

  assert.equal(snapshot?.primary?.leftPercent, 24);
  assert.equal(snapshot?.secondary?.leftPercent, 90);
  assert.equal(snapshot?.credits, "42");
  assert.equal(snapshot?.state, "error");
});

test("formatProviderStatusText keeps default output provider-neutral", () => {
  const snapshot = normalizeCodexUsageResponse(
    {
      rate_limit: {
        primary_window: { used_percent: 5 },
        secondary_window: { used_percent: 3 },
      },
      credits: { balance: "553" },
    },
    now,
  );

  assert.equal(
    formatProviderStatusText(snapshot, {
      showCredits: false,
      showReset: false,
    }),
    "5h:95% 7d:97%",
  );
});

test("formatProviderStatusText supports optional credits and reset time", () => {
  const snapshot = normalizeCodexUsageResponse(
    {
      rate_limit: {
        primary_window: { used_percent: 50, reset_at: 1_778_064_000 },
      },
      credits: { balance: "12" },
    },
    now,
  );

  assert.match(
    formatProviderStatusText(snapshot, {
      showCredits: true,
      showReset: true,
    }),
    /^5h:50% reset:\d\d:\d\d cr:12$/,
  );
});

test("formatProviderStatusText can show provider-specific credits without windows", () => {
  const snapshot = parseCodexRateLimitHeaders(
    {
      "x-codex-credits-balance": "42",
    },
    now,
  );

  assert.equal(
    formatProviderStatusText(snapshot, {
      showCredits: true,
      showReset: false,
    }),
    "cr:42",
  );
});

test("providerStatusColor derives semantic color from status", () => {
  assert.equal(
    providerStatusColor(
      normalizeCodexUsageResponse(
        { rate_limit: { primary_window: { used_percent: 5 } } },
        now,
      ),
    ),
    "success",
  );
  assert.equal(
    providerStatusColor(
      normalizeCodexUsageResponse(
        { rate_limit: { primary_window: { used_percent: 50 } } },
        now,
      ),
    ),
    "warning",
  );
  assert.equal(
    providerStatusColor(
      normalizeCodexUsageResponse(
        { rate_limit: { primary_window: { used_percent: 90 } } },
        now,
      ),
    ),
    "error",
  );
});

test("collectProviderStatus does not present expired cache as live status after refresh failure", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-fancy-footer-test-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const previousHome = process.env.HOME;
  const previousXdgCacheHome = process.env.XDG_CACHE_HOME;
  process.env.HOME = dir;
  process.env.XDG_CACHE_HOME = join(dir, "cache");
  t.after(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousXdgCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousXdgCacheHome;
  });

  const cachePath = join(
    process.env.XDG_CACHE_HOME,
    "pi-fancy-footer",
    "provider-status",
    "openai-codex.json",
  );
  await mkdir(
    join(process.env.XDG_CACHE_HOME, "pi-fancy-footer", "provider-status"),
    { recursive: true },
  );
  await writeFile(
    cachePath,
    JSON.stringify({
      provider: "openai-codex",
      source: "api",
      fetchedAt: "2026-05-06T09:00:00Z",
      state: "ok",
      primary: { usedPercent: 5, leftPercent: 95 },
      url: "https://chatgpt.com/codex/settings/usage",
    }),
    { mode: 0o600 },
  );

  const snapshots = await collectProviderStatus({} as never, {
    ...providerStatusConfig,
    cacheTtlMs: 1,
  });

  assert.equal(snapshots.length, 1);
  const snapshot = snapshots[0];
  assert.equal(snapshot?.state, "unavailable");
  assert.equal(snapshot?.primary, undefined);
  assert.match(snapshot?.error ?? "", /No usable Codex OAuth credentials/);
});

test("updateProviderStatusFromHeaders honors disabled providers", async () => {
  const updated = await updateProviderStatusFromHeaders(
    {
      "x-codex-primary-used-percent": "5",
    },
    {
      ...providerStatusConfig,
      providers: [],
    },
  );

  assert.deepEqual(updated, []);
});

test("updateProviderStatusFromHeaders does not merge expired cached windows", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-fancy-footer-test-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const previousXdgCacheHome = process.env.XDG_CACHE_HOME;
  process.env.XDG_CACHE_HOME = join(dir, "cache");
  t.after(() => {
    if (previousXdgCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousXdgCacheHome;
  });

  const cacheDir = join(
    process.env.XDG_CACHE_HOME,
    "pi-fancy-footer",
    "provider-status",
  );
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    join(cacheDir, "openai-codex.json"),
    JSON.stringify({
      provider: "openai-codex",
      source: "api",
      fetchedAt: "2026-05-06T09:00:00Z",
      state: "ok",
      primary: { usedPercent: 5, leftPercent: 95 },
      url: "https://chatgpt.com/codex/settings/usage",
    }),
    { mode: 0o600 },
  );

  const updated = await updateProviderStatusFromHeaders(
    {
      "x-codex-credits-balance": "42",
    },
    {
      ...providerStatusConfig,
      cacheTtlMs: 1,
    },
  );

  assert.equal(updated.length, 1);
  const snapshot = updated[0];
  assert.equal(snapshot?.primary, undefined);
  assert.equal(snapshot?.credits, "42");
  assert.equal(snapshot?.state, "unavailable");
});

test("buildProviderStatusGauge renders battery-style cells per window", () => {
  const snapshot = normalizeCodexUsageResponse(
    {
      rate_limit: {
        primary_window: { used_percent: 20 },
        secondary_window: { used_percent: 90 },
      },
    },
    now,
  );

  const segments = buildProviderStatusGauge(
    snapshot,
    getGaugeStyle("parallelograms"),
    5,
  );

  assert.deepEqual(segments, [
    {
      label: "5h",
      filledGlyphs: "▰▰▰▰",
      emptyGlyphs: "▱",
      percentText: "80%",
      color: "success",
    },
    {
      label: "7d",
      filledGlyphs: "▰",
      emptyGlyphs: "▱▱▱▱",
      percentText: "10%",
      color: "error",
    },
  ]);
});

test("buildProviderStatusGauge keeps at least one cell visible near the edges", () => {
  const style = getGaugeStyle("parallelograms");
  const nearlyEmpty = buildProviderStatusGauge(
    normalizeCodexUsageResponse(
      { rate_limit: { primary_window: { used_percent: 99 } } },
      now,
    ),
    style,
    5,
  );
  assert.equal(nearlyEmpty[0]?.filledGlyphs, "▰");

  const nearlyFull = buildProviderStatusGauge(
    normalizeCodexUsageResponse(
      { rate_limit: { primary_window: { used_percent: 1 } } },
      now,
    ),
    style,
    5,
  );
  assert.equal(nearlyFull[0]?.filledGlyphs, "▰▰▰▰");
  assert.equal(nearlyFull[0]?.emptyGlyphs, "▱");
});

test("normalizeCodexUsageResponse derives window labels from window seconds", () => {
  const snapshot = normalizeCodexUsageResponse(
    {
      rate_limit: {
        primary_window: { used_percent: 5, limit_window_seconds: 18_000 },
        secondary_window: { used_percent: 3, limit_window_seconds: 86_400 },
      },
    },
    now,
  );

  assert.equal(snapshot?.primary?.label, "5h");
  assert.equal(snapshot?.secondary?.label, "1d");
});
