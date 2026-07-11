import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderFooterLines } from "./render.ts";
import {
  DEFAULT_FOOTER_CONFIG,
  EMPTY_GIT_INFO,
  type FooterConfigSnapshot,
  type ProviderStatusSnapshot,
  type SessionUsageMetrics,
} from "./shared.ts";

const theme = {
  fg: (_color: string, text: string) => text,
};

const usageMetrics: SessionUsageMetrics = {
  latest: undefined,
  totalCost: 0,
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

  assert.doesNotMatch(lines.join("\n"), /5h:95%/);
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

  assert.match(lines.join("\n"), /5h:95%/);
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

  assert.match(lines.join("\n"), /5h:100% 7d:92%/);
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

  assert.doesNotMatch(lines.join("\n"), /5h:100%/);
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
  assert.match(row, /200k$/);
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
