import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildProviderStatusGauge,
  collectProviderStatus,
  formatProviderStatusText,
  isProviderStatusRelevantToModel,
  normalizeClaudeUsageResponse,
  normalizeCodexUsageResponse,
  parseCodexRateLimitHeaders,
  providerStatusColor,
  updateProviderStatusFromHeaders,
} from "./provider-status.ts";
import { getGaugeStyle, type ProviderStatusConfigSnapshot } from "./shared.ts";

const now = new Date("2026-05-06T10:00:00Z");
const providerStatusConfig: ProviderStatusConfigSnapshot = {
  refreshMs: 60_000,
  cacheTtlMs: 60_000,
  providers: ["openai-codex"],
  display: "gauge",
  showCredits: false,
  showReset: false,
};
const anthropicProviderStatusConfig: ProviderStatusConfigSnapshot = {
  ...providerStatusConfig,
  providers: ["anthropic"],
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

test("normalizeCodexUsageResponse accepts a promoted weekly-only primary window", () => {
  const snapshot = normalizeCodexUsageResponse(
    {
      rate_limit: {
        primary_window: {
          used_percent: 16,
          limit_window_seconds: 604_800,
          reset_at: 1_784_668_371,
        },
        secondary_window: null,
      },
    },
    now,
  );

  assert.deepEqual(snapshot?.primary, {
    label: "7d",
    usedPercent: 16,
    leftPercent: 84,
    resetAt: 1_784_668_371,
  });
  assert.equal(snapshot?.secondary, undefined);
});

test("normalizeClaudeUsageResponse extracts five-hour and weekly usage windows", () => {
  const fiveHourReset = "2026-06-16T15:20:00.365459+00:00";
  const weeklyReset = "2026-06-16T23:00:00.365483+00:00";
  const snapshot = normalizeClaudeUsageResponse(
    {
      five_hour: {
        utilization: 0,
        resets_at: fiveHourReset,
      },
      seven_day: {
        utilization: 8,
        resets_at: weeklyReset,
      },
      seven_day_sonnet: {
        utilization: 99,
        resets_at: weeklyReset,
      },
      extra_usage: {
        utilization: 75,
      },
    },
    now,
  );

  assert.deepEqual(snapshot?.primary, {
    label: "5h",
    usedPercent: 0,
    leftPercent: 100,
    resetAt: Math.round(Date.parse(fiveHourReset) / 1000),
  });
  assert.deepEqual(snapshot?.secondary, {
    label: "7d",
    usedPercent: 8,
    leftPercent: 92,
    resetAt: Math.round(Date.parse(weeklyReset) / 1000),
  });
  assert.equal(snapshot?.provider, "anthropic");
  assert.equal(snapshot?.state, "ok");
});

test("normalizeClaudeUsageResponse ignores responses without supported windows", () => {
  assert.equal(
    normalizeClaudeUsageResponse(
      {
        seven_day_sonnet: {
          utilization: 10,
        },
        extra_usage: {
          utilization: 20,
        },
      },
      now,
    ),
    undefined,
  );
});

test("parseCodexRateLimitHeaders accepts case-insensitive x-codex headers", () => {
  const snapshot = parseCodexRateLimitHeaders(
    {
      "X-Codex-Primary-Used-Percent": "76",
      "x-codex-primary-window-minutes": 300,
      "x-codex-secondary-used-percent": 10,
      "x-codex-secondary-window-minutes": 10_080,
      "x-codex-credits-balance": "42",
    },
    now,
  );

  assert.equal(snapshot?.primary?.label, "5h");
  assert.equal(snapshot?.primary?.leftPercent, 24);
  assert.equal(snapshot?.secondary?.label, "7d");
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

test("isProviderStatusRelevantToModel limits Codex status to OpenAI-like models", () => {
  assert.equal(
    isProviderStatusRelevantToModel("openai-codex", {
      provider: "anthropic",
      id: "claude-sonnet-4",
      name: "Claude Sonnet 4",
    }),
    false,
  );
  assert.equal(
    isProviderStatusRelevantToModel("openai-codex", {
      id: "gpt-5-codex",
      name: "GPT-5 Codex",
    }),
    true,
  );
  assert.equal(
    isProviderStatusRelevantToModel("openai-codex", {
      provider: "openai",
      id: "o3",
    }),
    true,
  );
  assert.equal(
    isProviderStatusRelevantToModel("other-provider", {
      id: "claude-sonnet-4",
    }),
    true,
  );
});

test("isProviderStatusRelevantToModel limits Anthropic status to Claude-like models", () => {
  assert.equal(
    isProviderStatusRelevantToModel("anthropic", {
      provider: "anthropic",
      id: "claude-sonnet-4",
      name: "Claude Sonnet 4",
    }),
    true,
  );
  assert.equal(
    isProviderStatusRelevantToModel("anthropic", {
      id: "claude-opus-4",
    }),
    true,
  );
  assert.equal(
    isProviderStatusRelevantToModel("anthropic", {
      provider: "openai",
      id: "gpt-5-codex",
    }),
    false,
  );
  assert.equal(isProviderStatusRelevantToModel("anthropic", undefined), false);
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

test("collectProviderStatus drops a cached Codex session window after a weekly-only refresh", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-fancy-footer-test-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const previousHome = process.env.HOME;
  const previousXdgCacheHome = process.env.XDG_CACHE_HOME;
  const previousFetch = globalThis.fetch;
  process.env.HOME = dir;
  process.env.XDG_CACHE_HOME = join(dir, "cache");
  const futureResetAt = Math.ceil(Date.now() / 1000) + 604_800;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        rate_limit: {
          primary_window: {
            used_percent: 16,
            limit_window_seconds: 604_800,
            reset_at: futureResetAt,
          },
          secondary_window: null,
        },
      }),
    );
  t.after(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousXdgCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousXdgCacheHome;
    globalThis.fetch = previousFetch;
  });

  await mkdir(join(dir, ".pi", "agent"), { recursive: true });
  await writeFile(
    join(dir, ".pi", "agent", "auth.json"),
    JSON.stringify({
      "openai-codex": {
        access: "test-access-token",
        accountId: "test-account",
      },
    }),
    { mode: 0o600 },
  );

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
      fetchedAt: "2026-07-12T20:00:00Z",
      state: "ok",
      primary: {
        label: "5h",
        usedPercent: 74,
        leftPercent: 26,
        resetAt: futureResetAt,
      },
      secondary: {
        label: "7d",
        usedPercent: 16,
        leftPercent: 84,
        resetAt: futureResetAt,
      },
    }),
    { mode: 0o600 },
  );

  const [snapshot] = await collectProviderStatus({} as never, {
    ...providerStatusConfig,
    cacheTtlMs: 1,
  });

  assert.equal(snapshot?.primary?.label, "7d");
  assert.equal(snapshot?.primary?.leftPercent, 84);
  assert.equal(snapshot?.secondary, undefined);
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

test("collectProviderStatus keeps cached quota in effect after a failed refresh", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-fancy-footer-test-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const previousHome = process.env.HOME;
  const previousXdgCacheHome = process.env.XDG_CACHE_HOME;
  const previousFetch = globalThis.fetch;
  process.env.HOME = dir;
  process.env.XDG_CACHE_HOME = join(dir, "cache");
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: "rate limited" } }), {
      status: 429,
    });
  t.after(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousXdgCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousXdgCacheHome;
    globalThis.fetch = previousFetch;
  });

  await mkdir(join(dir, ".pi", "agent"), { recursive: true });
  await writeFile(
    join(dir, ".pi", "agent", "auth.json"),
    JSON.stringify({ anthropic: { access: "test-access-token" } }),
    { mode: 0o600 },
  );

  const futureResetAt = Math.ceil(Date.now() / 1000) + 3_600;
  const cacheDir = join(
    process.env.XDG_CACHE_HOME,
    "pi-fancy-footer",
    "provider-status",
  );
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    join(cacheDir, "anthropic.json"),
    JSON.stringify({
      provider: "anthropic",
      source: "api",
      fetchedAt: "2026-05-06T09:00:00Z",
      state: "ok",
      primary: {
        label: "5h",
        usedPercent: 5,
        leftPercent: 95,
        resetAt: futureResetAt,
      },
      secondary: {
        label: "7d",
        usedPercent: 12,
        leftPercent: 88,
        resetAt: futureResetAt,
      },
      url: "https://claude.ai/settings/usage",
    }),
    { mode: 0o600 },
  );

  const snapshots = await collectProviderStatus({} as never, {
    ...anthropicProviderStatusConfig,
    cacheTtlMs: 1,
  });

  assert.equal(snapshots.length, 1);
  const snapshot = snapshots[0];
  assert.equal(snapshot?.source, "cache");
  assert.equal(snapshot?.state, "ok");
  assert.deepEqual(snapshot?.primary, {
    label: "5h",
    usedPercent: 5,
    leftPercent: 95,
    resetAt: futureResetAt,
  });
  assert.deepEqual(snapshot?.secondary, {
    label: "7d",
    usedPercent: 12,
    leftPercent: 88,
    resetAt: futureResetAt,
  });
  assert.match(snapshot?.error ?? "", /429/);
});

test("collectProviderStatus retains a valid five-hour cache window after a partial refresh", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-fancy-footer-test-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const previousHome = process.env.HOME;
  const previousXdgCacheHome = process.env.XDG_CACHE_HOME;
  const previousFetch = globalThis.fetch;
  process.env.HOME = dir;
  process.env.XDG_CACHE_HOME = join(dir, "cache");
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        seven_day: {
          utilization: 7,
          resets_at: "2030-01-01T01:00:00Z",
        },
      }),
    );
  t.after(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousXdgCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousXdgCacheHome;
    globalThis.fetch = previousFetch;
  });

  await mkdir(join(dir, ".pi", "agent"), { recursive: true });
  await writeFile(
    join(dir, ".pi", "agent", "auth.json"),
    JSON.stringify({ anthropic: { access: "test-access-token" } }),
    { mode: 0o600 },
  );

  const futureResetAt = Math.ceil(Date.now() / 1000) + 3_600;
  const cacheDir = join(
    process.env.XDG_CACHE_HOME,
    "pi-fancy-footer",
    "provider-status",
  );
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    join(cacheDir, "anthropic.json"),
    JSON.stringify({
      provider: "anthropic",
      source: "api",
      fetchedAt: "2026-05-06T09:00:00Z",
      state: "ok",
      primary: {
        label: "5h",
        usedPercent: 5,
        leftPercent: 95,
        resetAt: futureResetAt,
      },
      secondary: {
        label: "7d",
        usedPercent: 12,
        leftPercent: 88,
        resetAt: futureResetAt,
      },
    }),
    { mode: 0o600 },
  );

  const [snapshot] = await collectProviderStatus({} as never, {
    ...anthropicProviderStatusConfig,
    cacheTtlMs: 1,
  });

  assert.equal(snapshot?.primary?.label, "5h");
  assert.equal(snapshot?.secondary?.label, "7d");
  assert.equal(snapshot?.secondary?.usedPercent, 7);
  assert.equal(snapshot?.error, undefined);
});

test("collectProviderStatus hides cached quota once its windows reset", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-fancy-footer-test-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const previousHome = process.env.HOME;
  const previousXdgCacheHome = process.env.XDG_CACHE_HOME;
  const previousFetch = globalThis.fetch;
  process.env.HOME = dir;
  process.env.XDG_CACHE_HOME = join(dir, "cache");
  globalThis.fetch = async () => new Response("rate limited", { status: 429 });
  t.after(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousXdgCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousXdgCacheHome;
    globalThis.fetch = previousFetch;
  });

  await mkdir(join(dir, ".pi", "agent"), { recursive: true });
  await writeFile(
    join(dir, ".pi", "agent", "auth.json"),
    JSON.stringify({ anthropic: { access: "test-access-token" } }),
    { mode: 0o600 },
  );

  const cacheDir = join(
    process.env.XDG_CACHE_HOME,
    "pi-fancy-footer",
    "provider-status",
  );
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    join(cacheDir, "anthropic.json"),
    JSON.stringify({
      provider: "anthropic",
      source: "api",
      fetchedAt: "2026-05-06T09:00:00Z",
      state: "ok",
      primary: { label: "5h", usedPercent: 5, leftPercent: 95, resetAt: 1 },
      secondary: {
        label: "7d",
        usedPercent: 12,
        leftPercent: 88,
        resetAt: 1,
      },
      url: "https://claude.ai/settings/usage",
    }),
    { mode: 0o600 },
  );

  const snapshots = await collectProviderStatus({} as never, {
    ...anthropicProviderStatusConfig,
    cacheTtlMs: 1,
  });

  assert.equal(snapshots.length, 1);
  const snapshot = snapshots[0];
  assert.equal(snapshot?.source, "api");
  assert.equal(snapshot?.state, "unavailable");
  assert.equal(snapshot?.primary, undefined);
  assert.equal(snapshot?.secondary, undefined);
  assert.match(snapshot?.error ?? "", /429/);
});

test("collectProviderStatus keeps cached quota in effect after a failed auth refresh", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-fancy-footer-test-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const previousHome = process.env.HOME;
  const previousXdgCacheHome = process.env.XDG_CACHE_HOME;
  const previousFetch = globalThis.fetch;
  process.env.HOME = dir;
  process.env.XDG_CACHE_HOME = join(dir, "cache");
  globalThis.fetch = async () => new Response("rate limited", { status: 429 });
  t.after(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousXdgCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousXdgCacheHome;
    globalThis.fetch = previousFetch;
  });

  await mkdir(join(dir, ".pi", "agent"), { recursive: true });
  await writeFile(
    join(dir, ".pi", "agent", "auth.json"),
    JSON.stringify({
      anthropic: {
        access: "expired-access-token",
        refresh: "test-refresh-token",
        expires: Date.now() - 60_000,
      },
    }),
    { mode: 0o600 },
  );

  const futureResetAt = Math.ceil(Date.now() / 1000) + 3_600;
  const cacheDir = join(
    process.env.XDG_CACHE_HOME,
    "pi-fancy-footer",
    "provider-status",
  );
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    join(cacheDir, "anthropic.json"),
    JSON.stringify({
      provider: "anthropic",
      source: "api",
      fetchedAt: "2026-05-06T09:00:00Z",
      state: "ok",
      primary: {
        label: "5h",
        usedPercent: 5,
        leftPercent: 95,
        resetAt: futureResetAt,
      },
      url: "https://claude.ai/settings/usage",
    }),
    { mode: 0o600 },
  );

  const snapshots = await collectProviderStatus({} as never, {
    ...anthropicProviderStatusConfig,
    cacheTtlMs: 1,
  });

  assert.equal(snapshots.length, 1);
  const snapshot = snapshots[0];
  assert.equal(snapshot?.source, "cache");
  assert.equal(snapshot?.state, "ok");
  assert.equal(snapshot?.primary?.resetAt, futureResetAt);
  assert.match(snapshot?.error ?? "", /429/);
});

test("collectProviderStatus keeps cached quota in effect regardless of the failure cause", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-fancy-footer-test-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const previousHome = process.env.HOME;
  const previousXdgCacheHome = process.env.XDG_CACHE_HOME;
  const previousFetch = globalThis.fetch;
  process.env.HOME = dir;
  process.env.XDG_CACHE_HOME = join(dir, "cache");
  // A non-retryable failure (e.g. revoked credentials) must not invalidate a
  // quota window that has not reset yet.
  globalThis.fetch = async () => new Response("forbidden", { status: 403 });
  t.after(() => {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousXdgCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
    else process.env.XDG_CACHE_HOME = previousXdgCacheHome;
    globalThis.fetch = previousFetch;
  });

  await mkdir(join(dir, ".pi", "agent"), { recursive: true });
  await writeFile(
    join(dir, ".pi", "agent", "auth.json"),
    JSON.stringify({ anthropic: { access: "test-access-token" } }),
    { mode: 0o600 },
  );

  const futureResetAt = Math.ceil(Date.now() / 1000) + 3_600;
  const cacheDir = join(
    process.env.XDG_CACHE_HOME,
    "pi-fancy-footer",
    "provider-status",
  );
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    join(cacheDir, "anthropic.json"),
    JSON.stringify({
      provider: "anthropic",
      source: "api",
      fetchedAt: "2026-05-06T09:00:00Z",
      state: "ok",
      primary: {
        label: "5h",
        usedPercent: 5,
        leftPercent: 95,
        resetAt: futureResetAt,
      },
      url: "https://claude.ai/settings/usage",
    }),
    { mode: 0o600 },
  );

  const snapshots = await collectProviderStatus({} as never, {
    ...anthropicProviderStatusConfig,
    cacheTtlMs: 1,
  });

  assert.equal(snapshots.length, 1);
  const snapshot = snapshots[0];
  assert.equal(snapshot?.source, "cache");
  assert.equal(snapshot?.state, "ok");
  assert.equal(snapshot?.primary?.resetAt, futureResetAt);
  assert.match(snapshot?.error ?? "", /403/);
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

test("updateProviderStatusFromHeaders ignores Anthropic response headers", async () => {
  const updated = await updateProviderStatusFromHeaders(
    {
      "anthropic-ratelimit-requests-remaining": "10",
      "anthropic-ratelimit-tokens-remaining": "1000",
    },
    anthropicProviderStatusConfig,
  );

  assert.deepEqual(updated, []);
});

test("updateProviderStatusFromHeaders clears a stale Codex session window for a weekly-only layout", async (t) => {
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

  const futureResetAt = Math.ceil(Date.now() / 1000) + 604_800;
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
      fetchedAt: new Date().toISOString(),
      state: "ok",
      primary: {
        label: "5h",
        usedPercent: 74,
        leftPercent: 26,
        resetAt: futureResetAt,
      },
      secondary: {
        label: "7d",
        usedPercent: 15,
        leftPercent: 85,
        resetAt: futureResetAt,
      },
    }),
    { mode: 0o600 },
  );

  const [snapshot] = await updateProviderStatusFromHeaders(
    {
      "x-codex-primary-used-percent": "16",
      "x-codex-primary-window-minutes": "10080",
      "x-codex-primary-reset-at": String(futureResetAt),
    },
    providerStatusConfig,
  );

  assert.equal(snapshot?.primary?.label, "7d");
  assert.equal(snapshot?.primary?.leftPercent, 84);
  assert.equal(snapshot?.secondary, undefined);
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
