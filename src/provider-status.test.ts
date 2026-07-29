import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildProviderStatusGauge,
  collectProviderStatus,
  formatProviderStatusText,
  formatResetCountdown,
  isProviderStatusRelevantToModel,
  normalizeClaudeUsageResponse,
  normalizeCodexUsageResponse,
  parseCodexRateLimitHeaders,
  projectProviderStatusForModel,
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
  showReset: "off",
  resetMinUsedPercent: 75,
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

test("normalizeClaudeUsageResponse collects model-scoped windows from limits", () => {
  const weeklyReset = "2026-06-16T23:00:00.365483+00:00";
  const snapshot = normalizeClaudeUsageResponse(
    {
      five_hour: { utilization: 6, resets_at: "2026-06-16T15:20:00Z" },
      seven_day: { utilization: 57, resets_at: weeklyReset },
      // The flat per-model keys stay null even while a scoped cap is in force.
      seven_day_opus: null,
      limits: [
        { kind: "session", group: "session", percent: 6, scope: null },
        { kind: "weekly_all", group: "weekly", percent: 57, scope: null },
        {
          kind: "weekly_scoped",
          group: "weekly",
          percent: 96,
          resets_at: weeklyReset,
          scope: { model: { id: null, display_name: "Fable" }, surface: null },
        },
        // Surface-scoped limits carry no model and cannot be matched.
        {
          kind: "weekly_scoped",
          group: "weekly",
          percent: 12,
          scope: { model: null, surface: { display_name: "Cowork" } },
        },
      ],
    },
    now,
  );

  assert.deepEqual(snapshot?.scoped, [
    {
      label: "7d",
      model: "Fable",
      usedPercent: 96,
      leftPercent: 4,
      resetAt: Math.round(Date.parse(weeklyReset) / 1000),
    },
  ]);
  // The account-wide windows stay untouched until a model is known.
  assert.equal(snapshot?.secondary?.usedPercent, 57);
  assert.equal(snapshot?.state, "warning");
});

test("normalizeClaudeUsageResponse prefers the active cap among duplicates for a model", () => {
  const snapshot = normalizeClaudeUsageResponse(
    {
      five_hour: { utilization: 1, resets_at: "2026-06-16T15:20:00Z" },
      seven_day: { utilization: 2, resets_at: "2026-06-16T23:00:00Z" },
      limits: [
        {
          kind: "weekly_scoped",
          group: "weekly",
          percent: 90,
          is_active: false,
          scope: { model: { display_name: "Haiku" } },
        },
        {
          kind: "weekly_scoped",
          group: "weekly",
          percent: 20,
          is_active: true,
          scope: { model: { display_name: "Haiku" } },
        },
      ],
    },
    now,
  );

  assert.equal(snapshot?.scoped?.length, 1);
  assert.equal(snapshot?.scoped?.[0]?.usedPercent, 20);
});

test("normalizeClaudeUsageResponse falls back to account-wide limits entries", () => {
  const sessionReset = "2026-06-16T15:20:00Z";
  const weeklyReset = "2026-06-16T23:00:00Z";
  const snapshot = normalizeClaudeUsageResponse(
    {
      // No flat five_hour/seven_day fields at all.
      limits: [
        {
          kind: "session",
          group: "session",
          percent: 4,
          resets_at: sessionReset,
          scope: null,
        },
        {
          kind: "weekly_all",
          group: "weekly",
          percent: 31,
          resets_at: weeklyReset,
          scope: null,
        },
        {
          kind: "weekly_scoped",
          group: "weekly",
          percent: 77,
          resets_at: weeklyReset,
          scope: { model: { display_name: "Fable" } },
        },
        // Surface-scoped entries are neither account-wide nor model-scoped.
        {
          kind: "weekly_scoped",
          group: "weekly",
          percent: 99,
          scope: { model: null, surface: { display_name: "Cowork" } },
        },
      ],
    },
    now,
  );

  assert.deepEqual(snapshot?.primary, {
    label: "5h",
    usedPercent: 4,
    leftPercent: 96,
    resetAt: Math.round(Date.parse(sessionReset) / 1000),
  });
  assert.deepEqual(snapshot?.secondary, {
    label: "7d",
    usedPercent: 31,
    leftPercent: 69,
    resetAt: Math.round(Date.parse(weeklyReset) / 1000),
  });
  assert.equal(snapshot?.scoped?.length, 1);
  assert.equal(
    projectProviderStatusForModel(snapshot!, { id: "claude-fable-5" }).secondary
      ?.usedPercent,
    77,
  );
});

test("normalizeClaudeUsageResponse reports an empty scoped set when limits carry none", () => {
  const withLimits = normalizeClaudeUsageResponse(
    {
      seven_day: { utilization: 2, resets_at: "2026-06-16T23:00:00Z" },
      limits: [{ kind: "weekly_all", group: "weekly", percent: 2, scope: null }],
    },
    now,
  );
  // An empty array retires cached scoped caps; a missing key preserves them.
  assert.deepEqual(withLimits?.scoped, []);

  const withoutLimits = normalizeClaudeUsageResponse(
    { seven_day: { utilization: 2, resets_at: "2026-06-16T23:00:00Z" } },
    now,
  );
  assert.equal(withoutLimits?.scoped, undefined);
});

test("projectProviderStatusForModel swaps in the scoped window for the active model", () => {
  const snapshot = {
    provider: "anthropic",
    source: "api" as const,
    fetchedAt: now.toISOString(),
    state: "ok" as const,
    primary: { label: "5h", usedPercent: 6, leftPercent: 94 },
    secondary: { label: "7d", usedPercent: 57, leftPercent: 43 },
    scoped: [{ label: "7d", model: "Fable", usedPercent: 96, leftPercent: 4 }],
  };

  const fable = projectProviderStatusForModel(snapshot, {
    id: "claude-fable-5",
    provider: "anthropic",
  });
  assert.deepEqual(fable.secondary, {
    label: "7d",
    usedPercent: 96,
    leftPercent: 4,
  });
  // Gauge count is unchanged: the scoped window takes over the weekly slot.
  assert.deepEqual(fable.primary, snapshot.primary);
  assert.equal(fable.state, "error");

  const sonnet = projectProviderStatusForModel(snapshot, {
    id: "claude-sonnet-4-5-20250929",
    provider: "anthropic",
  });
  assert.deepEqual(sonnet.secondary, snapshot.secondary);
  assert.equal(sonnet.state, snapshot.state);
});

test("projectProviderStatusForModel matches multi-token and prefixed model names", () => {
  const snapshot = {
    provider: "anthropic",
    source: "api" as const,
    fetchedAt: now.toISOString(),
    state: "ok" as const,
    secondary: { label: "7d", usedPercent: 10, leftPercent: 90 },
    scoped: [
      { label: "7d", model: "Opus 4.5", usedPercent: 80, leftPercent: 20 },
      { label: "7d", model: "Fable", usedPercent: 96, leftPercent: 4 },
    ],
  };

  assert.equal(
    projectProviderStatusForModel(snapshot, "eu.anthropic.claude-fable-5")
      .secondary?.usedPercent,
    96,
  );
  assert.equal(
    projectProviderStatusForModel(snapshot, {
      id: "claude-opus-4-5-20251101",
    }).secondary?.usedPercent,
    80,
  );
  // Opus 4.1 must not inherit the Opus 4.5 cap.
  assert.equal(
    projectProviderStatusForModel(snapshot, { id: "claude-opus-4-1-20250805" })
      .secondary?.usedPercent,
    10,
  );
});

test("projectProviderStatusForModel keeps the window with less headroom", () => {
  const snapshot = {
    provider: "anthropic",
    source: "api" as const,
    fetchedAt: now.toISOString(),
    state: "error" as const,
    secondary: { label: "7d", usedPercent: 92, leftPercent: 8 },
    scoped: [{ label: "7d", model: "Fable", usedPercent: 20, leftPercent: 80 }],
  };

  // The account-wide weekly cap binds first, so it stays on screen.
  assert.deepEqual(
    projectProviderStatusForModel(snapshot, { id: "claude-fable-5" }).secondary,
    snapshot.secondary,
  );
});

test("projectProviderStatusForModel leaves snapshots without scoped windows alone", () => {
  const snapshot = {
    provider: "anthropic",
    source: "api" as const,
    fetchedAt: now.toISOString(),
    state: "ok" as const,
    secondary: { label: "7d", usedPercent: 57, leftPercent: 43 },
  };

  assert.equal(
    projectProviderStatusForModel(snapshot, { id: "claude-fable-5" }),
    snapshot,
  );
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
      showReset: "off",
      resetMinUsedPercent: 75,
    }),
    "5h:5% 7d:3%",
  );
});

test("formatResetCountdown truncates at unit boundaries", () => {
  const nowMs = 1_800_000_000_000;
  const resetAtAfter = (remainingMs: number) =>
    (nowMs + remainingMs) / 1000;

  assert.equal(formatResetCountdown(Number.NaN, nowMs), "");
  assert.equal(formatResetCountdown(Number.POSITIVE_INFINITY, nowMs), "");
  assert.equal(formatResetCountdown(resetAtAfter(60_000), Number.NaN), "");
  assert.equal(formatResetCountdown(0, nowMs), "");
  assert.equal(formatResetCountdown(nowMs / 1000, nowMs), "");
  assert.equal(formatResetCountdown(resetAtAfter(1), nowMs), "~now");
  assert.equal(formatResetCountdown(resetAtAfter(59_000), nowMs), "~now");
  assert.equal(formatResetCountdown(resetAtAfter(60_000), nowMs), "~1m");
  assert.equal(
    formatResetCountdown(resetAtAfter(59 * 60_000 + 59_000), nowMs),
    "~59m",
  );
  assert.equal(formatResetCountdown(resetAtAfter(60 * 60_000), nowMs), "~1h");
  assert.equal(
    formatResetCountdown(
      resetAtAfter(4 * 60 * 60_000 + 32 * 60_000 + 59_000),
      nowMs,
    ),
    "~4h32m",
  );
  assert.equal(
    formatResetCountdown(resetAtAfter(24 * 60 * 60_000), nowMs),
    "~1d",
  );
  assert.equal(
    formatResetCountdown(
      resetAtAfter(31 * 60 * 60_000 + 59 * 60_000),
      nowMs,
    ),
    "~1d7h",
  );
});

test("formatProviderStatusText places countdowns next to their windows", () => {
  const nowMs = 1_800_000_000_000;
  const snapshot = {
    provider: "anthropic" as const,
    source: "api" as const,
    fetchedAt: new Date(nowMs).toISOString(),
    state: "ok" as const,
    primary: {
      label: "5h",
      usedPercent: 2,
      leftPercent: 98,
      resetAt: (nowMs + (4 * 60 + 32) * 60_000) / 1000,
    },
    secondary: {
      label: "7d",
      usedPercent: 97,
      leftPercent: 3,
      resetAt: (nowMs + (24 + 7) * 60 * 60_000) / 1000,
    },
    credits: "12",
  };
  const config = {
    showCredits: true,
    showReset: "all" as const,
    resetMinUsedPercent: 0,
  };

  assert.equal(
    formatProviderStatusText(
      snapshot,
      { ...config, showReset: "off" },
      nowMs,
    ),
    "5h:2% 7d:97% cr:12",
  );
  assert.equal(
    formatProviderStatusText(
      snapshot,
      { ...config, showReset: "primary" },
      nowMs,
    ),
    "5h:2% ~4h32m 7d:97% cr:12",
  );
  assert.equal(
    formatProviderStatusText(snapshot, config, nowMs),
    "5h:2% ~4h32m 7d:97% ~1d7h cr:12",
  );
  assert.equal(
    formatProviderStatusText(
      {
        ...snapshot,
        primary: { ...snapshot.primary, resetAt: nowMs / 1000 },
      },
      { ...config, showReset: "primary" },
      nowMs,
    ),
    "5h:2% 7d:97% cr:12",
  );
});

test("formatProviderStatusText gates countdowns by displayed usage", () => {
  const nowMs = 1_800_000_000_000;
  const resetAt = (nowMs + 60 * 60_000) / 1000;
  const text = (usedPercent: number, resetMinUsedPercent = 75) =>
    formatProviderStatusText(
      {
        provider: "anthropic",
        source: "api",
        fetchedAt: new Date(nowMs).toISOString(),
        state: "ok",
        primary: {
          label: "5h",
          usedPercent,
          leftPercent: 100 - usedPercent,
          resetAt,
        },
      },
      {
        showCredits: false,
        showReset: "all",
        resetMinUsedPercent,
      },
      nowMs,
    );

  assert.equal(text(74.94), "5h:74.9%");
  assert.equal(text(74.96), "5h:75% ~1h");
  assert.equal(text(75), "5h:75% ~1h");
  assert.equal(text(99.94, 100), "5h:99.9%");
  assert.equal(text(99.96, 100), "5h:100% ~1h");
});

test("formatProviderStatusText treats unreported usage as below the threshold", () => {
  const nowMs = 1_800_000_000_000;
  const snapshot = normalizeCodexUsageResponse(
    {
      rate_limit: {
        primary_window: { reset_at: (nowMs + 60 * 60_000) / 1000 },
      },
    },
    new Date(nowMs),
  );
  const config = {
    showCredits: false,
    showReset: "all" as const,
    resetMinUsedPercent: 75,
  };

  assert.equal(formatProviderStatusText(snapshot, config, nowMs), "5h:0%");
  assert.equal(
    formatProviderStatusText(
      snapshot,
      { ...config, resetMinUsedPercent: 0 },
      nowMs,
    ),
    "5h:0% ~1h",
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
      showReset: "off",
      resetMinUsedPercent: 75,
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

test("collectProviderStatus retires a cached scoped cap that a refresh no longer reports", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-fancy-footer-test-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const previousHome = process.env.HOME;
  const previousXdgCacheHome = process.env.XDG_CACHE_HOME;
  const previousFetch = globalThis.fetch;
  process.env.HOME = dir;
  process.env.XDG_CACHE_HOME = join(dir, "cache");
  // A successful refresh that reports the account-wide windows only: the weekly
  // Fable cap is gone.
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        five_hour: { utilization: 3, resets_at: "2030-01-01T01:00:00Z" },
        seven_day: { utilization: 9, resets_at: "2030-01-02T01:00:00Z" },
        limits: [
          { kind: "session", group: "session", percent: 3, scope: null },
          { kind: "weekly_all", group: "weekly", percent: 9, scope: null },
        ],
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
      state: "error",
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
      scoped: [
        {
          label: "7d",
          model: "Fable",
          usedPercent: 96,
          leftPercent: 4,
          resetAt: futureResetAt,
        },
      ],
      url: "https://claude.ai/settings/usage",
    }),
    { mode: 0o600 },
  );

  const snapshots = await collectProviderStatus({} as never, {
    ...anthropicProviderStatusConfig,
    cacheTtlMs: 1,
  });

  const snapshot = snapshots[0];
  assert.equal(snapshot?.scoped, undefined);
  assert.equal(
    projectProviderStatusForModel(snapshot!, { id: "claude-fable-5" }).secondary
      ?.usedPercent,
    9,
  );
});

test("collectProviderStatus rolls cached quota over to empty once its windows reset", async (t) => {
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
  assert.equal(snapshot?.source, "cache");
  assert.equal(snapshot?.state, "ok");
  assert.deepEqual(snapshot?.primary, {
    label: "5h",
    usedPercent: 0,
    leftPercent: 100,
    resetAt: 1,
  });
  assert.deepEqual(snapshot?.secondary, {
    label: "7d",
    usedPercent: 0,
    leftPercent: 100,
    resetAt: 1,
  });
  assert.match(snapshot?.error ?? "", /429/);
  // A reset window renders as an empty gauge instead of hiding the widget.
  assert.equal(
    formatProviderStatusText(snapshot, {
      showCredits: false,
      showReset: "all",
      resetMinUsedPercent: 0,
    }),
    "5h:0% 7d:0%",
  );
});

test("collectProviderStatus empties a window that reset inside the cache TTL", async (t) => {
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
  const nowSeconds = Math.floor(Date.now() / 1000);
  await writeFile(
    join(cacheDir, "anthropic.json"),
    JSON.stringify({
      provider: "anthropic",
      source: "api",
      fetchedAt: new Date().toISOString(),
      // The severity the exhausted weekly window had before it reset.
      state: "error",
      // Fetched moments ago, but the weekly window has since rolled over.
      primary: {
        label: "5h",
        usedPercent: 10,
        leftPercent: 90,
        resetAt: nowSeconds + 600,
      },
      secondary: {
        label: "7d",
        usedPercent: 96,
        leftPercent: 4,
        resetAt: nowSeconds - 30,
      },
      url: "https://claude.ai/settings/usage",
    }),
    { mode: 0o600 },
  );

  const snapshots = await collectProviderStatus({} as never, {
    ...anthropicProviderStatusConfig,
    cacheTtlMs: 60_000,
  });

  assert.equal(snapshots.length, 1);
  const snapshot = snapshots[0];
  assert.equal(snapshot?.source, "cache");
  // The unexpired session window keeps its usage; the weekly window is empty.
  assert.equal(snapshot?.primary?.usedPercent, 10);
  assert.equal(snapshot?.secondary?.usedPercent, 0);
  assert.equal(snapshot?.secondary?.leftPercent, 100);
  // Severity is recomputed from the projected windows, not carried over.
  assert.equal(snapshot?.state, "ok");
});

test("collectProviderStatus keeps a reset session window while a refresh reports only the weekly one", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-fancy-footer-test-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const previousHome = process.env.HOME;
  const previousXdgCacheHome = process.env.XDG_CACHE_HOME;
  const previousFetch = globalThis.fetch;
  process.env.HOME = dir;
  process.env.XDG_CACHE_HOME = join(dir, "cache");
  const resetsAt = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();
  // The shape Anthropic reports right after a weekly reset with no live session.
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        five_hour: null,
        seven_day: { utilization: 0, resets_at: resetsAt },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
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
      primary: { label: "5h", usedPercent: 3, leftPercent: 97, resetAt: 1 },
      secondary: { label: "7d", usedPercent: 42, leftPercent: 58, resetAt: 1 },
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
  assert.equal(snapshot?.primary?.label, "5h");
  assert.equal(snapshot?.primary?.usedPercent, 0);
  assert.equal(snapshot?.secondary?.label, "7d");
  assert.equal(snapshot?.secondary?.usedPercent, 0);
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

test("buildProviderStatusGauge fills cells with used quota per window", () => {
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
      role: "primary",
      usedPercent: 20,
      filledGlyphs: "▰",
      emptyGlyphs: "▱▱▱▱",
      percentText: "20%",
      color: "success",
    },
    {
      label: "7d",
      role: "secondary",
      usedPercent: 90,
      filledGlyphs: "▰▰▰▰",
      emptyGlyphs: "▱",
      percentText: "90%",
      color: "error",
    },
  ]);
});

test("buildProviderStatusGauge keeps at least one cell visible near the edges", () => {
  const style = getGaugeStyle("parallelograms");
  const nearlyEmpty = buildProviderStatusGauge(
    normalizeCodexUsageResponse(
      { rate_limit: { primary_window: { used_percent: 1 } } },
      now,
    ),
    style,
    5,
  );
  assert.equal(nearlyEmpty[0]?.filledGlyphs, "▰");

  const nearlyFull = buildProviderStatusGauge(
    normalizeCodexUsageResponse(
      { rate_limit: { primary_window: { used_percent: 99 } } },
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
