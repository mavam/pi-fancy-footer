import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";

export type ThinkingLevel = ModelThinkingLevel;

export const FOOTER_ICON_FAMILIES = [
  "nerd",
  "emoji",
  "unicode",
  "ascii",
] as const;

export type FooterIconFamily = (typeof FOOTER_ICON_FAMILIES)[number];

export const STATUSLINE_SYMBOLS = {
  nerd: {
    thinking: "󰧑",
    model: "󰚩",
    path: "",
    branch: "",
    commit: "",
    pullRequest: "",
    pullRequestReviewThreads: "󰅺",
    pullRequestCiRunning: "",
    pullRequestCiFailed: "",
    pullRequestCiOkay: "",
    providerStatus: "󰓅",
    contextBarMarker: "󰾆",
    contextCapacityMarker: "",
    gitAhead: "",
    gitBehind: "",
    gitDiverged: "",
    diffAdded: "↗",
    diffRemoved: "↘",
    currency: "󰇁",
    cacheRead: "󰇚",
    cacheWrite: "󰕒",
    cacheHitRate: "󰀚",
  },
  emoji: {
    thinking: "🧠",
    model: "🤖",
    path: "📁",
    branch: "🌿",
    commit: "🔖",
    pullRequest: "🔀",
    pullRequestReviewThreads: "💬",
    pullRequestCiRunning: "⏳",
    pullRequestCiFailed: "❌",
    pullRequestCiOkay: "✅",
    providerStatus: "📊",
    contextBarMarker: "🔋",
    contextCapacityMarker: "💾",
    gitAhead: "🔼",
    gitBehind: "🔽",
    gitDiverged: "🔀",
    diffAdded: "➕",
    diffRemoved: "➖",
    currency: "💲",
    cacheRead: "📥",
    cacheWrite: "📤",
    cacheHitRate: "🎯",
  },
  unicode: {
    thinking: "✦",
    model: "◉",
    path: "⌂",
    branch: "⎇",
    commit: "#",
    pullRequest: "⇄",
    pullRequestReviewThreads: "✎",
    pullRequestCiRunning: "◷",
    pullRequestCiFailed: "✕",
    pullRequestCiOkay: "✓",
    providerStatus: "%",
    contextBarMarker: "◧",
    contextCapacityMarker: "□",
    gitAhead: "↑",
    gitBehind: "↓",
    gitDiverged: "↕",
    diffAdded: "+",
    diffRemoved: "−",
    currency: "$",
    cacheRead: "↧",
    cacheWrite: "↥",
    cacheHitRate: "◎",
  },
  ascii: {
    thinking: "?",
    model: "%",
    path: "/",
    branch: "*",
    commit: "#",
    pullRequest: "@",
    pullRequestReviewThreads: "!",
    pullRequestCiRunning: "~",
    pullRequestCiFailed: "x",
    pullRequestCiOkay: "+",
    providerStatus: "%",
    contextBarMarker: "|",
    contextCapacityMarker: "[]",
    gitAhead: "^",
    gitBehind: "_",
    gitDiverged: "<>",
    diffAdded: "+",
    diffRemoved: "-",
    currency: "$",
    cacheRead: "R",
    cacheWrite: "W",
    cacheHitRate: "H",
  },
} as const;

export type StatuslineSymbols = (typeof STATUSLINE_SYMBOLS)[FooterIconFamily];

// ── Gauge styles ───────────────────────────────────────────────────────

export interface GaugeStyleDef {
  readonly label: string;
  readonly filled: string;
  readonly empty: string;
}

export const GAUGE_STYLES = [
  { label: "blocks", filled: "■", empty: "□" },
  { label: "lines", filled: "━", empty: "─" },
  { label: "circles", filled: "●", empty: "○" },
  { label: "parallelograms", filled: "▰", empty: "▱" },
  { label: "diamonds", filled: "◆", empty: "◇" },
  { label: "bars", filled: "█", empty: "░" },
  { label: "stars", filled: "★", empty: "☆" },
  { label: "specks", filled: "•", empty: "◦" },
] as const satisfies readonly GaugeStyleDef[];

export type GaugeStyleId = (typeof GAUGE_STYLES)[number]["label"];

export const GAUGE_STYLE_IDS = GAUGE_STYLES.map(
  (s) => s.label,
) as readonly GaugeStyleId[];

export const DEFAULT_GAUGE_STYLE: GaugeStyleId = "blocks";

export function isGaugeStyleId(value: unknown): value is GaugeStyleId {
  return (
    typeof value === "string" &&
    (GAUGE_STYLE_IDS as readonly string[]).includes(value)
  );
}

export function getGaugeStyle(id: GaugeStyleId): GaugeStyleDef {
  return GAUGE_STYLES.find((s) => s.label === id) ?? GAUGE_STYLES[0];
}

export type GaugeSeverity = "success" | "warning" | "error";

export interface GaugeSegment {
  filledGlyphs: string;
  emptyGlyphs: string;
  percentText: string;
  color: GaugeSeverity;
}

export function gaugeSeverity(leftPercent: number): GaugeSeverity {
  if (leftPercent < 25) return "error";
  if (leftPercent < 60) return "warning";
  return "success";
}

export type GaugeFillMode = "remaining" | "used";

// Mini gauge over a resource with `leftPercent` remaining. In "remaining"
// mode (battery style) filled cells and the percent label show what is
// left; in "used" mode they show consumption growing from the left.
// Either way the color reflects how close the resource is to exhaustion,
// and the gauge never reads completely full or empty unless it truly is.
export function buildGauge(
  leftPercent: number,
  style: GaugeStyleDef,
  cells: number,
  mode: GaugeFillMode = "remaining",
): GaugeSegment {
  const left = Math.max(0, Math.min(100, leftPercent));
  const shown = mode === "remaining" ? left : 100 - left;
  const n = Math.max(1, Math.floor(cells));
  let filledCells = Math.round((shown / 100) * n);
  if (shown > 0 && filledCells === 0) filledCells = 1;
  if (shown < 100 && filledCells === n) filledCells = n - 1;
  return {
    filledGlyphs: style.filled.repeat(filledCells),
    emptyGlyphs: style.empty.repeat(n - filledCells),
    percentText: formatGaugePercent(shown),
    color: gaugeSeverity(left),
  };
}

export function formatGaugePercent(value: number): string {
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

// Compact token counts with SI-style units: 246, 1.2k, 246k, 1M, 1.2M, 12M.
// Unlike pi's own footer, round values drop the trailing ".0".
export function formatTokens(count: number): string {
  const compact = (value: number, unit: string): string =>
    `${value.toFixed(1).replace(/\.0$/, "")}${unit}`;
  if (count < 1000) return `${count}`;
  if (count < 10_000) return compact(count / 1000, "k");
  if (count < 999_500) return `${Math.round(count / 1000)}k`;
  if (count < 10_000_000) return compact(count / 1_000_000, "M");
  return `${Math.round(count / 1_000_000)}M`;
}

export const GIT_REFRESH_MS = 5000;
export const MIN_FOOTER_REFRESH_MS = 250;
export const MAX_FOOTER_REFRESH_MS = 60_000;
export const MAX_WIDGET_ROW = 12;
export const MAX_WIDGET_POSITION = 64;
export const MAX_WIDGET_MIN_WIDTH = 120;
export const FOOTER_CONFIG_FILE = "fancy-footer.json";

export const MIN_PROVIDER_STATUS_REFRESH_MS = 10_000;
export const MAX_PROVIDER_STATUS_REFRESH_MS = 3_600_000;
export const MIN_PROVIDER_STATUS_CACHE_TTL_MS = 0;
export const MAX_PROVIDER_STATUS_CACHE_TTL_MS = 3_600_000;

export const MIN_GAUGE_WIDTH = 3;
export const MAX_GAUGE_WIDTH = 40;
export const DEFAULT_GAUGE_WIDTH = 5;

export interface GaugeColorsSnapshot {
  ok: FooterWidgetColor;
  warning: FooterWidgetColor;
  error: FooterWidgetColor;
}

export const DEFAULT_GAUGE_COLORS: GaugeColorsSnapshot = {
  ok: "accent",
  warning: "warning",
  error: "error",
};

export function gaugeColorFor(
  severity: GaugeSeverity,
  colors: GaugeColorsSnapshot,
): FooterWidgetColor {
  return severity === "success" ? colors.ok : colors[severity];
}

export interface UsageSnapshot {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface SessionUsageMetrics {
  latest: UsageSnapshot | undefined;
  totalCost: number;
  totalCacheRead: number;
  totalCacheWrite: number;
}

export interface GitCounts {
  staged: number;
  modified: number;
  untracked: number;
  ahead: number;
  behind: number;
}

export type PullRequestCiState = "running" | "failed" | "okay";

export interface ProviderStatusWindow {
  label: string;
  leftPercent: number;
  usedPercent: number;
  resetAt?: number;
}

export type ProviderStatusState = "ok" | "warning" | "error" | "unavailable";

export interface ProviderStatusSnapshot {
  provider: string;
  source: "api" | "headers" | "cache";
  fetchedAt: string;
  state: ProviderStatusState;
  primary?: ProviderStatusWindow;
  secondary?: ProviderStatusWindow;
  credits?: string;
  url?: string;
  error?: string;
}

export interface GitHubPullRequest {
  number: number;
  url: string;
  host?: string;
  headRefOid?: string;
  unresolvedReviewThreadCount?: number;
  ciStatus?: {
    state: PullRequestCiState;
    url: string;
  };
}

export interface GitHubRepositoryRef {
  host: string;
  owner: string;
  name: string;
  repository: string;
}

export interface GitInfo {
  repository: string;
  branch: string;
  commit: string;
  pullRequest: GitHubPullRequest | undefined;
  pullRequestLookupEnabled: boolean;
  pullRequestLookupAt: number;
  added: number;
  removed: number;
  counts: GitCounts;
}

export const EMPTY_GIT_INFO: GitInfo = {
  repository: "",
  branch: "",
  commit: "",
  pullRequest: undefined,
  pullRequestLookupEnabled: false,
  pullRequestLookupAt: 0,
  added: 0,
  removed: 0,
  counts: {
    staged: 0,
    modified: 0,
    untracked: 0,
    ahead: 0,
    behind: 0,
  },
};

export type FooterWidgetAlign = "left" | "middle" | "right";
export type FooterWidgetFill = "none" | "grow";

export const FOOTER_WIDGET_COLORS = [
  "text",
  "accent",
  "muted",
  "dim",
  "success",
  "error",
  "warning",
] as const;

export type FooterWidgetColor = (typeof FOOTER_WIDGET_COLORS)[number];

export const FOOTER_WIDGET_IDS = [
  "model",
  "thinking",
  "context-capacity",
  "context-bar",
  "total-cost",
  "cache-read",
  "cache-write",
  "cache-hit-rate",
  "location",
  "branch",
  "commit",
  "pull-request",
  "pull-request-review-threads",
  "pull-request-ci-status",
  "provider-status",
  "diff-added",
  "diff-removed",
  "git-status",
] as const;

export type BuiltInFooterWidgetId = (typeof FOOTER_WIDGET_IDS)[number];
export type FooterWidgetId = string;

export const FOOTER_REFRESH_OPTIONS = [
  250, 500, 1000, 2000, 3000, 5000, 10000,
] as const;
export const FOOTER_ROW_OPTIONS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
] as const;
export const FOOTER_POSITION_OPTIONS = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
] as const;
export const FOOTER_MIN_WIDTH_OPTIONS = [
  0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32,
] as const;
export const GAUGE_WIDTH_OPTIONS = [3, 4, 5, 6, 8, 10, 12, 16, 20] as const;

export type FooterWidgetState = "default" | "enabled" | "disabled";
export type FooterWidgetIconMode = "default" | "hide";

export interface FooterWidgetLocation {
  row: number;
  position: number;
}

export interface FooterWidgetIcon {
  text: string;
  color: FooterWidgetColor;
}

export interface FooterMetrics {
  model: string;
  thinking: string;
  totalTokens: number;
  usedTokensForBar: number;
  totalCost: number;
  totalCacheRead: number;
  totalCacheWrite: number;
  cacheHitRatePercent: number | undefined;
  locationText: string;
  branch: string;
  commit: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  pullRequestUnresolvedReviewThreadCount: number;
  pullRequestCiState: PullRequestCiState | "";
  pullRequestCiUrl: string;
  added: number;
  removed: number;
  gitStatusSymbol: string;
  gitStatusText: string;
}

export interface WidgetRenderContext {
  width: number;
  theme: Theme;
  ctx: ExtensionContext;
  gaugeWidth: number;
  gaugeColors: GaugeColorsSnapshot;
  metrics: FooterMetrics;
  providerStatuses: readonly ProviderStatusSnapshot[];
  providerStatusConfig: Pick<
    ProviderStatusConfigSnapshot,
    "display" | "showCredits" | "showReset"
  >;
  defaultIconColor: FooterWidgetColor;
  defaultTextColor: FooterWidgetColor;
}

export type FooterWidgetSize = number | ((ctx: WidgetRenderContext) => number);

export interface FooterWidget {
  id: FooterWidgetId;
  location: FooterWidgetLocation;
  align: FooterWidgetAlign;
  fill?: FooterWidgetFill;
  /** False for widgets that stay hidden unless a config override enables them. */
  defaultEnabled?: boolean;
  minWidth?: FooterWidgetSize;
  icon?: FooterWidgetIcon;
  preferredIconColor?: FooterWidgetColor;
  textColor?: FooterWidgetColor;
  preferredTextColor?: FooterWidgetColor;
  styled?: boolean;
  /** False when enabling the widget must preserve its conditional visibility. */
  forceVisibleWhenEnabled?: boolean;
  visible?: (ctx: WidgetRenderContext) => boolean;
  renderText: (ctx: WidgetRenderContext, availableWidth?: number) => string;
}

export interface PreparedWidget {
  widget: FooterWidget;
  fill: FooterWidgetFill;
  minWidth: number;
  fixedText: string;
  fixedWidth: number;
}

export interface PreparedWidgetGroup {
  widgets: PreparedWidget[];
  minWidth: number;
}

export interface FooterWidgetConfigOverride {
  enabled?: boolean;
  row?: number;
  position?: number;
  align?: FooterWidgetAlign;
  fill?: FooterWidgetFill;
  minWidth?: number;
  icon?: FooterWidgetIconMode;
  iconColor?: FooterWidgetColor;
  textColor?: FooterWidgetColor;
}

export interface FooterConfigSnapshot {
  refreshMs: number;
  iconFamily: FooterIconFamily;
  gaugeStyle: GaugeStyleId;
  gaugeWidth: number;
  gaugeColors: GaugeColorsSnapshot;
  defaultTextColor: FooterWidgetColor;
  defaultIconColor: FooterWidgetColor;
  providerStatus: ProviderStatusConfigSnapshot;
  widgets: Partial<Record<BuiltInFooterWidgetId, FooterWidgetConfigOverride>>;
  extensionWidgets: Record<string, FooterWidgetConfigOverride>;
}

export const PROVIDER_STATUS_PROVIDER_IDS = [
  "openai-codex",
  "anthropic",
] as const;

export type ProviderStatusProviderId =
  (typeof PROVIDER_STATUS_PROVIDER_IDS)[number];

export const PROVIDER_STATUS_DISPLAYS = ["gauge", "text"] as const;

export type ProviderStatusDisplay = (typeof PROVIDER_STATUS_DISPLAYS)[number];

export interface ProviderStatusConfigSnapshot {
  refreshMs: number;
  cacheTtlMs: number;
  providers: readonly string[];
  display: ProviderStatusDisplay;
  showCredits: boolean;
  showReset: boolean;
}

export const DEFAULT_PROVIDER_STATUS_CONFIG: ProviderStatusConfigSnapshot = {
  refreshMs: 60_000,
  cacheTtlMs: 60_000,
  providers: ["openai-codex", "anthropic"],
  display: "gauge",
  showCredits: false,
  showReset: false,
};

export const DEFAULT_FOOTER_CONFIG: FooterConfigSnapshot = {
  refreshMs: GIT_REFRESH_MS,
  iconFamily: "nerd",
  gaugeStyle: DEFAULT_GAUGE_STYLE,
  gaugeWidth: DEFAULT_GAUGE_WIDTH,
  gaugeColors: DEFAULT_GAUGE_COLORS,
  defaultTextColor: "dim",
  defaultIconColor: "text",
  providerStatus: DEFAULT_PROVIDER_STATUS_CONFIG,
  widgets: {},
  extensionWidgets: {},
};

export interface FooterWidgetEditorDefaults {
  row: number;
  position: number;
  align: FooterWidgetAlign;
  fill: FooterWidgetFill;
  minWidth?: number;
  /** Set to false for widgets that start on the bench until enabled. */
  enabled?: boolean;
}

export interface FooterWidgetMeta {
  defaults: FooterWidgetEditorDefaults;
  /** Compact label for the config editor when the full id doesn't fit. */
  shortLabel: string;
  description: string;
  symbolKey: keyof StatuslineSymbols;
  hasFooterIcon?: boolean;
}

export const FOOTER_WIDGET_META: Record<
  BuiltInFooterWidgetId,
  FooterWidgetMeta
> = {
  model: {
    shortLabel: "model",
    defaults: { row: 1, position: 6, align: "right", fill: "none" },
    description: "Shows the active model.",
    symbolKey: "model",
  },
  thinking: {
    shortLabel: "think",
    defaults: { row: 1, position: 7, align: "right", fill: "none" },
    description: "Shows the current thinking level.",
    symbolKey: "thinking",
  },
  "context-capacity": {
    shortLabel: "capacity",
    defaults: {
      row: 0,
      position: 1,
      align: "left",
      fill: "none",
      enabled: false,
    },
    description: "Shows the total context window size.",
    symbolKey: "contextCapacityMarker",
  },
  "context-bar": {
    shortLabel: "ctx-bar",
    defaults: { row: 0, position: 0, align: "left", fill: "none" },
    description:
      "Shows a mini gauge of remaining context. Set fill to grow for a full-width bar.",
    symbolKey: "contextBarMarker",
  },
  "total-cost": {
    shortLabel: "cost",
    defaults: { row: 0, position: 3, align: "right", fill: "none" },
    description: "Shows the total session cost.",
    symbolKey: "currency",
  },
  "cache-read": {
    shortLabel: "cache-r",
    defaults: { row: 0, position: 0, align: "right", fill: "none" },
    description: "Shows cumulative cache-read tokens for the session.",
    symbolKey: "cacheRead",
  },
  "cache-write": {
    shortLabel: "cache-w",
    defaults: { row: 0, position: 1, align: "right", fill: "none" },
    description: "Shows cumulative cache-write tokens for the session.",
    symbolKey: "cacheWrite",
  },
  "cache-hit-rate": {
    shortLabel: "cache-hit",
    defaults: { row: 0, position: 2, align: "right", fill: "none" },
    description: "Shows the latest turn's prompt-cache hit rate.",
    symbolKey: "cacheHitRate",
  },
  location: {
    shortLabel: "loc",
    defaults: { row: 1, position: 0, align: "left", fill: "none" },
    description: "Shows the repository name or current path.",
    symbolKey: "path",
  },
  branch: {
    shortLabel: "branch",
    defaults: { row: 1, position: 1, align: "left", fill: "none" },
    description: "Shows the current Git branch.",
    symbolKey: "branch",
  },
  commit: {
    shortLabel: "commit",
    defaults: {
      row: 1,
      position: 2,
      align: "left",
      fill: "none",
      enabled: false,
    },
    description: "Shows the short Git commit SHA.",
    symbolKey: "commit",
  },
  "pull-request": {
    shortLabel: "pr",
    defaults: { row: 1, position: 3, align: "left", fill: "none" },
    description:
      "Shows the open GitHub pull request number for the current branch.",
    symbolKey: "pullRequest",
  },
  "pull-request-review-threads": {
    shortLabel: "pr-threads",
    defaults: { row: 1, position: 4, align: "left", fill: "none" },
    description:
      "Shows unresolved GitHub pull request review threads for the current branch.",
    symbolKey: "pullRequestReviewThreads",
  },
  "pull-request-ci-status": {
    shortLabel: "pr-ci",
    defaults: { row: 1, position: 5, align: "left", fill: "none" },
    description:
      "Shows the GitHub Actions CI status for the current pull request.",
    symbolKey: "pullRequestCiOkay",
    hasFooterIcon: false,
  },
  "provider-status": {
    shortLabel: "quota",
    defaults: { row: 0, position: 1, align: "left", fill: "none" },
    description: "Shows quota status for configured providers.",
    symbolKey: "providerStatus",
  },
  "diff-added": {
    shortLabel: "added",
    defaults: { row: 1, position: 6, align: "left", fill: "none" },
    description: "Shows added lines in your working tree.",
    symbolKey: "diffAdded",
  },
  "diff-removed": {
    shortLabel: "removed",
    defaults: { row: 1, position: 7, align: "left", fill: "none" },
    description: "Shows removed lines in your working tree.",
    symbolKey: "diffRemoved",
  },
  "git-status": {
    shortLabel: "git",
    defaults: { row: 1, position: 8, align: "left", fill: "none" },
    description: "Shows whether your branch is ahead, behind, or diverged.",
    symbolKey: "gitDiverged",
    hasFooterIcon: false,
  },
};

export function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

export function isFooterWidgetColor(
  value: unknown,
): value is FooterWidgetColor {
  return (
    typeof value === "string" &&
    (FOOTER_WIDGET_COLORS as readonly string[]).includes(value)
  );
}

export function isFooterIconFamily(value: unknown): value is FooterIconFamily {
  return (
    typeof value === "string" &&
    (FOOTER_ICON_FAMILIES as readonly string[]).includes(value)
  );
}

export function getStatuslineSymbols(
  iconFamily: FooterIconFamily,
): StatuslineSymbols {
  return STATUSLINE_SYMBOLS[iconFamily];
}

export function isFooterWidgetAlign(
  value: unknown,
): value is FooterWidgetAlign {
  return value === "left" || value === "middle" || value === "right";
}

export function isFooterWidgetFill(value: unknown): value is FooterWidgetFill {
  return value === "none" || value === "grow";
}

export function isFooterWidgetId(
  value: string,
): value is BuiltInFooterWidgetId {
  return (FOOTER_WIDGET_IDS as readonly string[]).includes(value);
}

export function toBoundedNonNegativeInt(
  value: unknown,
  max: number,
): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return clampInt(n, 0, max);
}

export function normalizePath(path: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (!home) return path;
  if (path === home) return "~";
  if (path.startsWith(`${home}/`) || path.startsWith(`${home}\\`)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

export function normalizeModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return "Claude";
  return trimmed.replace(/^Claude\s+/i, "") || "Claude";
}

export function getThinkingLevelFromEntries(
  entries: ReadonlyArray<{
    type: string;
    thinkingLevel?: string;
  }>,
  fallbackLevel: ThinkingLevel,
): string {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "thinking_level_change") continue;
    return entry.thinkingLevel ?? fallbackLevel;
  }

  return fallbackLevel;
}

export function formatThinkingLevel(level: string): string {
  if (level === "off") return "";
  return level;
}

function parseGitHubHost(host: string): string {
  const normalized = host.toLowerCase();
  if (normalized === "github.com") return normalized;
  if (/^github(?:[.-][a-z0-9][a-z0-9-]*)+\.[a-z]{2,}$/i.test(normalized)) {
    return normalized;
  }
  return "";
}

export function parseGitHubRemote(url: string): GitHubRepositoryRef | undefined {
  const trimmed = url.trim();
  const scpLike = trimmed.includes("://")
    ? undefined
    : trimmed.match(/^.+@([^:/]+):([^/][^:]*\/[^:]+)$/);
  const urlLike = trimmed.match(
    /^(?:https?:\/\/|ssh:\/\/.+@)([^/:]+)(?::\d+)?\/(.+\/.+)$/,
  );
  const match = scpLike ?? urlLike;
  if (!match) return undefined;

  const [, rawHost, rawRepository] = match;
  const host = parseGitHubHost(rawHost ?? "");
  if (!host || !rawRepository) return undefined;

  const repository = rawRepository.replace(/\.git$/i, "");
  const slash = repository.indexOf("/");
  if (slash <= 0 || slash >= repository.length - 1) return undefined;

  return {
    host,
    owner: repository.slice(0, slash),
    name: repository.slice(slash + 1),
    repository,
  };
}

export function formatTerminalHyperlink(url: string, text: string): string {
  if (!url) return text;
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

export function closeOpenTerminalHyperlinks(text: string, suffix = ""): string {
  let open = 0;

  for (let i = 0; i < text.length; i++) {
    if (!text.startsWith("\x1b]8;;", i)) continue;

    const valueStart = i + "\x1b]8;;".length;
    let end = valueStart;
    let terminatorLength = 0;

    while (end < text.length) {
      if (text[end] === "\x07") {
        terminatorLength = 1;
        break;
      }
      if (text[end] === "\x1b" && text[end + 1] === "\\") {
        terminatorLength = 2;
        break;
      }
      end += 1;
    }

    if (terminatorLength === 0) break;

    const value = text.slice(valueStart, end);
    open += value ? 1 : -1;
    open = Math.max(0, open);
    i = end + terminatorLength - 1;
  }

  if (open === 0) return text;

  const closeSequence = "\x1b]8;;\x07".repeat(open);
  if (!suffix) return `${text}${closeSequence}`;

  const suffixStart = text.lastIndexOf(suffix);
  if (suffixStart < 0) return `${text}${closeSequence}`;
  return `${text.slice(0, suffixStart)}${closeSequence}${text.slice(suffixStart)}`;
}

export function parseNumstat(output: string): {
  added: number;
  removed: number;
} {
  let added = 0;
  let removed = 0;

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const a = parts[0] || "";
    const b = parts[1] || "";
    if (a === "-" || b === "-") continue;
    added += toNumber(a);
    removed += toNumber(b);
  }

  return { added, removed };
}

export function getWidgetSettingIcon(
  widgetId: BuiltInFooterWidgetId,
  iconFamily: FooterIconFamily,
): string {
  return getStatuslineSymbols(iconFamily)[
    FOOTER_WIDGET_META[widgetId].symbolKey
  ];
}

export function getDefaultWidgetIcon(
  widgetId: string,
  iconFamily: FooterIconFamily,
): FooterWidgetIcon | undefined {
  if (!isFooterWidgetId(widgetId)) return undefined;
  const meta = FOOTER_WIDGET_META[widgetId];
  if (meta.hasFooterIcon === false) return undefined;
  return { text: getWidgetSettingIcon(widgetId, iconFamily), color: "text" };
}

export function widgetSummary(
  config: FooterConfigSnapshot,
  widgetId: BuiltInFooterWidgetId,
): string {
  const meta = FOOTER_WIDGET_META[widgetId];
  const defaults = meta.defaults;
  const hasBuiltInIcon = meta.hasFooterIcon !== false;
  const hasConfigurableIconColor =
    hasBuiltInIcon || widgetId === "pull-request-ci-status";

  const override = config.widgets[widgetId];
  if (!override) return "default";

  const parts: string[] = [];

  if (override.enabled === true) parts.push("on");
  if (override.enabled === false && (defaults.enabled ?? true))
    parts.push("off");

  if (override.row !== undefined && override.row !== defaults.row)
    parts.push(`row:${override.row}`);
  if (
    override.position !== undefined &&
    override.position !== defaults.position
  )
    parts.push(`pos:${override.position}`);
  if (override.align !== undefined && override.align !== defaults.align)
    parts.push(`align:${override.align}`);

  if (hasBuiltInIcon && override.icon === "hide") parts.push("icon:hidden");
  if (
    hasConfigurableIconColor &&
    override.iconColor !== undefined &&
    override.iconColor !== config.defaultIconColor
  ) {
    parts.push(`icon:${override.iconColor}`);
  }
  if (
    override.textColor !== undefined &&
    override.textColor !== config.defaultTextColor
  ) {
    parts.push(`text:${override.textColor}`);
  }
  if (override.fill !== undefined && override.fill !== defaults.fill)
    parts.push(`fill:${override.fill}`);
  if (override.minWidth !== undefined) parts.push(`width:${override.minWidth}`);

  return parts.length > 0 ? parts.join(" ") : "default";
}
