import type { ExtensionContext, Theme } from "@mariozechner/pi-coding-agent";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export const THINKING_ICON = "󰭻";

export const STATUSLINE_SYMBOLS = {
  model: "󰧑",
  path: "",
  branch: "",
  commit: "",
  pullRequest: "",
  contextUsed: "■",
  contextFree: "□",
  contextReserved: "▣",
  contextCapacityMarker: "",
  contextUsageMarker: "",
  gitAhead: "",
  gitBehind: "",
  gitDiverged: "",
  diffAdded: "↗",
  diffRemoved: "↘",
  currency: "$",
} as const;

export const GIT_REFRESH_MS = 5000;
export const MIN_FOOTER_REFRESH_MS = 250;
export const MAX_FOOTER_REFRESH_MS = 60_000;
export const MAX_WIDGET_ROW = 12;
export const MAX_WIDGET_POSITION = 64;
export const MAX_WIDGET_MIN_WIDTH = 120;
export const MAX_CONTEXT_BAR_CELLS = 200;
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
}

export interface GitInfo {
  repository: string;
  branch: string;
  commit: string;
  pullRequest: GitHubPullRequest | undefined;
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
  "diff-added",
  "diff-removed",
  "git-status",
] as const;

export type FooterWidgetId = (typeof FOOTER_WIDGET_IDS)[number];

export const FOOTER_REFRESH_OPTIONS = [250, 500, 1000, 2000, 3000, 5000, 10000] as const;
export const FOOTER_ROW_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const FOOTER_POSITION_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
export const FOOTER_MIN_WIDTH_OPTIONS = [0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32] as const;

export type FooterWidgetState = "default" | "enabled" | "disabled";
export type FooterWidgetIconMode = "default" | "show" | "hide";

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
  showPiBanner: boolean;
  defaultTextColor: FooterWidgetColor;
  defaultIconColor: FooterWidgetColor;
  widgets: Partial<Record<FooterWidgetId, FooterWidgetConfigOverride>>;
}

export const DEFAULT_FOOTER_CONFIG: FooterConfigSnapshot = {
  refreshMs: GIT_REFRESH_MS,
  showPiBanner: true,
  defaultTextColor: "dim",
  defaultIconColor: "text",
  widgets: {},
};

export interface FooterWidgetEditorDefaults {
  row: number;
  position: number;
  align: FooterWidgetAlign;
  fill: FooterWidgetFill;
}

export interface FooterWidgetMeta {
  defaults: FooterWidgetEditorDefaults;
  description: string;
  settingIcon: string;
  hasFooterIcon?: boolean;
}

export const FOOTER_WIDGET_META: Record<FooterWidgetId, FooterWidgetMeta> = {
  model: {
    defaults: { row: 1, position: 6, align: "right", fill: "none" },
    description: "Active model name",
    settingIcon: STATUSLINE_SYMBOLS.model,
  },
  thinking: {
    defaults: { row: 1, position: 7, align: "right", fill: "none" },
    description: "Thinking level indicator",
    settingIcon: THINKING_ICON,
  },
  "context-capacity": {
    defaults: { row: 0, position: 2, align: "left", fill: "none" },
    description: "Context window size (k tokens)",
    settingIcon: STATUSLINE_SYMBOLS.contextCapacityMarker,
  },
  "context-bar": {
    defaults: { row: 0, position: 0, align: "middle", fill: "grow" },
    description: "Visual context usage bar",
    settingIcon: STATUSLINE_SYMBOLS.contextUsed,
    hasFooterIcon: false,
  },
  "context-usage": {
    defaults: { row: 0, position: 0, align: "right", fill: "none" },
    description: "Used context tokens (k)",
    settingIcon: STATUSLINE_SYMBOLS.contextUsageMarker,
  },
  "total-cost": {
    defaults: { row: 0, position: 1, align: "right", fill: "none" },
    description: "Accumulated session cost",
    settingIcon: STATUSLINE_SYMBOLS.currency,
  },
  location: {
    defaults: { row: 1, position: 0, align: "left", fill: "none" },
    description: "Repository name or current path",
    settingIcon: STATUSLINE_SYMBOLS.path,
  },
  branch: {
    defaults: { row: 1, position: 1, align: "left", fill: "none" },
    description: "Git branch name",
    settingIcon: STATUSLINE_SYMBOLS.branch,
  },
  commit: {
    defaults: { row: 1, position: 2, align: "left", fill: "none" },
    description: "Short git commit hash",
    settingIcon: STATUSLINE_SYMBOLS.commit,
  },
  "pull-request": {
    defaults: { row: 1, position: 3, align: "left", fill: "none" },
    description: "Open GitHub pull request number for the current branch",
    settingIcon: STATUSLINE_SYMBOLS.pullRequest,
  },
  "diff-added": {
    defaults: { row: 1, position: 4, align: "left", fill: "none" },
    description: "Added lines in working tree",
    settingIcon: STATUSLINE_SYMBOLS.diffAdded,
  },
  "diff-removed": {
    defaults: { row: 1, position: 5, align: "left", fill: "none" },
    description: "Removed lines in working tree",
    settingIcon: STATUSLINE_SYMBOLS.diffRemoved,
  },
  "git-status": {
    defaults: { row: 1, position: 6, align: "left", fill: "none" },
    description: "Ahead/behind/diverged status",
    settingIcon: STATUSLINE_SYMBOLS.gitDiverged,
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

export function isFooterWidgetColor(value: unknown): value is FooterWidgetColor {
  return typeof value === "string" && (FOOTER_WIDGET_COLORS as readonly string[]).includes(value);
}

export function isFooterWidgetAlign(value: unknown): value is FooterWidgetAlign {
  return value === "left" || value === "middle" || value === "right";
}

export function isFooterWidgetFill(value: unknown): value is FooterWidgetFill {
  return value === "none" || value === "grow";
}

export function isFooterWidgetId(value: string): value is FooterWidgetId {
  return (FOOTER_WIDGET_IDS as readonly string[]).includes(value);
}

export function toBoundedNonNegativeInt(value: unknown, max: number): number | undefined {
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

export function formatThinkingLevel(level: string): string {
  const normalized = normalizeThinkingLevel(level);
  if (normalized === "off") return "";
  return normalized;
}

export function parseGitHubRemote(url: string): string {
  const match = url.match(/github\.com[:/](.+\/.+?)(?:\.git)?$/);
  return match?.[1] ?? "";
}

export function parseNumstat(output: string): { added: number; removed: number } {
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

export function getDefaultWidgetIcon(widgetId: FooterWidgetId): FooterWidgetIcon | undefined {
  const meta = FOOTER_WIDGET_META[widgetId];
  if (meta.hasFooterIcon === false) return undefined;
  return { text: meta.settingIcon, color: "text" };
}
