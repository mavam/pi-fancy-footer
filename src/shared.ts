import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";

export type ThinkingLevel =
  | "off"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh";

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
    contextUsed: "━",
    contextFree: "─",
    contextReserved: "┄",
    contextBarMarker: "󰾆",
    contextCapacityMarker: "",
    contextUsageMarker: "",
    gitAhead: "",
    gitBehind: "",
    gitDiverged: "",
    diffAdded: "↗",
    diffRemoved: "↘",
    currency: "󰇁",
  },
  emoji: {
    thinking: "🧠",
    model: "🤖",
    path: "📁",
    branch: "🌿",
    commit: "🔖",
    pullRequest: "🔀",
    pullRequestReviewThreads: "💬",
    contextUsed: "■",
    contextFree: "□",
    contextReserved: "▣",
    contextBarMarker: "🔋",
    contextCapacityMarker: "💾",
    contextUsageMarker: "📈",
    gitAhead: "🔼",
    gitBehind: "🔽",
    gitDiverged: "🔀",
    diffAdded: "➕",
    diffRemoved: "➖",
    currency: "💲",
  },
  unicode: {
    thinking: "✦",
    model: "◉",
    path: "⌂",
    branch: "⎇",
    commit: "#",
    pullRequest: "⇄",
    pullRequestReviewThreads: "✎",
    contextUsed: "■",
    contextFree: "□",
    contextReserved: "▣",
    contextBarMarker: "◧",
    contextCapacityMarker: "□",
    contextUsageMarker: "■",
    gitAhead: "↑",
    gitBehind: "↓",
    gitDiverged: "↕",
    diffAdded: "+",
    diffRemoved: "−",
    currency: "$",
  },
  ascii: {
    thinking: "?",
    model: "%",
    path: "/",
    branch: "*",
    commit: "#",
    pullRequest: "@",
    pullRequestReviewThreads: "!",
    contextUsed: "#",
    contextFree: "-",
    contextReserved: ":",
    contextBarMarker: "|",
    contextCapacityMarker: "[]",
    contextUsageMarker: "~",
    gitAhead: "^",
    gitBehind: "_",
    gitDiverged: "<>",
    diffAdded: "+",
    diffRemoved: "-",
    currency: "$",
  },
} as const;

export type StatuslineSymbols = (typeof STATUSLINE_SYMBOLS)[FooterIconFamily];

// ── Context bar styles ─────────────────────────────────────────────────

export interface ContextBarStyleDef {
  readonly label: string;
  readonly used: string;
  readonly free: string;
  readonly reserved: string;
}

export const CONTEXT_BAR_STYLES = [
  { label: "blocks", used: "■", free: "□", reserved: "▨" },
  { label: "lines", used: "━", free: "─", reserved: "┄" },
  { label: "circles", used: "●", free: "○", reserved: "◎" },
  { label: "parallelograms", used: "▰", free: "▱", reserved: "▰" },
  { label: "diamonds", used: "◆", free: "◇", reserved: "❖" },
  { label: "bars", used: "█", free: "░", reserved: "▒" },
  { label: "stars", used: "★", free: "☆", reserved: "✭" },
  { label: "specks", used: "•", free: "◦", reserved: "•" },
] as const satisfies readonly ContextBarStyleDef[];

export type ContextBarStyleId = (typeof CONTEXT_BAR_STYLES)[number]["label"];

export const CONTEXT_BAR_STYLE_IDS = CONTEXT_BAR_STYLES.map(
  (s) => s.label,
) as readonly ContextBarStyleId[];

export const DEFAULT_CONTEXT_BAR_STYLE: ContextBarStyleId = "blocks";

export function isContextBarStyleId(
  value: unknown,
): value is ContextBarStyleId {
  return (
    typeof value === "string" &&
    (CONTEXT_BAR_STYLE_IDS as readonly string[]).includes(value)
  );
}

export function getContextBarStyle(id: ContextBarStyleId): ContextBarStyleDef {
  return (
    CONTEXT_BAR_STYLES.find((s) => s.label === id) ?? CONTEXT_BAR_STYLES[0]
  );
}

export interface ContextBarSegments {
  cells: number;
  usedCells: number;
  safeCells: number;
}

export function getContextBarSegments(
  cells: number,
  totalTokens: number,
  usedTokens: number,
  settings: CompactionSettingsSnapshot,
): ContextBarSegments {
  const n = Math.max(0, Math.floor(cells));
  if (n === 0) return { cells: 0, usedCells: 0, safeCells: 0 };

  const total = Math.max(1, Math.floor(totalTokens));
  const clampedUsedTokens = Math.max(
    0,
    Math.min(total, Math.floor(usedTokens)),
  );

  const reserveTokens = settings.enabled
    ? Math.max(0, Math.floor(settings.reserveTokens))
    : 0;
  const safeTokens = Math.max(0, Math.min(total, total - reserveTokens));

  let safeCells = Math.floor((safeTokens * n) / total);
  safeCells = Math.max(0, Math.min(n, safeCells));

  if (settings.enabled && reserveTokens > 0 && n > 1 && safeCells >= n) {
    safeCells = n - 1;
  }

  let usedCells = Math.floor((clampedUsedTokens * n) / total);
  if (clampedUsedTokens > 0 && usedCells === 0) usedCells = 1;
  usedCells = Math.max(0, Math.min(n, usedCells));

  return { cells: n, usedCells, safeCells };
}

export const GIT_REFRESH_MS = 5000;
export const MIN_FOOTER_REFRESH_MS = 250;
export const MAX_FOOTER_REFRESH_MS = 60_000;
export const MAX_WIDGET_ROW = 12;
export const MAX_WIDGET_POSITION = 64;
export const MAX_WIDGET_MIN_WIDTH = 120;
export const FOOTER_CONFIG_FILE = "fancy-footer.json";

export interface CompactionSettingsSnapshot {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

export const DEFAULT_COMPACTION_SETTINGS: CompactionSettingsSnapshot = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
};

export interface UsageSnapshot {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface SessionUsageMetrics {
  latest: UsageSnapshot | undefined;
  totalCost: number;
}

export interface GitCounts {
  staged: number;
  modified: number;
  untracked: number;
  ahead: number;
  behind: number;
}

export interface GitHubPullRequest {
  number: number;
  url: string;
  unresolvedReviewThreadCount?: number;
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
  "context-usage",
  "total-cost",
  "location",
  "branch",
  "commit",
  "pull-request",
  "pull-request-review-threads",
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
  usedK: number;
  totalK: number;
  totalCost: number;
  locationText: string;
  branch: string;
  commit: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  pullRequestUnresolvedReviewThreadCount: number;
  added: number;
  removed: number;
  gitStatusSymbol: string;
  gitStatusText: string;
}

export interface WidgetRenderContext {
  width: number;
  theme: Theme;
  ctx: ExtensionContext;
  compactionSettings: CompactionSettingsSnapshot;
  metrics: FooterMetrics;
  defaultIconColor: FooterWidgetColor;
  defaultTextColor: FooterWidgetColor;
}

export type FooterWidgetSize = number | ((ctx: WidgetRenderContext) => number);

export interface FooterWidget {
  id: FooterWidgetId;
  location: FooterWidgetLocation;
  align: FooterWidgetAlign;
  fill?: FooterWidgetFill;
  minWidth?: FooterWidgetSize;
  icon?: FooterWidgetIcon;
  textColor?: FooterWidgetColor;
  styled?: boolean;
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
  contextBarStyle: ContextBarStyleId;
  defaultTextColor: FooterWidgetColor;
  defaultIconColor: FooterWidgetColor;
  widgets: Partial<Record<BuiltInFooterWidgetId, FooterWidgetConfigOverride>>;
  extensionWidgets: Record<string, FooterWidgetConfigOverride>;
}

export const DEFAULT_FOOTER_CONFIG: FooterConfigSnapshot = {
  refreshMs: GIT_REFRESH_MS,
  iconFamily: "nerd",
  contextBarStyle: DEFAULT_CONTEXT_BAR_STYLE,
  defaultTextColor: "dim",
  defaultIconColor: "text",
  widgets: {},
  extensionWidgets: {},
};

export interface FooterWidgetEditorDefaults {
  row: number;
  position: number;
  align: FooterWidgetAlign;
  fill: FooterWidgetFill;
  minWidth?: number;
}

export type FancyFooterWidgetIcon =
  | string
  | Partial<Record<FooterIconFamily, string>>
  | ((iconFamily: FooterIconFamily) => string | undefined);

export interface FancyFooterWidgetContribution {
  id: string;
  label?: string;
  description: string;
  defaults: FooterWidgetEditorDefaults;
  icon?: FancyFooterWidgetIcon | false;
  textColor?: FooterWidgetColor;
  styled?: boolean;
  visible?: (ctx: WidgetRenderContext) => boolean;
  renderText: (ctx: WidgetRenderContext, availableWidth?: number) => string;
}

export interface FooterWidgetMeta {
  defaults: FooterWidgetEditorDefaults;
  description: string;
  symbolKey: keyof StatuslineSymbols;
  hasFooterIcon?: boolean;
}

export const FOOTER_WIDGET_META: Record<
  BuiltInFooterWidgetId,
  FooterWidgetMeta
> = {
  model: {
    defaults: { row: 1, position: 6, align: "right", fill: "none" },
    description: "Shows the active model.",
    symbolKey: "model",
  },
  thinking: {
    defaults: { row: 1, position: 7, align: "right", fill: "none" },
    description: "Shows the current thinking level.",
    symbolKey: "thinking",
  },
  "context-capacity": {
    defaults: { row: 0, position: 2, align: "left", fill: "none" },
    description: "Shows the total context window in thousands of tokens.",
    symbolKey: "contextCapacityMarker",
  },
  "context-bar": {
    defaults: { row: 0, position: 0, align: "middle", fill: "grow" },
    description: "Shows a bar for current context usage.",
    symbolKey: "contextBarMarker",
  },
  "context-usage": {
    defaults: { row: 0, position: 0, align: "right", fill: "none" },
    description: "Shows used context in thousands of tokens.",
    symbolKey: "contextUsageMarker",
  },
  "total-cost": {
    defaults: { row: 0, position: 1, align: "right", fill: "none" },
    description: "Shows the total session cost.",
    symbolKey: "currency",
  },
  location: {
    defaults: { row: 1, position: 0, align: "left", fill: "none" },
    description: "Shows the repository name or current path.",
    symbolKey: "path",
  },
  branch: {
    defaults: { row: 1, position: 1, align: "left", fill: "none" },
    description: "Shows the current Git branch.",
    symbolKey: "branch",
  },
  commit: {
    defaults: { row: 1, position: 2, align: "left", fill: "none" },
    description: "Shows the short Git commit hash.",
    symbolKey: "commit",
  },
  "pull-request": {
    defaults: { row: 1, position: 3, align: "left", fill: "none" },
    description:
      "Shows the open GitHub pull request number for the current branch.",
    symbolKey: "pullRequest",
  },
  "pull-request-review-threads": {
    defaults: { row: 1, position: 4, align: "left", fill: "none" },
    description:
      "Shows unresolved GitHub pull request review threads for the current branch.",
    symbolKey: "pullRequestReviewThreads",
  },
  "diff-added": {
    defaults: { row: 1, position: 5, align: "left", fill: "none" },
    description: "Shows added lines in your working tree.",
    symbolKey: "diffAdded",
  },
  "diff-removed": {
    defaults: { row: 1, position: 6, align: "left", fill: "none" },
    description: "Shows removed lines in your working tree.",
    symbolKey: "diffRemoved",
  },
  "git-status": {
    defaults: { row: 1, position: 7, align: "left", fill: "none" },
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

export function normalizeThinkingLevel(level: string): ThinkingLevel {
  switch (level) {
    case "off":
    case "minimal":
    case "low":
    case "medium":
    case "high":
    case "xhigh":
      return level;
    default:
      return "off";
  }
}

export function getThinkingLevelFromEntries(
  entries: ReadonlyArray<{
    type: string;
    thinkingLevel?: string;
  }>,
  fallbackLevel: string,
): ThinkingLevel {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type !== "thinking_level_change") continue;
    return normalizeThinkingLevel(entry.thinkingLevel ?? fallbackLevel);
  }

  return normalizeThinkingLevel(fallbackLevel);
}

export function formatThinkingLevel(level: string): string {
  const normalized = normalizeThinkingLevel(level);
  if (normalized === "off") return "";
  return normalized;
}

export function parseGitHubRemote(url: string): string {
  const match = url.match(/github\.com[:/](.+\/.+?)(?:\.git)?$/);
  return match?.[1] ?? "";
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
  widgetId: BuiltInFooterWidgetId,
  iconFamily: FooterIconFamily,
): FooterWidgetIcon | undefined {
  const meta = FOOTER_WIDGET_META[widgetId];
  if (meta.hasFooterIcon === false) return undefined;
  return { text: getWidgetSettingIcon(widgetId, iconFamily), color: "text" };
}

export function resolveFancyFooterWidgetIcon(
  icon: FancyFooterWidgetContribution["icon"],
  iconFamily: FooterIconFamily,
): FooterWidgetIcon | undefined {
  if (icon === false) return undefined;

  let text = "";
  if (typeof icon === "function") {
    text = icon(iconFamily) ?? "";
  } else if (typeof icon === "string") {
    text = icon;
  } else if (icon && typeof icon === "object") {
    text = icon[iconFamily] ?? "";
  }

  if (!text) return undefined;
  return { text, color: "text" };
}

export function widgetSummary(
  config: FooterConfigSnapshot,
  widgetId: BuiltInFooterWidgetId,
): string {
  const meta = FOOTER_WIDGET_META[widgetId];
  const defaults = meta.defaults;
  const hasBuiltInIcon = meta.hasFooterIcon !== false;

  const override = config.widgets[widgetId];
  if (!override) return "default";

  const parts: string[] = [];

  if (override.enabled === true) parts.push("on");
  if (override.enabled === false) parts.push("off");

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
    hasBuiltInIcon &&
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
