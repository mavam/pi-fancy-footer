import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
  type GaugeSegment,
  type GaugeStyleDef,
  type ProviderStatusConfigSnapshot,
  type ProviderStatusSnapshot,
  type ProviderStatusState,
  type ProviderStatusWindow,
  buildGauge,
  formatGaugePercent,
  gaugeSeverity,
} from "./shared.ts";

export const CODEX_USAGE_URL = "https://chatgpt.com/codex/settings/usage";
const CODEX_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_PRIMARY_WINDOW_LABEL = "5h";
const CODEX_SECONDARY_WINDOW_LABEL = "7d";

type HeaderLike = Record<string, string | number | boolean | undefined | null>;

export interface ProviderStatusSource {
  id: string;
  label: string;
  usageUrl: string;
  fetch(pi: ExtensionAPI): Promise<ProviderStatusSnapshot>;
  parseHeaders(
    headers: HeaderLike,
    now?: Date,
  ): ProviderStatusSnapshot | undefined;
}

const CODEX_SOURCE: ProviderStatusSource = {
  id: "openai-codex",
  label: "Codex",
  usageUrl: CODEX_USAGE_URL,
  fetch: fetchCodexProviderStatus,
  parseHeaders: parseCodexRateLimitHeaders,
};

export const PROVIDER_STATUS_SOURCES: readonly ProviderStatusSource[] = [
  CODEX_SOURCE,
];

function enabledProviderStatusSources(
  config: Pick<ProviderStatusConfigSnapshot, "providers">,
): readonly ProviderStatusSource[] {
  return PROVIDER_STATUS_SOURCES.filter((source) =>
    config.providers.includes(source.id),
  );
}

interface AuthCredentials {
  source: "pi" | "codex";
  path: string;
  accessToken: string;
  refreshToken?: string;
  accountId?: string;
  expiresAtMs?: number;
  raw: Record<string, unknown>;
}

export function formatProviderStatusText(
  snapshot: ProviderStatusSnapshot | undefined,
  config: Pick<ProviderStatusConfigSnapshot, "showCredits" | "showReset">,
): string {
  if (!snapshot) return "";
  if (
    snapshot.state === "unavailable" &&
    (!config.showCredits || !snapshot.credits)
  ) {
    return "";
  }

  const parts: string[] = [];
  if (snapshot.primary) {
    parts.push(
      `${snapshot.primary.label}:${formatGaugePercent(snapshot.primary.leftPercent)}`,
    );
  }
  if (snapshot.secondary) {
    parts.push(
      `${snapshot.secondary.label}:${formatGaugePercent(snapshot.secondary.leftPercent)}`,
    );
  }
  if (config.showReset && snapshot.primary?.resetAt) {
    const reset = formatReset(snapshot.primary.resetAt);
    if (reset) parts.push(`reset:${reset}`);
  }
  if (config.showCredits && snapshot.credits) {
    parts.push(`cr:${snapshot.credits}`);
  }

  return parts.join(" ");
}

export function providerStatusColor(
  snapshot: ProviderStatusSnapshot | undefined,
): "success" | "warning" | "error" | "dim" {
  if (!snapshot || snapshot.state === "unavailable") return "dim";
  if (snapshot.state === "error") return "error";
  if (snapshot.state === "warning") return "warning";
  return "success";
}

export interface ProviderStatusGaugeSegment extends GaugeSegment {
  label: string;
}

export function buildProviderStatusGauge(
  snapshot: ProviderStatusSnapshot | undefined,
  style: GaugeStyleDef,
  cells: number,
): ProviderStatusGaugeSegment[] {
  if (!snapshot) return [];
  const segments: ProviderStatusGaugeSegment[] = [];
  for (const window of [snapshot.primary, snapshot.secondary]) {
    if (!window) continue;
    segments.push({
      label: window.label,
      ...buildGauge(window.leftPercent, style, cells),
    });
  }
  return segments;
}

export async function collectProviderStatus(
  pi: ExtensionAPI,
  config: ProviderStatusConfigSnapshot,
): Promise<ProviderStatusSnapshot[]> {
  const snapshots = await Promise.all(
    enabledProviderStatusSources(config).map((source) =>
      collectProviderStatusFromSource(pi, source, config),
    ),
  );
  return snapshots;
}

async function collectProviderStatusFromSource(
  pi: ExtensionAPI,
  source: ProviderStatusSource,
  config: ProviderStatusConfigSnapshot,
): Promise<ProviderStatusSnapshot> {
  const cached = await readProviderStatusCache(source.id);
  if (isProviderStatusFresh(cached, config.cacheTtlMs)) {
    return { ...cached, source: "cache" };
  }

  try {
    const snapshot = await source.fetch(pi);
    await writeProviderStatusCache(snapshot).catch(() => undefined);
    return snapshot;
  } catch (error) {
    if (isProviderStatusFresh(cached, config.cacheTtlMs)) {
      return { ...cached, source: "cache" };
    }
    return {
      provider: source.id,
      source: "api",
      fetchedAt: new Date().toISOString(),
      state: "unavailable",
      url: source.usageUrl,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function updateProviderStatusFromHeaders(
  headers: HeaderLike,
  config?: ProviderStatusConfigSnapshot,
): Promise<ProviderStatusSnapshot[]> {
  const sources = config
    ? enabledProviderStatusSources(config)
    : PROVIDER_STATUS_SOURCES;

  const updated: ProviderStatusSnapshot[] = [];
  for (const source of sources) {
    const parsed = source.parseHeaders(headers);
    if (!parsed) continue;

    const cached = await readProviderStatusCache(source.id);
    const freshCached =
      config && isProviderStatusFresh(cached, config.cacheTtlMs)
        ? cached
        : undefined;
    const merged = mergeProviderStatus(freshCached, parsed);
    await writeProviderStatusCache(merged).catch(() => undefined);
    updated.push(merged);
  }
  return updated;
}

export function parseCodexRateLimitHeaders(
  headers: HeaderLike,
  now = new Date(),
): ProviderStatusSnapshot | undefined {
  const primary = parseHeaderWindow(
    headers,
    "x-codex-primary",
    CODEX_PRIMARY_WINDOW_LABEL,
    now,
  );
  const secondary = parseHeaderWindow(
    headers,
    "x-codex-secondary",
    CODEX_SECONDARY_WINDOW_LABEL,
    now,
  );
  const credits = headerValue(headers, "x-codex-credits-balance");
  if (!primary && !secondary && credits === undefined) return undefined;

  return {
    provider: "openai-codex",
    source: "headers",
    fetchedAt: now.toISOString(),
    state: computeProviderStatusState(primary, secondary),
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
    ...(credits ? { credits } : {}),
    url: CODEX_USAGE_URL,
  };
}

export function normalizeCodexUsageResponse(
  value: unknown,
  now = new Date(),
): ProviderStatusSnapshot | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const obj = value as Record<string, unknown>;
  const rateLimit = objectValue(obj.rate_limit);
  const primary = normalizeApiWindow(
    objectValue(rateLimit?.primary_window),
    CODEX_PRIMARY_WINDOW_LABEL,
    now,
  );
  const secondary = normalizeApiWindow(
    objectValue(rateLimit?.secondary_window),
    CODEX_SECONDARY_WINDOW_LABEL,
    now,
  );
  const creditsObj = objectValue(obj.credits);
  const credits = stringValue(creditsObj?.balance);
  if (!primary && !secondary && credits === undefined) return undefined;

  return {
    provider: "openai-codex",
    source: "api",
    fetchedAt: now.toISOString(),
    state: computeProviderStatusState(primary, secondary),
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
    ...(credits !== undefined ? { credits } : {}),
    url: CODEX_USAGE_URL,
  };
}

export function isProviderStatusFresh(
  snapshot: ProviderStatusSnapshot | undefined,
  maxAgeMs: number,
): snapshot is ProviderStatusSnapshot {
  if (!snapshot) return false;
  const fetchedAt = Date.parse(snapshot.fetchedAt);
  if (!Number.isFinite(fetchedAt)) return false;
  const age = Date.now() - fetchedAt;
  return age >= 0 && age <= maxAgeMs;
}

async function fetchCodexProviderStatus(
  _pi: ExtensionAPI,
): Promise<ProviderStatusSnapshot> {
  let auth = await resolveAuth();

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(CODEX_USAGE_ENDPOINT, {
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        accept: "application/json",
        "user-agent": "pi-fancy-footer",
        ...(auth.accountId ? { "chatgpt-account-id": auth.accountId } : {}),
      },
    });
    const text = await response.text();

    if (response.ok) {
      const parsed = normalizeCodexUsageResponse(JSON.parse(text));
      if (parsed) return parsed;
      throw new Error("Codex usage response did not contain quota data");
    }

    if (
      (response.status === 401 || response.status === 403) &&
      attempt === 0 &&
      auth.refreshToken
    ) {
      auth = await refreshAuth(auth);
      continue;
    }

    throw new Error(
      `Codex usage request failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }

  throw new Error("Codex usage request failed after auth refresh");
}

async function resolveAuth(): Promise<AuthCredentials> {
  const pi = await readAuthFile("pi", homePath(".pi/agent/auth.json"));
  if (pi) return refreshIfNeeded(pi);

  const codex = await readAuthFile("codex", homePath(".codex/auth.json"));
  if (codex) return refreshIfNeeded(codex);

  throw new Error(
    "No usable Codex OAuth credentials found. Run pi /login for OpenAI Codex or `codex login` first.",
  );
}

async function refreshIfNeeded(auth: AuthCredentials): Promise<AuthCredentials> {
  if (!auth.refreshToken || !auth.expiresAtMs) return auth;
  if (auth.expiresAtMs > Date.now() + 5 * 60 * 1000) return auth;
  return refreshAuth(auth);
}

async function refreshAuth(auth: AuthCredentials): Promise<AuthCredentials> {
  if (!auth.refreshToken) return auth;

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: auth.refreshToken,
    client_id: CODEX_CLIENT_ID,
  }).toString();

  const result = await localRefresh(body);

  if (result.code !== 0 || !result.stdout) {
    throw new Error(result.stderr || "Failed to refresh Codex auth");
  }

  const refreshed = JSON.parse(result.stdout) as Record<string, unknown>;
  const accessToken = stringValue(refreshed.access_token);
  if (!accessToken) {
    throw new Error("Codex auth refresh did not return access_token");
  }

  const refreshToken = stringValue(refreshed.refresh_token) ?? auth.refreshToken;
  const expiresIn = numberValue(refreshed.expires_in);
  const next: AuthCredentials = {
    ...auth,
    accessToken,
    refreshToken,
    ...(expiresIn !== undefined
      ? { expiresAtMs: Date.now() + expiresIn * 1000 }
      : {}),
  };
  await persistAuth(next);
  return next;
}

async function localRefresh(
  body: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await response.text();
    if (!response.ok) return { code: 1, stdout: "", stderr: text };
    return { code: 0, stdout: text, stderr: "" };
  } catch (error) {
    return {
      code: -1,
      stdout: "",
      stderr: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readAuthFile(
  source: "pi" | "codex",
  path: string,
): Promise<AuthCredentials | undefined> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    return source === "pi"
      ? parsePiAuth(raw as Record<string, unknown>, path)
      : parseCodexAuth(raw as Record<string, unknown>, path);
  } catch {
    return undefined;
  }
}

function parsePiAuth(
  raw: Record<string, unknown>,
  path: string,
): AuthCredentials | undefined {
  const entry = objectValue(raw["openai-codex"]);
  const accessToken = stringValue(entry?.access);
  if (!accessToken) return undefined;
  return {
    source: "pi",
    path,
    accessToken,
    ...(stringValue(entry?.refresh)
      ? { refreshToken: stringValue(entry?.refresh) }
      : {}),
    ...(stringValue(entry?.accountId)
      ? { accountId: stringValue(entry?.accountId) }
      : {}),
    ...(numberValue(entry?.expires)
      ? { expiresAtMs: numberValue(entry?.expires) }
      : {}),
    raw,
  };
}

function parseCodexAuth(
  raw: Record<string, unknown>,
  path: string,
): AuthCredentials | undefined {
  const tokens = objectValue(raw.tokens);
  const accessToken = stringValue(tokens?.access_token);
  if (!accessToken) return undefined;
  return {
    source: "codex",
    path,
    accessToken,
    ...(stringValue(tokens?.refresh_token)
      ? { refreshToken: stringValue(tokens?.refresh_token) }
      : {}),
    ...(stringValue(tokens?.account_id)
      ? { accountId: stringValue(tokens?.account_id) }
      : {}),
    raw,
  };
}

async function persistAuth(auth: AuthCredentials): Promise<void> {
  const raw = JSON.parse(await readFile(auth.path, "utf8")) as Record<
    string,
    unknown
  >;

  if (auth.source === "pi") {
    const entry = objectValue(raw["openai-codex"]);
    if (entry) {
      entry.access = auth.accessToken;
      if (auth.refreshToken) entry.refresh = auth.refreshToken;
      if (auth.expiresAtMs) entry.expires = auth.expiresAtMs;
    }
  } else {
    const tokens = objectValue(raw.tokens);
    if (tokens) {
      tokens.access_token = auth.accessToken;
      if (auth.refreshToken) tokens.refresh_token = auth.refreshToken;
    }
    raw.last_refresh = new Date().toISOString();
  }

  await writeJsonAtomic(auth.path, raw);
}

async function readProviderStatusCache(
  providerId: string,
): Promise<ProviderStatusSnapshot | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(providerStatusCachePath(providerId), "utf8"),
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    return parsed as ProviderStatusSnapshot;
  } catch {
    return undefined;
  }
}

async function writeProviderStatusCache(
  snapshot: ProviderStatusSnapshot,
): Promise<void> {
  await writeJsonAtomic(providerStatusCachePath(snapshot.provider), snapshot);
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}

function mergeProviderStatus(
  existing: ProviderStatusSnapshot | undefined,
  update: ProviderStatusSnapshot,
): ProviderStatusSnapshot {
  if (!existing) return update;
  const primary = update.primary ?? existing.primary;
  const secondary = update.secondary ?? existing.secondary;
  return {
    ...existing,
    ...update,
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
    ...(update.credits ?? existing.credits
      ? { credits: update.credits ?? existing.credits }
      : {}),
    state: computeProviderStatusState(primary, secondary),
  };
}

function parseHeaderWindow(
  headers: HeaderLike,
  prefix: string,
  label: string,
  now: Date,
): ProviderStatusWindow | undefined {
  const usedPercent = numberString(
    headerValue(headers, `${prefix}-used-percent`),
  );
  const resetAt = normalizeResetAt(
    numberString(headerValue(headers, `${prefix}-reset-at`)),
  );
  if (usedPercent === undefined && resetAt === undefined) return undefined;
  return windowFromUsedPercent(label, usedPercent ?? 0, resetAt, now);
}

function normalizeApiWindow(
  value: Record<string, unknown> | undefined,
  fallbackLabel: string,
  now: Date,
): ProviderStatusWindow | undefined {
  if (!value) return undefined;
  const usedPercent = numberValue(value.used_percent);
  const resetAt = normalizeResetAt(numberValue(value.reset_at));
  if (usedPercent === undefined && resetAt === undefined) return undefined;
  const label =
    windowLabelFromSeconds(numberValue(value.limit_window_seconds)) ??
    fallbackLabel;
  return windowFromUsedPercent(label, usedPercent ?? 0, resetAt, now);
}

function windowLabelFromSeconds(seconds: number | undefined): string | undefined {
  if (seconds === undefined || seconds <= 0) return undefined;
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return undefined;
}

function windowFromUsedPercent(
  label: string,
  usedPercent: number,
  resetAt: number | undefined,
  _now: Date,
): ProviderStatusWindow {
  const clampedUsed = Math.max(0, Math.min(100, usedPercent));
  return {
    label,
    usedPercent: clampedUsed,
    leftPercent: Math.max(0, Math.min(100, 100 - clampedUsed)),
    ...(resetAt !== undefined ? { resetAt } : {}),
  };
}

function computeProviderStatusState(
  primary: ProviderStatusWindow | undefined,
  secondary: ProviderStatusWindow | undefined,
): ProviderStatusState {
  const values = [primary?.leftPercent, secondary?.leftPercent].filter(
    (value): value is number => value !== undefined,
  );
  if (values.length === 0) return "unavailable";
  const severity = gaugeSeverity(Math.min(...values));
  return severity === "success" ? "ok" : severity;
}

export function formatProviderStatusReset(resetAt: number): string {
  return formatReset(resetAt);
}

function formatReset(resetAt: number): string {
  const date = new Date(resetAt * 1000);
  if (!Number.isFinite(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

function normalizeResetAt(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return value > 10_000_000_000 ? Math.round(value / 1000) : value;
}

function providerStatusCachePath(providerId: string): string {
  const base =
    process.env.XDG_CACHE_HOME ||
    join(process.env.HOME || process.env.USERPROFILE || ".", ".cache");
  return join(base, "pi-fancy-footer", "provider-status", `${providerId}.json`);
}

function homePath(relative: string): string {
  return join(process.env.HOME || process.env.USERPROFILE || ".", relative);
}

function headerValue(headers: HeaderLike, name: string): string | undefined {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted && value !== undefined && value !== null) {
      return String(value);
    }
  }
  return undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberString(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
