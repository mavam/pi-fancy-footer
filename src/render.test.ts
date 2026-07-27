import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { githubMergedForegroundPrefix, renderFooterLines } from "./render.ts";
import type { NormalizedFancyFooterDataWidget } from "./data-widgets.ts";
import { parseCodexRateLimitHeaders } from "./provider-status.ts";
import {
  DEFAULT_FOOTER_CONFIG,
  EMPTY_GIT_INFO,
  type FooterConfigSnapshot,
  type ProviderStatusSnapshot,
  type SessionUsageMetrics,
} from "./shared.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  getColorMode: () => "truecolor" as const,
};

const MERGED_TRUECOLOR = `${githubMergedForegroundPrefix("truecolor")}@\x1b[39m`;
const MERGED_256COLOR = `${githubMergedForegroundPrefix("256color")}@\x1b[39m`;

const usageMetrics: SessionUsageMetrics = {
  latest: undefined,
  totalCost: 0,
  totalCacheRead: 0,
  totalCacheWrite: 0,
};

const providerStatus: ProviderStatusSnapshot = {
  provider: "openai-codex",
  source: "headers",
  fetchedAt: "2026-05-06T10:00:00Z",
  state: "ok",
  primary: {
    label: "5h",
    leftPercent: 95,
    usedPercent: 5,
  },
};

const claudeProviderStatus: ProviderStatusSnapshot = {
  provider: "anthropic",
  source: "api",
  fetchedAt: "2026-06-16T10:00:00Z",
  state: "ok",
  primary: {
    label: "5h",
    leftPercent: 100,
    usedPercent: 0,
  },
  secondary: {
    label: "7d",
    leftPercent: 92,
    usedPercent: 8,
  },
};

const footerConfig: FooterConfigSnapshot = {
  ...DEFAULT_FOOTER_CONFIG,
  iconFamily: "ascii",
  providerStatus: {
    ...DEFAULT_FOOTER_CONFIG.providerStatus,
    display: "text",
  },
  widgets: {
    "context-bar": { enabled: false },
    "context-capacity": { enabled: false },
    location: { enabled: false },
  },
};

const agentWidgets: NormalizedFancyFooterDataWidget[] = [
  {
    id: "pi-agents.workflows",
    label: "Active workflows",
    description: "Shows active workflow executions.",
    content: { type: "text", text: "2" },
    icon: { glyphs: "❖", color: "accent" },
    defaults: {
      enabled: false,
      row: 1,
      position: 9,
      align: "right",
      fill: "none",
    },
  },
  {
    id: "pi-agents.agents",
    label: "Agent progress",
    description: "Shows completed and total agents.",
    content: { type: "text", text: "1/3" },
    icon: { glyphs: "✦", color: "success" },
    defaults: {
      enabled: false,
      row: 1,
      position: 10,
      align: "right",
      fill: "none",
    },
  },
];

function contextWithModel(
  model: { id: string; name: string; provider?: string },
  usage = { contextWindow: 200_000, tokens: 0, percent: 0 },
) {
  return {
    cwd: "/repo",
    model,
    getContextUsage: () => usage,
    sessionManager: {
      getBranch: () => [],
    },
  };
}

test("renderFooterLines renders max thinking with the default text color", () => {
  const colors: string[] = [];
  const coloredTheme = {
    fg: (color: string, text: string) => {
      colors.push(`${color}:${text}`);
      return text;
    },
    getColorMode: () => "truecolor" as const,
  };

  const lines = renderFooterLines(
    120,
    contextWithModel({
      provider: "anthropic",
      id: "claude-sonnet-4",
      name: "Claude Sonnet 4",
    }) as never,
    EMPTY_GIT_INFO,
    "max",
    coloredTheme as never,
    usageMetrics,
    footerConfig,
  );

  assert.match(lines.join("\n"), /\?max/);
  assert.ok(colors.includes("dim:max"));
  assert.equal(colors.includes("thinkingMax:max"), false);
});

test("data widgets honor default visibility and user color overrides", () => {
  const colors: string[] = [];
  const coloredTheme = {
    fg: (color: string, text: string) => {
      colors.push(`${color}:${text}`);
      return text;
    },
    getColorMode: () => "truecolor" as const,
  };
  const disabledLines = renderFooterLines(
    160,
    contextWithModel({ id: "gpt-5", name: "GPT-5" }) as never,
    EMPTY_GIT_INFO,
    "off",
    coloredTheme as never,
    usageMetrics,
    footerConfig,
    agentWidgets,
  );
  assert.doesNotMatch(disabledLines.join("\n"), /❖2|✦1\/3/);

  colors.length = 0;
  const enabledConfig: FooterConfigSnapshot = {
    ...footerConfig,
    extensionWidgets: {
      "pi-agents.workflows": {
        enabled: true,
        iconColor: "success",
        textColor: "warning",
      },
      "pi-agents.agents": { enabled: true },
    },
  };
  const enabledLines = renderFooterLines(
    160,
    contextWithModel({ id: "gpt-5", name: "GPT-5" }) as never,
    EMPTY_GIT_INFO,
    "off",
    coloredTheme as never,
    usageMetrics,
    enabledConfig,
    agentWidgets,
  );
  assert.match(enabledLines.join("\n"), /❖2.*✦1\/3/);
  assert.ok(colors.includes("success:❖"));
  assert.ok(colors.includes("warning:2"));
  assert.ok(colors.includes("success:✦"));
});

test("enabled data widgets remain hidden while their content is empty", () => {
  const enabledConfig: FooterConfigSnapshot = {
    ...footerConfig,
    extensionWidgets: {
      "pi-agents.workflows": { enabled: true },
      "pi-agents.agents": { enabled: true },
    },
  };
  const emptyWidgets = agentWidgets.map((widget) => ({
    ...widget,
    content: { type: "text" as const, text: "" },
  }));

  const lines = renderFooterLines(
    160,
    contextWithModel({ id: "gpt-5", name: "GPT-5" }) as never,
    EMPTY_GIT_INFO,
    "off",
    theme as never,
    usageMetrics,
    enabledConfig,
    emptyWidgets,
  );

  assert.doesNotMatch(lines.join("\n"), /❖|✦|·/);
});

test("renderFooterLines hides Codex provider status for non-OpenAI models", () => {
  const lines = renderFooterLines(
    120,
    contextWithModel({
      provider: "anthropic",
      id: "claude-sonnet-4",
      name: "Claude Sonnet 4",
    }) as never,
    EMPTY_GIT_INFO,
    "off",
    theme as never,
    usageMetrics,
    footerConfig,
    [],
    [providerStatus],
  );

  assert.doesNotMatch(lines.join("\n"), /5h:5%/);
});

test("renderFooterLines shows Codex provider status for OpenAI models", () => {
  const lines = renderFooterLines(
    120,
    contextWithModel({
      provider: "openai",
      id: "gpt-5-codex",
      name: "GPT-5 Codex",
    }) as never,
    EMPTY_GIT_INFO,
    "off",
    theme as never,
    usageMetrics,
    footerConfig,
    [],
    [providerStatus],
  );

  assert.match(lines.join("\n"), /5h:5%/);
});

test("renderFooterLines renders a weekly-only Codex quota gauge", () => {
  const weeklyOnlyProviderStatus: ProviderStatusSnapshot = {
    provider: "openai-codex",
    source: "api",
    fetchedAt: "2026-07-15T20:34:35Z",
    state: "ok",
    primary: {
      label: "7d",
      leftPercent: 84,
      usedPercent: 16,
    },
  };
  const gaugeConfig: FooterConfigSnapshot = {
    ...footerConfig,
    gaugeStyle: "parallelograms",
    providerStatus: {
      ...footerConfig.providerStatus,
      display: "gauge",
    },
  };

  const lines = renderFooterLines(
    120,
    contextWithModel({
      provider: "openai",
      id: "gpt-5-codex",
      name: "GPT-5 Codex",
    }) as never,
    EMPTY_GIT_INFO,
    "off",
    theme as never,
    usageMetrics,
    gaugeConfig,
    [],
    [weeklyOnlyProviderStatus],
  );

  assert.match(lines.join("\n"), /%7d ▰▱▱▱▱ 16%/);
  assert.doesNotMatch(lines.join("\n"), /5h/);
});

test("renderFooterLines places reset countdowns beside matching gauges", () => {
  const nowMs = Date.parse("2026-06-16T10:00:00Z");
  const resetStatus: ProviderStatusSnapshot = {
    ...claudeProviderStatus,
    primary: {
      ...claudeProviderStatus.primary!,
      resetAt: (nowMs + (4 * 60 + 32) * 60_000) / 1000,
    },
    secondary: {
      ...claudeProviderStatus.secondary!,
      resetAt: (nowMs + (24 + 7) * 60 * 60_000) / 1000,
    },
  };
  const gaugeConfig: FooterConfigSnapshot = {
    ...footerConfig,
    gaugeStyle: "parallelograms",
    providerStatus: {
      ...footerConfig.providerStatus,
      display: "gauge",
    },
  };
  const ctx = contextWithModel({
    provider: "anthropic",
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4",
  }) as never;
  const render = (showReset?: "off" | "primary" | "all") =>
    renderFooterLines(
      160,
      ctx,
      EMPTY_GIT_INFO,
      "off",
      theme as never,
      usageMetrics,
      {
        ...gaugeConfig,
        providerStatus:
          showReset === undefined
            ? gaugeConfig.providerStatus
            : { ...gaugeConfig.providerStatus, showReset },
      },
      [],
      [resetStatus],
      nowMs,
    ).join("\n");

  assert.match(
    render("primary"),
    /5h ▱▱▱▱▱ 0% ~4h32m 7d ▰▱▱▱▱ 8%(?! ~1d7h)/,
  );
  assert.match(
    render(),
    /5h ▱▱▱▱▱ 0% ~4h32m 7d ▰▱▱▱▱ 8% ~1d7h/,
  );
  assert.doesNotMatch(render("off"), /~(?:4h32m|1d7h)/);
});

test("renderFooterLines renders gauge countdowns with the dim color", () => {
  const nowMs = Date.parse("2026-06-16T10:00:00Z");
  const colors: string[] = [];
  const coloredTheme = {
    fg: (color: string, text: string) => {
      colors.push(`${color}:${text}`);
      return text;
    },
    getColorMode: () => "truecolor" as const,
  };
  const status: ProviderStatusSnapshot = {
    ...claudeProviderStatus,
    primary: {
      ...claudeProviderStatus.primary!,
      resetAt: (nowMs + 2 * 60 * 60_000) / 1000,
    },
  };
  renderFooterLines(
    120,
    contextWithModel({
      provider: "anthropic",
      id: "claude-sonnet-4",
      name: "Claude Sonnet 4",
    }) as never,
    EMPTY_GIT_INFO,
    "off",
    coloredTheme as never,
    usageMetrics,
    {
      ...footerConfig,
      providerStatus: { ...footerConfig.providerStatus, display: "gauge" },
    },
    [],
    [status],
    nowMs,
  );

  assert.ok(colors.includes("dim: ~2h"));
});

test("renderFooterLines respects reset mode for secondary-only gauges", () => {
  const nowMs = Date.parse("2026-06-16T10:00:00Z");
  const secondaryOnly: ProviderStatusSnapshot = {
    provider: "anthropic",
    source: "api",
    fetchedAt: new Date(nowMs).toISOString(),
    state: "ok",
    secondary: {
      ...claudeProviderStatus.secondary!,
      resetAt: (nowMs + 5 * 24 * 60 * 60_000) / 1000,
    },
  };
  const ctx = contextWithModel({
    provider: "anthropic",
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4",
  }) as never;
  const render = (showReset: "primary" | "all") =>
    renderFooterLines(
      120,
      ctx,
      EMPTY_GIT_INFO,
      "off",
      theme as never,
      usageMetrics,
      {
        ...footerConfig,
        providerStatus: {
          ...footerConfig.providerStatus,
          display: "gauge",
          showReset,
        },
      },
      [],
      [secondaryOnly],
      nowMs,
    ).join("\n");

  assert.doesNotMatch(render("primary"), /~5d/);
  assert.match(render("all"), /7d .* 8% ~5d/);
});

test("renderFooterLines annotates a weekly-only Codex primary gauge", () => {
  const nowMs = Date.parse("2026-06-16T10:00:00Z");
  const weeklyOnly: ProviderStatusSnapshot = {
    provider: "openai-codex",
    source: "api",
    fetchedAt: new Date(nowMs).toISOString(),
    state: "ok",
    primary: {
      label: "7d",
      leftPercent: 96,
      usedPercent: 4,
      resetAt: (nowMs + (5 * 24 + 4) * 60 * 60_000) / 1000,
    },
  };
  const lines = renderFooterLines(
    120,
    contextWithModel({
      provider: "openai",
      id: "gpt-5-codex",
      name: "GPT-5 Codex",
    }) as never,
    EMPTY_GIT_INFO,
    "off",
    theme as never,
    usageMetrics,
    {
      ...footerConfig,
      providerStatus: { ...footerConfig.providerStatus, display: "gauge" },
    },
    [],
    [weeklyOnly],
    nowMs,
  );

  assert.match(lines.join("\n"), /7d .* 4% ~5d4h/);
  assert.doesNotMatch(lines.join("\n"), /5h/);
});

test("renderFooterLines matches header-derived countdowns to each window", () => {
  const nowMs = Date.parse("2026-06-16T10:00:00Z");
  const status = parseCodexRateLimitHeaders(
    {
      "x-codex-primary-used-percent": "20",
      "x-codex-primary-window-minutes": "300",
      "x-codex-primary-reset-at": String(nowMs / 1000 + 2 * 60 * 60),
      "x-codex-secondary-used-percent": "40",
      "x-codex-secondary-window-minutes": "10080",
      "x-codex-secondary-reset-at": String(
        nowMs / 1000 + (5 * 24 + 4) * 60 * 60,
      ),
    },
    new Date(nowMs),
  );
  assert.ok(status);

  const lines = renderFooterLines(
    160,
    contextWithModel({
      provider: "openai",
      id: "gpt-5-codex",
      name: "GPT-5 Codex",
    }) as never,
    EMPTY_GIT_INFO,
    "off",
    theme as never,
    usageMetrics,
    {
      ...footerConfig,
      gaugeStyle: "parallelograms",
      providerStatus: {
        ...footerConfig.providerStatus,
        display: "gauge",
        showReset: "all",
      },
    },
    [],
    [status],
    nowMs,
  );

  assert.match(
    lines.join("\n"),
    /5h ▰▱▱▱▱ 20% ~2h 7d ▰▰▱▱▱ 40% ~5d4h/,
  );
});

test("renderFooterLines shows Anthropic provider status for Claude models", () => {
  const lines = renderFooterLines(
    120,
    contextWithModel({
      provider: "anthropic",
      id: "claude-sonnet-4",
      name: "Claude Sonnet 4",
    }) as never,
    EMPTY_GIT_INFO,
    "off",
    theme as never,
    usageMetrics,
    footerConfig,
    [],
    [claudeProviderStatus],
  );

  assert.match(lines.join("\n"), /5h:0% 7d:8%/);
});

test("renderFooterLines shows the model-scoped weekly window for the active model", () => {
  const scopedProviderStatus: ProviderStatusSnapshot = {
    ...claudeProviderStatus,
    scoped: [
      { label: "7d", model: "Fable", leftPercent: 4, usedPercent: 96 },
    ],
  };
  const render = (model: { id: string; name: string; provider?: string }) =>
    renderFooterLines(
      120,
      contextWithModel(model) as never,
      EMPTY_GIT_INFO,
      "off",
      theme as never,
      usageMetrics,
      footerConfig,
      [],
      [scopedProviderStatus],
    ).join("\n");

  assert.match(
    render({
      provider: "anthropic",
      id: "claude-fable-5",
      name: "Claude Fable 5",
    }),
    /5h:0% 7d:96%/,
  );
  assert.match(
    render({
      provider: "anthropic",
      id: "claude-sonnet-4",
      name: "Claude Sonnet 4",
    }),
    /5h:0% 7d:8%/,
  );
});

test("renderFooterLines hides Anthropic provider status for OpenAI models", () => {
  const lines = renderFooterLines(
    120,
    contextWithModel({
      provider: "openai",
      id: "gpt-5-codex",
      name: "GPT-5 Codex",
    }) as never,
    EMPTY_GIT_INFO,
    "off",
    theme as never,
    usageMetrics,
    footerConfig,
    [],
    [claudeProviderStatus],
  );

  assert.doesNotMatch(lines.join("\n"), /5h:0%/);
});

const cacheUsageMetrics: SessionUsageMetrics = {
  latest: { input: 1000, cacheRead: 8000, cacheWrite: 1000, cost: 0.1 },
  totalCost: 0.1,
  totalCacheRead: 20_000,
  totalCacheWrite: 3000,
};

test("renderFooterLines shows cache widgets when cache tokens accrued", () => {
  const lines = renderFooterLines(
    120,
    contextWithModel({
      provider: "anthropic",
      id: "claude-sonnet-4",
      name: "Claude Sonnet 4",
    }) as never,
    EMPTY_GIT_INFO,
    "off",
    theme as never,
    cacheUsageMetrics,
    footerConfig,
  );

  const out = lines.join("\n");
  assert.match(out, /R20k/);
  assert.match(out, /W3k/);
  assert.match(out, /H80\.0%/);
});

test("renderFooterLines hides cache widgets without cache activity", () => {
  const lines = renderFooterLines(
    120,
    contextWithModel({
      provider: "anthropic",
      id: "claude-sonnet-4",
      name: "Claude Sonnet 4",
    }) as never,
    EMPTY_GIT_INFO,
    "off",
    theme as never,
    usageMetrics,
    footerConfig,
  );

  const out = lines.join("\n");
  assert.doesNotMatch(out, /R\d/);
  assert.doesNotMatch(out, /W\d/);
  assert.doesNotMatch(out, /H\d/);
});

test("renderFooterLines hides the commit SHA unless enabled", () => {
  const ctx = contextWithModel({
    provider: "anthropic",
    id: "claude-sonnet-4",
    name: "Claude Sonnet 4",
  }) as never;
  const git = { ...EMPTY_GIT_INFO, commit: "abc1234" };

  const hidden = renderFooterLines(
    120,
    ctx,
    git,
    "off",
    theme as never,
    usageMetrics,
    footerConfig,
  );
  assert.doesNotMatch(hidden.join("\n"), /abc1234/);

  const enabledConfig: FooterConfigSnapshot = {
    ...footerConfig,
    widgets: { ...footerConfig.widgets, commit: { enabled: true } },
  };
  const shown = renderFooterLines(
    120,
    ctx,
    git,
    "off",
    theme as never,
    usageMetrics,
    enabledConfig,
  );
  assert.match(shown.join("\n"), /#abc1234/);
});

test("renderFooterLines distinguishes auto-merge and merged PR icons", () => {
  const colors: string[] = [];
  const coloredTheme = {
    fg: (color: string, text: string) => {
      colors.push(`${color}:${text}`);
      return text;
    },
    getColorMode: () => "truecolor" as const,
  };
  const ctx = contextWithModel({
    provider: "openai",
    id: "gpt-5-codex",
    name: "GPT-5 Codex",
  }) as never;
  const pullRequest = {
    number: 42,
    url: "https://github.com/org/repo/pull/42",
    state: "merged" as const,
  };

  const mergedLines = renderFooterLines(
    120,
    ctx,
    { ...EMPTY_GIT_INFO, pullRequest },
    "off",
    coloredTheme as never,
    usageMetrics,
    footerConfig,
  );
  assert.ok(mergedLines.join("\n").includes(MERGED_TRUECOLOR));

  colors.length = 0;
  renderFooterLines(
    120,
    ctx,
    {
      ...EMPTY_GIT_INFO,
      pullRequest: {
        ...pullRequest,
        state: "open",
        autoMergeEnabled: true,
      },
    },
    "off",
    coloredTheme as never,
    usageMetrics,
    footerConfig,
  );
  assert.ok(colors.includes("accent:@"));

  colors.length = 0;
  renderFooterLines(
    120,
    ctx,
    {
      ...EMPTY_GIT_INFO,
      pullRequest: { ...pullRequest, state: "open" },
    },
    "off",
    coloredTheme as never,
    usageMetrics,
    footerConfig,
  );
  assert.ok(colors.includes("text:@"));

  colors.length = 0;
  const overriddenLines = renderFooterLines(
    120,
    ctx,
    { ...EMPTY_GIT_INFO, pullRequest },
    "off",
    coloredTheme as never,
    usageMetrics,
    {
      ...footerConfig,
      widgets: {
        ...footerConfig.widgets,
        "pull-request": { iconColor: "warning" },
      },
    },
  );
  assert.ok(colors.includes("warning:@"));
  assert.equal(overriddenLines.join("\n").includes(MERGED_TRUECOLOR), false);

  const limitedColorTheme = {
    ...coloredTheme,
    getColorMode: () => "256color" as const,
  };
  const limitedColorLines = renderFooterLines(
    120,
    ctx,
    { ...EMPTY_GIT_INFO, pullRequest },
    "off",
    limitedColorTheme as never,
    usageMetrics,
    footerConfig,
  );
  assert.ok(limitedColorLines.join("\n").includes(MERGED_256COLOR));
});

const contextBarUsage = { contextWindow: 200_000, tokens: 92_000, percent: 46 };

function contextBarFooterConfig(
  contextBarOverride: FooterConfigSnapshot["widgets"]["context-bar"],
): FooterConfigSnapshot {
  return {
    ...DEFAULT_FOOTER_CONFIG,
    iconFamily: "ascii",
    gaugeStyle: "bars",
    widgets: {
      ...(contextBarOverride ? { "context-bar": contextBarOverride } : {}),
      location: { enabled: false },
    },
  };
}

test("renderFooterLines keeps the compact context gauge by default", () => {
  const lines = renderFooterLines(
    120,
    contextWithModel(
      { provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4" },
      contextBarUsage,
    ) as never,
    EMPTY_GIT_INFO,
    "off",
    theme as never,
    usageMetrics,
    contextBarFooterConfig(undefined),
  );

  const row = lines[0] ?? "";
  assert.match(row, /█+░+ \d+%/);
  assert.equal(
    (row.match(/[█░]/g) ?? []).length,
    DEFAULT_FOOTER_CONFIG.gaugeWidth,
  );
});

test("renderFooterLines grows the context bar across the row when configured", () => {
  const lines = renderFooterLines(
    120,
    contextWithModel(
      { provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4" },
      contextBarUsage,
    ) as never,
    EMPTY_GIT_INFO,
    "off",
    theme as never,
    usageMetrics,
    contextBarFooterConfig({ fill: "grow" }),
  );

  const row = lines[0] ?? "";
  assert.equal(visibleWidth(row), 120);
  assert.match(row, /92k █+░+/);
  assert.ok((row.match(/[█░]/g) ?? []).length > 60);
  assert.doesNotMatch(row, /%/);
});

test("renderFooterLines hides context capacity unless enabled", () => {
  const usage = { contextWindow: 1_000_000, tokens: 92_000, percent: 9 };
  const ctx = contextWithModel(
    { provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4" },
    usage,
  ) as never;

  const hidden = renderFooterLines(
    120,
    ctx,
    EMPTY_GIT_INFO,
    "off",
    theme as never,
    usageMetrics,
    contextBarFooterConfig(undefined),
  );
  assert.doesNotMatch(hidden.join("\n"), /1M/);

  const config = contextBarFooterConfig(undefined);
  config.widgets["context-capacity"] = { enabled: true };
  const shown = renderFooterLines(
    120,
    ctx,
    EMPTY_GIT_INFO,
    "off",
    theme as never,
    usageMetrics,
    config,
  );
  assert.match(shown.join("\n"), /\[\]1M/);
});

test("renderFooterLines clamps a grown context bar at narrow widths", () => {
  const lines = renderFooterLines(
    38,
    contextWithModel(
      { provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4" },
      contextBarUsage,
    ) as never,
    EMPTY_GIT_INFO,
    "off",
    theme as never,
    usageMetrics,
    contextBarFooterConfig({ fill: "grow" }),
  );

  const row = lines[0] ?? "";
  assert.ok(visibleWidth(row) <= 38);
  assert.match(row, /[█░]/);
});

test("renderFooterLines truncates countdown gauges ANSI-safely", () => {
  const nowMs = Date.parse("2026-06-16T10:00:00Z");
  const ansiTheme = {
    fg: (_color: string, text: string) => `\x1b[2m${text}\x1b[0m`,
    getColorMode: () => "truecolor" as const,
  };
  const status: ProviderStatusSnapshot = {
    ...claudeProviderStatus,
    primary: {
      ...claudeProviderStatus.primary!,
      resetAt: (nowMs + (4 * 60 + 32) * 60_000) / 1000,
    },
    secondary: {
      ...claudeProviderStatus.secondary!,
      resetAt: (nowMs + (24 + 7) * 60 * 60_000) / 1000,
    },
  };
  const config: FooterConfigSnapshot = {
    ...footerConfig,
    gaugeStyle: "parallelograms",
    providerStatus: {
      ...footerConfig.providerStatus,
      display: "gauge",
      showReset: "all",
    },
    widgets: {
      ...footerConfig.widgets,
      "context-bar": { enabled: true },
    },
  };

  for (const width of [16, 24, 32, 40]) {
    const lines = renderFooterLines(
      width,
      contextWithModel({
        provider: "anthropic",
        id: "claude-sonnet-4",
        name: "Claude Sonnet 4",
      }) as never,
      EMPTY_GIT_INFO,
      "off",
      ansiTheme as never,
      usageMetrics,
      config,
      [],
      [status],
      nowMs,
    );
    for (const line of lines) {
      assert.ok(visibleWidth(line) <= width);
      assert.equal(line.replace(/\x1b\[[0-9;]*m/g, "").includes("\x1b"), false);
    }
  }
});
