import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  type GaugeSegment,
  type GaugeStyleDef,
  type ProviderStatusConfigSnapshot,
  type ProviderStatusScopedWindow,
  type ProviderStatusSnapshot,
  type ProviderStatusState,
  type ProviderStatusWindow,
  buildGauge,
  displayedGaugePercent,
  formatGaugePercent,
  gaugeSeverity,
} from "./shared.ts";

export const CODEX_USAGE_URL = "https://chatgpt.com/codex/settings/usage";
const CODEX_USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_TOKEN_URL = "https://auth.openai.com/oauth/token";
const CODEX_PRIMARY_WINDOW_LABEL = "5h";
const CODEX_SECONDARY_WINDOW_LABEL = "7d";
export const CLAUDE_USAGE_URL = "https://claude.ai/settings/usage";
const CLAUDE_USAGE_ENDPOINT = "https://api.anthropic.com/api/oauth/usage";
const CLAUDE_CLIENT_ID = "https://claude.ai/oauth/claude-code-client-metadata";
const CLAUDE_TOKEN_URL = "https://platform.claude.com/v1/oauth/token";
const CLAUDE_PRIMARY_WINDOW_LABEL = "5h";
const CLAUDE_SECONDARY_WINDOW_LABEL = "7d";

type HeaderLike = Record<string, string | number | boolean | undefined | null>;

type TokenRefreshResult =
  | { ok: true; stdout: string }
  | { ok: false; error: Error };

export interface ProviderStatusSource {
  id: string;
  label: string;
  usageUrl: string;
  preserveMissingWindows: boolean;
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
  preserveMissingWindows: false,
  fetch: fetchCodexProviderStatus,
  parseHeaders: parseCodexRateLimitHeaders,
};

const ANTHROPIC_SOURCE: ProviderStatusSource = {
  id: "anthropic",
  label: "Claude",
  usageUrl: CLAUDE_USAGE_URL,
  preserveMissingWindows: true,
  fetch: fetchClaudeProviderStatus,
  parseHeaders: () => undefined,
};

export const PROVIDER_STATUS_SOURCES: readonly ProviderStatusSource[] = [
  CODEX_SOURCE,
  ANTHROPIC_SOURCE,
];

type ModelLike = {
  id?: unknown;
  name?: unknown;
  displayName?: unknown;
  provider?: unknown;
  providerId?: unknown;
};

function modelValue(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function looksLikeOpenAIModel(value: string): boolean {
  if (!value) return false;

  const normalized = value.replace(/[/_:\s]+/g, "-");
  return (
    normalized.includes("openai") ||
    normalized.includes("codex") ||
    normalized.includes("chatgpt") ||
    /(^|-)gpt(?:[0-9-]|$)/.test(normalized) ||
    /(^|-)o[134](?:-|$)/.test(normalized)
  );
}

function looksLikeAnthropicModel(value: string): boolean {
  if (!value) return false;

  const normalized = value.replace(/[/_:\s]+/g, "-");
  return (
    normalized.includes("anthropic") ||
    normalized.includes("claude") ||
    /(^|-)(sonnet|opus|haiku|fable)(?:-|$)/.test(normalized)
  );
}

function looksLikeProviderModel(providerId: string, value: string): boolean {
  if (providerId === CODEX_SOURCE.id) return looksLikeOpenAIModel(value);
  if (providerId === ANTHROPIC_SOURCE.id) return looksLikeAnthropicModel(value);
  return true;
}

export function isProviderStatusRelevantToModel(
  providerId: string,
  model: ModelLike | string | undefined,
): boolean {
  if (providerId !== CODEX_SOURCE.id && providerId !== ANTHROPIC_SOURCE.id) {
    return true;
  }

  if (typeof model === "string") {
    return looksLikeProviderModel(providerId, modelValue(model));
  }
  if (!model) return false;

  const provider = modelValue(model.provider) || modelValue(model.providerId);
  if (provider) return looksLikeProviderModel(providerId, provider);

  return [
    modelValue(model.id),
    modelValue(model.name),
    modelValue(model.displayName),
  ].some((value) => looksLikeProviderModel(providerId, value));
}

// Splits an identifier into lowercase alphanumeric tokens, so
// "eu.anthropic.claude-fable-5" becomes ["eu", "anthropic", "claude", "fable", "5"].
function modelTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

// A scoped window applies when every token of the provider's scope name occurs
// in the active model's identifier: scope "Fable" matches "claude-fable-5", and
// scope "Opus 4.5" matches "claude-opus-4-5-20251101" but not "claude-opus-4-1".
function scopeMatchesModel(
  scopeModel: string,
  model: ModelLike | string | undefined,
): boolean {
  const scopeTokens = modelTokens(scopeModel);
  if (scopeTokens.length === 0) return false;

  const candidates =
    typeof model === "string"
      ? [model]
      : model
        ? [model.id, model.name, model.displayName]
        : [];

  return candidates.some((candidate) => {
    if (typeof candidate !== "string") return false;
    const tokens = new Set(modelTokens(candidate));
    return scopeTokens.every((token) => tokens.has(token));
  });
}

/**
 * Resolves model-scoped quota windows against the active model. Scoped windows
 * replace the account-wide window that carries the same label, so a Fable
 * session shows the weekly Fable cap in the existing weekly slot instead of the
 * looser all-models number. When both caps are known the one with less headroom
 * wins: whichever runs out first is the limit that stops the session, so the
 * footer never reports more headroom than actually remains.
 */
export function projectProviderStatusForModel(
  snapshot: ProviderStatusSnapshot,
  model: ModelLike | string | undefined,
): ProviderStatusSnapshot {
  if (!snapshot.scoped || snapshot.scoped.length === 0) return snapshot;

  const applicable = snapshot.scoped.filter((window) =>
    scopeMatchesModel(window.model, model),
  );
  if (applicable.length === 0) return snapshot;

  const primary = applyScopedWindow(snapshot.primary, applicable);
  const secondary = applyScopedWindow(snapshot.secondary, applicable);
  if (primary === snapshot.primary && secondary === snapshot.secondary) {
    return snapshot;
  }

  return {
    ...snapshot,
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
    state: computeProviderStatusState(primary, secondary),
  };
}

function applyScopedWindow(
  window: ProviderStatusWindow | undefined,
  scoped: readonly ProviderStatusScopedWindow[],
): ProviderStatusWindow | undefined {
  const matches = scoped.filter(
    (candidate) => candidate.label === window?.label,
  );
  if (matches.length === 0) return window;

  let strictest = window;
  for (const match of matches) {
    if (strictest && match.usedPercent <= strictest.usedPercent) continue;
    const { model: _model, ...replacement } = match;
    strictest = replacement;
  }
  return strictest;
}

function enabledProviderStatusSources(
  config: Pick<ProviderStatusConfigSnapshot, "providers">,
): readonly ProviderStatusSource[] {
  return PROVIDER_STATUS_SOURCES.filter((source) =>
    config.providers.includes(source.id),
  );
}

interface AuthCredentials {
  provider: "openai-codex" | "anthropic";
  source: "pi" | "codex";
  path: string;
  accessToken: string;
  refreshToken?: string;
  accountId?: string;
  expiresAtMs?: number;
  raw: Record<string, unknown>;
}

export function resetCountdownText(
  window: Pick<ProviderStatusWindow, "usedPercent" | "resetAt">,
  role: "primary" | "secondary",
  config: Pick<
    ProviderStatusConfigSnapshot,
    "showReset" | "resetMinUsedPercent"
  >,
  nowMs: number,
): string {
  const roleEnabled =
    config.showReset === "all" ||
    (config.showReset === "primary" && role === "primary");
  const displayedUsedPercent = displayedGaugePercent(window.usedPercent);
  if (
    !roleEnabled ||
    window.resetAt === undefined ||
    displayedUsedPercent < config.resetMinUsedPercent
  ) {
    return "";
  }
  return formatResetCountdown(window.resetAt, nowMs);
}

export function formatProviderStatusText(
  snapshot: ProviderStatusSnapshot | undefined,
  config: Pick<
    ProviderStatusConfigSnapshot,
    "showCredits" | "showReset" | "resetMinUsedPercent"
  >,
  nowMs = Date.now(),
): string {
  if (!snapshot) return "";
  if (
    snapshot.state === "unavailable" &&
    (!config.showCredits || !snapshot.credits)
  ) {
    return "";
  }

  const parts: string[] = [];
  for (const [role, window] of [
    ["primary", snapshot.primary],
    ["secondary", snapshot.secondary],
  ] as const) {
    if (!window) continue;
    let part = `${window.label}:${formatGaugePercent(window.usedPercent)}`;
    const reset = resetCountdownText(window, role, config, nowMs);
    if (reset) part += ` ${reset}`;
    parts.push(part);
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
  role: "primary" | "secondary";
  usedPercent: number;
  resetAt?: number;
}

export function buildProviderStatusGauge(
  snapshot: ProviderStatusSnapshot | undefined,
  style: GaugeStyleDef,
  cells: number,
): ProviderStatusGaugeSegment[] {
  if (!snapshot) return [];
  const segments: ProviderStatusGaugeSegment[] = [];
  for (const [role, window] of [
    ["primary", snapshot.primary],
    ["secondary", snapshot.secondary],
  ] as const) {
    if (!window) continue;
    segments.push({
      label: window.label,
      role,
      usedPercent: window.usedPercent,
      ...(window.resetAt !== undefined ? { resetAt: window.resetAt } : {}),
      ...buildGauge(window.usedPercent, style, cells),
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
    // Anthropic refreshes can be partial and report only the weekly window.
    // Codex refreshes are authoritative: OpenAI can remove a window and promote
    // the weekly window to primary, so retaining a missing window would show a
    // stale or duplicated quota.
    const fresh = await source.fetch(pi);
    const merged = source.preserveMissingWindows
      ? mergeProviderStatus(displayableCachedStatus(cached), fresh)
      : fresh;
    const { error: _staleError, ...snapshot } = merged;
    await writeProviderStatusCache(snapshot).catch(() => undefined);
    return snapshot;
  } catch (error) {
    // A refresh failed. The cached quota windows remain valid until they
    // reset, regardless of why the refresh failed, so keep showing whichever
    // windows are still in effect.
    return (
      displayableCachedStatus(cached, error) ??
      unavailableProviderStatus(source, error)
    );
  }
}

// Projects a cached snapshot onto the windows that are still in effect, i.e.
// have not reset yet. Returns undefined when nothing is left to display.
function displayableCachedStatus(
  cached: ProviderStatusSnapshot | undefined,
  error?: unknown,
  now = new Date(),
): ProviderStatusSnapshot | undefined {
  if (!cached) return undefined;

  const primary = windowInEffect(cached.primary, now);
  const secondary = windowInEffect(cached.secondary, now);
  if (!primary && !secondary) return undefined;

  const scoped = cached.scoped?.filter(
    (window) => windowInEffect(window, now) !== undefined,
  );
  const {
    primary: _expiredPrimary,
    secondary: _expiredSecondary,
    scoped: _expiredScoped,
    ...rest
  } = cached;
  return {
    ...rest,
    source: "cache",
    state: computeProviderStatusState(primary, secondary),
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
    ...(scoped && scoped.length > 0 ? { scoped } : {}),
    ...(error === undefined
      ? {}
      : { error: providerStatusErrorMessage(error) }),
  };
}

// A window is in effect while its reset time is still in the future. Windows
// without a reset time have no intrinsic lifetime, so they are not shown once
// the refresh that would confirm them has failed.
function windowInEffect(
  window: ProviderStatusWindow | undefined,
  now: Date,
): ProviderStatusWindow | undefined {
  if (!window?.resetAt) return undefined;
  const resetAtMs = window.resetAt * 1000;
  return Number.isFinite(resetAtMs) && resetAtMs > now.getTime()
    ? window
    : undefined;
}

function unavailableProviderStatus(
  source: ProviderStatusSource,
  error: unknown,
): ProviderStatusSnapshot {
  return {
    provider: source.id,
    source: "api",
    fetchedAt: new Date().toISOString(),
    state: "unavailable",
    url: source.usageUrl,
    error: providerStatusErrorMessage(error),
  };
}

function providerStatusErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    const merged = mergeProviderStatus(freshCached, parsed, {
      // A duration-bearing weekly primary with no secondary is an explicit
      // weekly-only Codex layout, not a sparse update.
      preserveMissingWindows:
        source.preserveMissingWindows ||
        !isWeeklyOnlyCodexStatus(parsed),
    });
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

export function normalizeClaudeUsageResponse(
  value: unknown,
  now = new Date(),
): ProviderStatusSnapshot | undefined {
  const obj = objectValue(value);
  if (!obj) return undefined;

  const primary = normalizeClaudeUsageWindow(
    objectValue(obj.five_hour),
    CLAUDE_PRIMARY_WINDOW_LABEL,
    now,
  );
  const secondary = normalizeClaudeUsageWindow(
    objectValue(obj.seven_day),
    CLAUDE_SECONDARY_WINDOW_LABEL,
    now,
  );
  // The flat five_hour/seven_day fields are the legacy shape, and the sibling
  // seven_day_* keys are already null stubs. Fall back to the account-wide
  // entries in `limits` so a response that drops the flat fields still reports
  // quota instead of hiding the widget.
  const limits = normalizeClaudeLimits(obj.limits, now);
  const resolvedPrimary =
    primary ?? limits?.account.get(CLAUDE_PRIMARY_WINDOW_LABEL);
  const resolvedSecondary =
    secondary ?? limits?.account.get(CLAUDE_SECONDARY_WINDOW_LABEL);
  if (!resolvedPrimary && !resolvedSecondary) return undefined;

  return {
    provider: "anthropic",
    source: "api",
    fetchedAt: now.toISOString(),
    state: computeProviderStatusState(resolvedPrimary, resolvedSecondary),
    ...(resolvedPrimary ? { primary: resolvedPrimary } : {}),
    ...(resolvedSecondary ? { secondary: resolvedSecondary } : {}),
    // An empty array records that the provider reported no scoped caps, which
    // retires cached ones. Omitting the key means the response carried no
    // `limits` at all, so cached scoped windows survive.
    ...(limits ? { scoped: limits.scoped } : {}),
    url: CLAUDE_USAGE_URL,
  };
}

interface ClaudeLimitWindows {
  /** Account-wide windows, keyed by window label. */
  account: Map<string, ProviderStatusWindow>;
  scoped: ProviderStatusScopedWindow[];
}

// Anthropic reports per-model caps in the `limits` array rather than the flat
// `seven_day_*` keys, which stay null even when a model-scoped cap is in force:
// a weekly Fable limit arrives as kind "weekly_scoped" with
// scope.model.display_name "Fable". Entries scoped to something other than a
// model, such as a surface, are ignored because the footer cannot match them.
// Returns undefined when the response carries no `limits` array at all, which
// callers distinguish from an array that reports no scoped caps.
function normalizeClaudeLimits(
  value: unknown,
  now: Date,
): ClaudeLimitWindows | undefined {
  if (!Array.isArray(value)) return undefined;

  const account = new Map<string, ProviderStatusWindow>();
  const scoped = new Map<string, ProviderStatusScopedWindow>();
  const scopedIsActive = new Set<string>();

  for (const entry of value) {
    const limit = objectValue(entry);
    if (!limit) continue;

    const label = claudeLimitWindowLabel(stringValue(limit.group));
    if (!label) continue;

    const usedPercent = numberValue(limit.percent);
    if (usedPercent === undefined) continue;

    const window = windowFromUsedPercent(
      label,
      usedPercent,
      resetAtFromTimestamp(stringValue(limit.resets_at)),
      now,
    );

    const scope = objectValue(limit.scope);
    if (!scope) {
      if (!account.has(label)) account.set(label, window);
      continue;
    }

    const model = stringValue(objectValue(scope.model)?.display_name);
    if (!model) continue;

    // Anthropic can report more than one cap for the same model and window.
    // `is_active` marks which of them is currently in force, so it breaks ties
    // between duplicates. It is deliberately not used to filter: it is false
    // even for the account-wide windows that always apply, so treating it as a
    // gate would drop scoped caps that simply are not binding yet.
    const key = `${label}\u0000${model.toLowerCase()}`;
    const isActive = limit.is_active === true;
    if (scoped.has(key) && !(isActive && !scopedIsActive.has(key))) continue;
    scoped.set(key, { ...window, model });
    if (isActive) scopedIsActive.add(key);
  }

  return { account, scoped: Array.from(scoped.values()) };
}

function claudeLimitWindowLabel(group: string | undefined): string | undefined {
  if (group === "session") return CLAUDE_PRIMARY_WINDOW_LABEL;
  if (group === "weekly") return CLAUDE_SECONDARY_WINDOW_LABEL;
  return undefined;
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
  let auth = await resolveCodexAuth();

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

async function fetchClaudeProviderStatus(
  _pi: ExtensionAPI,
): Promise<ProviderStatusSnapshot> {
  let auth = await resolveClaudeAuth();

  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(CLAUDE_USAGE_ENDPOINT, {
      headers: {
        authorization: `Bearer ${auth.accessToken}`,
        accept: "application/json",
        "user-agent": "pi-fancy-footer",
      },
    });
    const text = await response.text();

    if (response.ok) {
      const parsed = normalizeClaudeUsageResponse(JSON.parse(text));
      if (parsed) return parsed;
      throw new Error("Claude usage response did not contain quota data");
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
      `Claude usage request failed (${response.status}): ${text.slice(0, 500)}`,
    );
  }

  throw new Error("Claude usage request failed after auth refresh");
}

async function resolveCodexAuth(): Promise<AuthCredentials> {
  const pi = await readAuthFile(
    "pi",
    homePath(".pi/agent/auth.json"),
    "openai-codex",
  );
  if (pi) return refreshIfNeeded(pi);

  const codex = await readAuthFile(
    "codex",
    homePath(".codex/auth.json"),
    "openai-codex",
  );
  if (codex) return refreshIfNeeded(codex);

  throw new Error(
    "No usable Codex OAuth credentials found. Run pi /login for OpenAI Codex or `codex login` first.",
  );
}

async function resolveClaudeAuth(): Promise<AuthCredentials> {
  const pi = await readAuthFile(
    "pi",
    homePath(".pi/agent/auth.json"),
    "anthropic",
  );
  if (pi) return refreshIfNeeded(pi);

  throw new Error(
    "No usable Anthropic OAuth credentials found. Run pi /login for Claude/Anthropic first.",
  );
}

async function refreshIfNeeded(
  auth: AuthCredentials,
): Promise<AuthCredentials> {
  if (!auth.refreshToken || !auth.expiresAtMs) return auth;
  if (auth.expiresAtMs > Date.now() + 5 * 60 * 1000) return auth;
  return refreshAuth(auth);
}

async function refreshAuth(auth: AuthCredentials): Promise<AuthCredentials> {
  if (!auth.refreshToken) return auth;

  const refreshConfig =
    auth.provider === "anthropic"
      ? {
          clientId: CLAUDE_CLIENT_ID,
          tokenUrl: CLAUDE_TOKEN_URL,
          label: "Anthropic",
        }
      : {
          clientId: CODEX_CLIENT_ID,
          tokenUrl: CODEX_TOKEN_URL,
          label: "Codex",
        };
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: auth.refreshToken,
    client_id: refreshConfig.clientId,
  }).toString();

  const result = await requestTokenRefresh(
    body,
    refreshConfig.tokenUrl,
    `${refreshConfig.label} auth refresh`,
  );

  if (!result.ok) throw result.error;
  if (!result.stdout) {
    throw new Error(`Failed to refresh ${refreshConfig.label} auth`);
  }

  const refreshed = JSON.parse(result.stdout) as Record<string, unknown>;
  const accessToken = stringValue(refreshed.access_token);
  if (!accessToken) {
    throw new Error(
      `${refreshConfig.label} auth refresh did not return access_token`,
    );
  }

  const refreshToken =
    stringValue(refreshed.refresh_token) ?? auth.refreshToken;
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

async function requestTokenRefresh(
  body: string,
  tokenUrl: string,
  label: string,
): Promise<TokenRefreshResult> {
  try {
    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        error: new Error(
          `${label} failed (${response.status}): ${text.slice(0, 500)}`,
        ),
      };
    }
    return { ok: true, stdout: text };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

async function readAuthFile(
  source: "pi" | "codex",
  path: string,
  provider: AuthCredentials["provider"],
): Promise<AuthCredentials | undefined> {
  try {
    const raw = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    return source === "pi"
      ? parsePiAuth(raw as Record<string, unknown>, path, provider)
      : parseCodexAuth(raw as Record<string, unknown>, path);
  } catch {
    return undefined;
  }
}

function parsePiAuth(
  raw: Record<string, unknown>,
  path: string,
  provider: AuthCredentials["provider"],
): AuthCredentials | undefined {
  const entry = objectValue(raw[provider]);
  const accessToken = stringValue(entry?.access);
  if (!accessToken) return undefined;
  return {
    provider,
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
    provider: "openai-codex",
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
    const entry = objectValue(raw[auth.provider]);
    if (entry) {
      entry.access = auth.accessToken;
      if (auth.refreshToken) entry.refresh = auth.refreshToken;
      if (auth.expiresAtMs) entry.expires = auth.expiresAtMs;
      if (auth.accountId) entry.accountId = auth.accountId;
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
  options: { preserveMissingWindows?: boolean } = {},
): ProviderStatusSnapshot {
  if (!existing) return update;

  const preserveMissingWindows = options.preserveMissingWindows ?? true;
  const windows = new Map<string, ProviderStatusWindow>();
  if (preserveMissingWindows) {
    for (const window of providerStatusWindows(existing)) {
      windows.set(window.label, window);
    }
  }
  for (const window of providerStatusWindows(update)) {
    windows.set(window.label, window);
  }

  const [primary, secondary] = Array.from(windows.values()).sort(
    (a, b) => windowDurationMinutes(a.label) - windowDurationMinutes(b.label),
  );
  const {
    primary: _existingPrimary,
    secondary: _existingSecondary,
    scoped: _existingScoped,
    credits: existingCredits,
    error: _existingError,
    ...existingBase
  } = existing;
  const {
    primary: _updatePrimary,
    secondary: _updateSecondary,
    scoped: _updateScoped,
    credits: updateCredits,
    ...updateBase
  } = update;
  const credits = updateCredits ?? existingCredits;
  // Unlike the quota windows, scoped caps are never merged: a response that
  // reports its scoped limits reports all of them, so keeping cached entries
  // that the provider dropped would leave a retired cap on screen until its old
  // reset time. Cached scoped caps survive only when the update carries none,
  // i.e. when the response had no `limits` array to speak for them.
  const scoped = update.scoped ?? existing.scoped;

  return {
    ...existingBase,
    ...updateBase,
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
    ...(scoped && scoped.length > 0 ? { scoped } : {}),
    ...(credits !== undefined ? { credits } : {}),
    state: computeProviderStatusState(primary, secondary),
  };
}

function providerStatusWindows(
  snapshot: ProviderStatusSnapshot,
): ProviderStatusWindow[] {
  return [snapshot.primary, snapshot.secondary].filter(
    (window): window is ProviderStatusWindow => window !== undefined,
  );
}

function windowDurationMinutes(label: string): number {
  const match = label.match(/^(\d+(?:\.\d+)?)(m|h|d)$/);
  if (!match) return Number.POSITIVE_INFINITY;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  if (match[2] === "d") return value * 24 * 60;
  if (match[2] === "h") return value * 60;
  return value;
}

function isWeeklyOnlyCodexStatus(
  snapshot: ProviderStatusSnapshot,
): boolean {
  return (
    snapshot.provider === CODEX_SOURCE.id &&
    snapshot.primary?.label === CODEX_SECONDARY_WINDOW_LABEL &&
    snapshot.secondary === undefined
  );
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
  const windowMinutes = numberString(
    headerValue(headers, `${prefix}-window-minutes`),
  );
  if (usedPercent === undefined && resetAt === undefined) return undefined;
  const durationLabel =
    windowMinutes === undefined
      ? undefined
      : windowLabelFromSeconds(windowMinutes * 60);
  return windowFromUsedPercent(
    durationLabel ?? label,
    usedPercent ?? 0,
    resetAt,
    now,
  );
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

function normalizeClaudeUsageWindow(
  value: Record<string, unknown> | undefined,
  fallbackLabel: string,
  now: Date,
): ProviderStatusWindow | undefined {
  if (!value) return undefined;
  const usedPercent =
    numberValue(value.utilization) ??
    numberString(stringValue(value.utilization));
  if (usedPercent === undefined) return undefined;

  return windowFromUsedPercent(
    fallbackLabel,
    usedPercent,
    resetAtFromTimestamp(stringValue(value.resets_at)),
    now,
  );
}

function windowLabelFromSeconds(
  seconds: number | undefined,
): string | undefined {
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

export function formatResetCountdown(
  resetAt: number,
  nowMs = Date.now(),
): string {
  if (!Number.isFinite(resetAt) || !Number.isFinite(nowMs) || resetAt <= 0) {
    return "";
  }

  const remainingMs = resetAt * 1000 - nowMs;
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return "";

  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;
  if (remainingMs >= dayMs) {
    const days = Math.floor(remainingMs / dayMs);
    const hours = Math.floor((remainingMs % dayMs) / hourMs);
    return `~${days}d${hours > 0 ? `${hours}h` : ""}`;
  }
  if (remainingMs >= hourMs) {
    const hours = Math.floor(remainingMs / hourMs);
    const minutes = Math.floor((remainingMs % hourMs) / minuteMs);
    return `~${hours}h${minutes > 0 ? `${minutes}m` : ""}`;
  }
  if (remainingMs >= minuteMs) {
    return `~${Math.floor(remainingMs / minuteMs)}m`;
  }
  return "~now";
}

function normalizeResetAt(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return value > 10_000_000_000 ? Math.round(value / 1000) : value;
}

function resetAtFromTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? Math.round(parsed / 1000) : undefined;
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
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function numberString(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
