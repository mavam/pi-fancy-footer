import assert from "node:assert/strict";
import test from "node:test";
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

function contextWithModel(model: { id: string; name: string; provider?: string }) {
  return {
    cwd: "/repo",
    model,
    getContextUsage: () => ({
      contextWindow: 200_000,
      tokens: 0,
      percent: 0,
    }),
    sessionManager: {
      getBranch: () => [],
    },
  };
}

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
