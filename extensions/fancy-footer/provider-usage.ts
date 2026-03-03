import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { ModelProviderUsageMetrics, ProviderUsageWindow } from "./shared.ts";

const PROVIDER_USAGE_REFRESH_MS = 60_000;
const PROVIDER_USAGE_RETRY_MS = 30_000;
const PROVIDER_USAGE_TIMEOUT_MS = 8_000;

const CLAUDE_USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_BETA_HEADER = "oauth-2025-04-20";

type SupportedProvider = "openai-codex" | "anthropic";

export interface ProviderUsageState {
  provider: SupportedProvider;
  metrics: ModelProviderUsageMetrics | undefined;
  nextRefreshAt: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return n;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function toPercent(value: unknown): number | undefined {
  const n = asNumber(value);
  if (n === undefined) return undefined;
  return Math.max(0, Math.min(100, n));
}

function toUtilizationPercent(value: unknown): number | undefined {
  const n = asNumber(value);
  if (n === undefined) return undefined;
  const scaled = n > 1 ? n : n * 100;
  return Math.max(0, Math.min(100, scaled));
}

function toEpochMsFromSeconds(value: unknown): number | undefined {
  const seconds = asNumber(value);
  if (seconds === undefined) return undefined;
  return Math.max(0, Math.floor(seconds * 1000));
}

function toEpochMsFromIso(value: unknown): number | undefined {
  const text = asString(value);
  if (!text) return undefined;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return undefined;
  return ms;
}

function parseWindowFromCodex(value: unknown): ProviderUsageWindow | undefined {
  const window = asRecord(value);
  if (!window) return undefined;

  const usedPercent = toPercent(window.used_percent);
  if (usedPercent === undefined) return undefined;

  return {
    usedPercent,
    resetAtMs: toEpochMsFromSeconds(window.reset_at),
  };
}

function parseWindowFromClaude(value: unknown): ProviderUsageWindow | undefined {
  const window = asRecord(value);
  if (!window) return undefined;

  const usedPercent = toUtilizationPercent(window.utilization);
  if (usedPercent === undefined) return undefined;

  return {
    usedPercent,
    resetAtMs: toEpochMsFromIso(window.resets_at),
  };
}

function parseTomlStringValue(raw: string): string {
  const trimmed = raw.trim();
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function loadCodexBaseUrlFromConfig(): string | undefined {
  const codexHome = process.env.CODEX_HOME?.trim();
  const root = codexHome ? codexHome : join(homedir(), ".codex");
  const configPath = join(root, "config.toml");

  try {
    if (!existsSync(configPath)) return undefined;
    const content = readFileSync(configPath, "utf8");

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.split("#", 1)[0]?.trim() ?? "";
      if (!line) continue;

      const idx = line.indexOf("=");
      if (idx <= 0) continue;

      const key = line.slice(0, idx).trim();
      if (key !== "chatgpt_base_url") continue;

      const value = parseTomlStringValue(line.slice(idx + 1));
      if (value) return value;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function normalizeCodexBaseUrl(baseUrl: string): string {
  let normalized = baseUrl.trim();
  if (!normalized) normalized = "https://chatgpt.com/backend-api";

  while (normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  if ((normalized.startsWith("https://chatgpt.com") || normalized.startsWith("https://chat.openai.com"))
    && !normalized.includes("/backend-api")) {
    normalized += "/backend-api";
  }

  return normalized;
}

function resolveCodexUsageUrl(): string {
  const configured = loadCodexBaseUrlFromConfig();
  const baseUrl = normalizeCodexBaseUrl(configured ?? "https://chatgpt.com/backend-api");
  const path = baseUrl.includes("/backend-api") ? "/wham/usage" : "/api/codex/usage";
  return `${baseUrl}${path}`;
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_USAGE_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchCodexUsage(ctx: ExtensionContext): Promise<ModelProviderUsageMetrics | undefined> {
  const accessToken = await ctx.modelRegistry.getApiKeyForProvider("openai-codex");
  if (!accessToken) return undefined;

  const credential = ctx.modelRegistry.authStorage.get("openai-codex");
  const accountId = credential?.type === "oauth"
    ? asString(credential.accountId) ?? asString(credential.account_id)
    : undefined;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    "User-Agent": "pi-fancy-footer",
  };

  if (accountId) {
    headers["ChatGPT-Account-Id"] = accountId;
  }

  const data = await fetchJson(resolveCodexUsageUrl(), {
    method: "GET",
    headers,
  });

  const root = asRecord(data);
  const rateLimit = asRecord(root?.rate_limit);
  const primary = parseWindowFromCodex(rateLimit?.primary_window);
  if (!primary) return undefined;

  return {
    provider: "openai-codex",
    label: "Codex",
    primary,
    secondary: parseWindowFromCodex(rateLimit?.secondary_window),
    fetchedAt: Date.now(),
  };
}

async function fetchClaudeUsage(ctx: ExtensionContext): Promise<ModelProviderUsageMetrics | undefined> {
  const accessToken = await ctx.modelRegistry.getApiKeyForProvider("anthropic");
  if (!accessToken) return undefined;

  const data = await fetchJson(CLAUDE_USAGE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "anthropic-beta": CLAUDE_BETA_HEADER,
      "User-Agent": "pi-fancy-footer",
    },
  });

  const root = asRecord(data);
  const primary = parseWindowFromClaude(root?.five_hour);
  if (!primary) return undefined;

  return {
    provider: "anthropic",
    label: "Claude",
    primary,
    secondary: parseWindowFromClaude(root?.seven_day),
    fetchedAt: Date.now(),
  };
}

function toSupportedProvider(provider: string): SupportedProvider | undefined {
  if (provider === "openai-codex" || provider === "anthropic") {
    return provider;
  }
  return undefined;
}

export async function collectProviderUsage(
  ctx: ExtensionContext,
  state: ProviderUsageState | undefined,
): Promise<ProviderUsageState | undefined> {
  const model = ctx.model;
  if (!model) return undefined;

  const provider = toSupportedProvider(model.provider);
  if (!provider) return undefined;

  if (!ctx.modelRegistry.isUsingOAuth(model)) {
    return undefined;
  }

  const now = Date.now();
  if (state && state.provider === provider && now < state.nextRefreshAt) {
    return state;
  }

  try {
    const metrics = provider === "openai-codex"
      ? await fetchCodexUsage(ctx)
      : await fetchClaudeUsage(ctx);

    return {
      provider,
      metrics,
      nextRefreshAt: now + PROVIDER_USAGE_REFRESH_MS,
    };
  } catch {
    return {
      provider,
      metrics: state?.provider === provider ? state.metrics : undefined,
      nextRefreshAt: now + PROVIDER_USAGE_RETRY_MS,
    };
  }
}
