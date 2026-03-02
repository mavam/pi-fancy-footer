import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage } from "@mariozechner/pi-ai";
import { getSettingsListTheme, type ExtensionAPI, type ExtensionContext, type SessionEntry, type Theme } from "@mariozechner/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

const THINKING_SYMBOLS: Record<ThinkingLevel, string> = {
  off: "",
  minimal: "✧",
  low: "✦",
  medium: "◆",
  high: "❖",
  xhigh: "✹",
};

const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "",
  minimal: "min",
  low: "low",
  medium: "med",
  high: "hgh",
  xhigh: "xhi",
};

const STATUSLINE_SYMBOLS = {
  model: "󰧑",
  path: "",
  branch: "",
  commit: "#",
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

const GIT_REFRESH_MS = 5000;
const MIN_FOOTER_REFRESH_MS = 250;
const FOOTER_CONFIG_FILE = "fancy-footer.json";

interface CompactionSettingsSnapshot {
  enabled: boolean;
  reserveTokens: number;
  keepRecentTokens: number;
}

const DEFAULT_COMPACTION_SETTINGS: CompactionSettingsSnapshot = {
  enabled: true,
  reserveTokens: 16_384,
  keepRecentTokens: 20_000,
};

interface UsageSnapshot {
  input: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

interface GitCounts {
  staged: number;
  modified: number;
  untracked: number;
  ahead: number;
  behind: number;
}

interface GitInfo {
  repository: string;
  branch: string;
  commit: string;
  added: number;
  removed: number;
  counts: GitCounts;
}

const EMPTY_GIT_INFO: GitInfo = {
  repository: "",
  branch: "",
  commit: "",
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

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function coerceCompactionSettings(
  value: unknown,
  fallback: CompactionSettingsSnapshot = DEFAULT_COMPACTION_SETTINGS,
): CompactionSettingsSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...fallback };
  }

  const settings = value as Record<string, unknown>;
  const reserveRaw = Number(settings.reserveTokens);
  const keepRecentRaw = Number(settings.keepRecentTokens);

  return {
    enabled: typeof settings.enabled === "boolean" ? settings.enabled : fallback.enabled,
    reserveTokens: Number.isFinite(reserveRaw) ? Math.max(0, Math.floor(reserveRaw)) : fallback.reserveTokens,
    keepRecentTokens: Number.isFinite(keepRecentRaw)
      ? Math.max(0, Math.floor(keepRecentRaw))
      : fallback.keepRecentTokens,
  };
}

function readJsonObject(filePath: string): Record<string, unknown> | undefined {
  try {
    if (!existsSync(filePath)) return undefined;
    const content = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function expandHome(pathValue: string): string {
  if (pathValue === "~") return homedir();
  if (pathValue.startsWith("~/") || pathValue.startsWith("~\\")) {
    return join(homedir(), pathValue.slice(2));
  }
  return pathValue;
}

function getAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR
    ? expandHome(process.env.PI_CODING_AGENT_DIR)
    : join(homedir(), ".pi", "agent");
}

function loadCompactionSettings(cwd: string): CompactionSettingsSnapshot {
  const globalSettings = readJsonObject(join(getAgentDir(), "settings.json"));
  const projectSettings = readJsonObject(join(cwd, ".pi", "settings.json"));

  let resolved = { ...DEFAULT_COMPACTION_SETTINGS };
  if (globalSettings?.compaction !== undefined) {
    resolved = coerceCompactionSettings(globalSettings.compaction, resolved);
  }
  if (projectSettings?.compaction !== undefined) {
    resolved = coerceCompactionSettings(projectSettings.compaction, resolved);
  }

  return resolved;
}

function normalizePath(path: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (!home) return path;
  if (path === home) return "~";
  if (path.startsWith(`${home}/`) || path.startsWith(`${home}\\`)) {
    return `~${path.slice(home.length)}`;
  }
  return path;
}

function normalizeModel(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return "Claude";
  return trimmed.replace(/^Claude\s+/i, "") || "Claude";
}

function normalizeThinkingLevel(level: string): ThinkingLevel {
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

function renderThinkingLevel(level: string, theme: Theme): string {
  const normalized = normalizeThinkingLevel(level);
  const symbol = THINKING_SYMBOLS[normalized];
  const label = THINKING_LABELS[normalized];
  if (!symbol || !label) return "";
  return `${theme.getThinkingBorderColor(normalized)(symbol)}${theme.fg("dim", label)}`;
}

function parseGitHubRemote(url: string): string {
  const match = url.match(/github\.com[:/](.+\/.+?)(?:\.git)?$/);
  return match?.[1] ?? "";
}

function parseNumstat(output: string): { added: number; removed: number } {
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

function getUsageData(entries: SessionEntry[]): {
  latest: UsageSnapshot | undefined;
  totalCost: number;
} {
  let latest: UsageSnapshot | undefined;
  let totalCost = 0;

  for (const entry of entries) {
    if (entry.type !== "message") continue;

    const message = entry.message as Partial<AssistantMessage>;
    if (message.role !== "assistant" || !message.usage) continue;

    const usage = message.usage;
    latest = {
      input: Math.max(0, toNumber(usage.input)),
      cacheRead: Math.max(0, toNumber(usage.cacheRead)),
      cacheWrite: Math.max(0, toNumber(usage.cacheWrite)),
      cost: Math.max(0, toNumber(usage.cost?.total)),
    };
    totalCost += latest.cost;
  }

  return { latest, totalCost };
}

function buildBricks(
  cells: number,
  totalTokens: number,
  usedTokens: number,
  settings: CompactionSettingsSnapshot,
  theme: Theme,
): string {
  const n = Math.max(0, Math.floor(cells));
  if (n === 0) return "";

  const total = Math.max(1, Math.floor(totalTokens));
  const clampedUsedTokens = Math.max(0, Math.min(total, Math.floor(usedTokens)));

  const reserveTokens = settings.enabled ? Math.max(0, Math.floor(settings.reserveTokens)) : 0;
  const safeTokens = Math.max(0, Math.min(total, total - reserveTokens));

  let safeCells = Math.floor((safeTokens * n) / total);
  safeCells = Math.max(0, Math.min(n, safeCells));

  // Keep at least one reserved-tail cell visible when reserveTokens > 0 and the bar has room.
  if (settings.enabled && reserveTokens > 0 && n > 1 && safeCells >= n) {
    safeCells = n - 1;
  }

  let usedCells = Math.floor((clampedUsedTokens * n) / total);
  if (clampedUsedTokens > 0 && usedCells === 0) usedCells = 1;
  usedCells = Math.max(0, Math.min(n, usedCells));

  let out = "";

  for (let i = 0; i < usedCells; i++) {
    out += theme.fg("dim", STATUSLINE_SYMBOLS.contextUsed);
  }

  for (let i = usedCells; i < safeCells; i++) {
    out += theme.fg("dim", STATUSLINE_SYMBOLS.contextFree);
  }

  for (let i = Math.max(usedCells, safeCells); i < n; i++) {
    out += theme.fg("dim", STATUSLINE_SYMBOLS.contextReserved);
  }

  return out;
}

function buildGitStatus(counts: GitCounts, theme: Theme): string {
  if (counts.ahead > 0 && counts.behind > 0) {
    return `${theme.fg("accent", STATUSLINE_SYMBOLS.gitDiverged)}${theme.fg("dim", `${counts.ahead}/${counts.behind}`)}`;
  }
  if (counts.ahead > 0) {
    return `${theme.fg("accent", STATUSLINE_SYMBOLS.gitAhead)}${theme.fg("dim", `${counts.ahead}`)}`;
  }
  if (counts.behind > 0) {
    return `${theme.fg("warning", STATUSLINE_SYMBOLS.gitBehind)}${theme.fg("dim", `${counts.behind}`)}`;
  }
  return "";
}

async function exec(
  pi: ExtensionAPI,
  command: string,
  args: string[],
  cwd: string,
): Promise<string> {
  try {
    const result = await pi.exec(command, args, { cwd, timeout: 2000 });
    if (result.code !== 0) return "";
    // Keep leading whitespace (git porcelain uses it), only drop trailing newlines.
    return result.stdout.replace(/[\r\n]+$/, "");
  } catch {
    return "";
  }
}

async function collectGitInfo(pi: ExtensionAPI, cwd: string): Promise<GitInfo> {
  const gitDir = await exec(pi, "git", ["rev-parse", "--git-dir"], cwd);
  if (!gitDir) return { ...EMPTY_GIT_INFO };

  const [branch, commit, remoteUrl, porcelain] = await Promise.all([
    exec(pi, "git", ["branch", "--show-current"], cwd),
    exec(pi, "git", ["rev-parse", "--short", "HEAD"], cwd),
    exec(pi, "git", ["config", "--get", "remote.origin.url"], cwd),
    exec(pi, "git", ["status", "--porcelain"], cwd),
  ]);

  let staged = 0;
  let modified = 0;
  let untracked = 0;

  for (const line of porcelain.split(/\r?\n/)) {
    if (!line) continue;
    const x = line[0] || " ";
    const y = line[1] || " ";

    if (x === "?") {
      untracked += 1;
      continue;
    }
    if (x !== " ") staged += 1;
    if (y !== " " && y !== "?") modified += 1;
  }

  let ahead = 0;
  let behind = 0;
  const upstream = await exec(pi, "git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd);
  if (upstream) {
    const [aheadStr, behindStr] = await Promise.all([
      exec(pi, "git", ["rev-list", "--count", `${upstream}..HEAD`], cwd),
      exec(pi, "git", ["rev-list", "--count", `HEAD..${upstream}`], cwd),
    ]);
    ahead = Math.max(0, Math.floor(toNumber(aheadStr)));
    behind = Math.max(0, Math.floor(toNumber(behindStr)));
  }

  let added = 0;
  let removed = 0;

  const headDiff = await exec(pi, "git", ["diff", "--numstat", "HEAD"], cwd);
  if (headDiff) {
    const stats = parseNumstat(headDiff);
    added = stats.added;
    removed = stats.removed;
  } else {
    const [stagedDiff, unstagedDiff] = await Promise.all([
      exec(pi, "git", ["diff", "--numstat", "--cached"], cwd),
      exec(pi, "git", ["diff", "--numstat"], cwd),
    ]);
    const s1 = parseNumstat(stagedDiff);
    const s2 = parseNumstat(unstagedDiff);
    added = s1.added + s2.added;
    removed = s1.removed + s2.removed;
  }

  return {
    repository: parseGitHubRemote(remoteUrl),
    branch,
    commit,
    added,
    removed,
    counts: {
      staged,
      modified,
      untracked,
      ahead,
      behind,
    },
  };
}

type FooterWidgetAlign = "left" | "middle" | "right";
type FooterWidgetFill = "none" | "grow";
type FooterWidgetColor = "text" | "accent" | "muted" | "dim" | "success" | "error" | "warning";
type FooterWidgetSize = number | ((ctx: WidgetRenderContext) => number);

interface FooterWidgetLocation {
  row: number;
  position: number;
}

interface FooterWidgetIcon {
  text: string;
  color: FooterWidgetColor;
}

interface FooterMetrics {
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
  added: number;
  removed: number;
  gitStatus: string;
}

interface WidgetRenderContext {
  width: number;
  theme: Theme;
  ctx: ExtensionContext;
  compactionSettings: CompactionSettingsSnapshot;
  metrics: FooterMetrics;
}

interface FooterWidget {
  id: string;
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

interface PreparedWidget {
  widget: FooterWidget;
  fill: FooterWidgetFill;
  minWidth: number;
  fixedText: string;
  fixedWidth: number;
}

interface PreparedWidgetGroup {
  widgets: PreparedWidget[];
  minWidth: number;
}

interface FooterWidgetConfigIcon {
  text?: string;
  color?: FooterWidgetColor;
}

interface FooterWidgetConfigOverride {
  enabled?: boolean;
  row?: number;
  position?: number;
  align?: FooterWidgetAlign;
  fill?: FooterWidgetFill;
  minWidth?: number;
  icon?: FooterWidgetConfigIcon | null;
  textColor?: FooterWidgetColor;
}

interface FooterConfigSnapshot {
  refreshMs: number;
  widgets: Record<string, FooterWidgetConfigOverride>;
}

const DEFAULT_FOOTER_CONFIG: FooterConfigSnapshot = {
  refreshMs: GIT_REFRESH_MS,
  widgets: {},
};

const FOOTER_WIDGET_IDS = [
  "model",
  "thinking",
  "context-capacity",
  "context-bar",
  "context-usage",
  "total-cost",
  "location",
  "branch",
  "commit",
  "diff-added",
  "diff-removed",
  "git-status",
] as const;

const FOOTER_REFRESH_OPTIONS = [250, 500, 1000, 2000, 3000, 5000, 10000] as const;
const FOOTER_ROW_OPTIONS = [0, 1, 2, 3, 4, 5] as const;
const FOOTER_POSITION_OPTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
const FOOTER_MIN_WIDTH_OPTIONS = [0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32] as const;

type FooterWidgetState = "default" | "enabled" | "disabled";
type FooterWidgetIconMode = "default" | "show" | "hide";

interface FooterWidgetEditorDefaults {
  row: number;
  position: number;
  align: FooterWidgetAlign;
  fill: FooterWidgetFill;
}

const FOOTER_WIDGET_EDITOR_DEFAULTS: Record<string, FooterWidgetEditorDefaults> = {
  model: { row: 1, position: 6, align: "right", fill: "none" },
  thinking: { row: 1, position: 7, align: "right", fill: "none" },
  "context-capacity": { row: 0, position: 2, align: "left", fill: "none" },
  "context-bar": { row: 0, position: 0, align: "middle", fill: "grow" },
  "context-usage": { row: 0, position: 0, align: "right", fill: "none" },
  "total-cost": { row: 0, position: 1, align: "right", fill: "none" },
  location: { row: 1, position: 0, align: "left", fill: "none" },
  branch: { row: 1, position: 1, align: "left", fill: "none" },
  commit: { row: 1, position: 2, align: "left", fill: "none" },
  "diff-added": { row: 1, position: 3, align: "left", fill: "none" },
  "diff-removed": { row: 1, position: 4, align: "left", fill: "none" },
  "git-status": { row: 1, position: 5, align: "left", fill: "none" },
};

const FOOTER_WIDGET_DESCRIPTIONS: Record<string, string> = {
  model: "Active model name",
  thinking: "Thinking level indicator",
  "context-capacity": "Context window size (k tokens)",
  "context-bar": "Visual context usage bar",
  "context-usage": "Used context tokens (k)",
  "total-cost": "Accumulated session cost",
  location: "Repository name or current path",
  branch: "Git branch name",
  commit: "Short git commit hash",
  "diff-added": "Added lines in working tree",
  "diff-removed": "Removed lines in working tree",
  "git-status": "Ahead/behind/diverged status",
};

const FOOTER_WIDGET_SETTING_ICONS: Record<string, string> = {
  model: "󰧑",
  thinking: THINKING_SYMBOLS.minimal,
  "context-capacity": STATUSLINE_SYMBOLS.contextCapacityMarker,
  "context-bar": STATUSLINE_SYMBOLS.contextUsed,
  "context-usage": STATUSLINE_SYMBOLS.contextUsageMarker,
  "total-cost": STATUSLINE_SYMBOLS.currency,
  location: STATUSLINE_SYMBOLS.path,
  branch: STATUSLINE_SYMBOLS.branch,
  commit: STATUSLINE_SYMBOLS.commit,
  "diff-added": STATUSLINE_SYMBOLS.diffAdded,
  "diff-removed": STATUSLINE_SYMBOLS.diffRemoved,
  "git-status": STATUSLINE_SYMBOLS.gitDiverged,
};

const FOOTER_WIDGET_ICON_DEFAULTS: Record<string, FooterWidgetIcon | undefined> = {
  model: STATUSLINE_SYMBOLS.model ? { text: STATUSLINE_SYMBOLS.model, color: "accent" } : undefined,
  thinking: undefined,
  "context-capacity": { text: STATUSLINE_SYMBOLS.contextCapacityMarker, color: "accent" },
  "context-bar": undefined,
  "context-usage": { text: STATUSLINE_SYMBOLS.contextUsageMarker, color: "accent" },
  "total-cost": { text: STATUSLINE_SYMBOLS.currency, color: "warning" },
  location: { text: STATUSLINE_SYMBOLS.path, color: "accent" },
  branch: { text: STATUSLINE_SYMBOLS.branch, color: "accent" },
  commit: { text: STATUSLINE_SYMBOLS.commit, color: "accent" },
  "diff-added": { text: STATUSLINE_SYMBOLS.diffAdded, color: "success" },
  "diff-removed": { text: STATUSLINE_SYMBOLS.diffRemoved, color: "error" },
  "git-status": undefined,
};

const FOOTER_WIDGET_COLORS: FooterWidgetColor[] = [
  "text",
  "accent",
  "muted",
  "dim",
  "success",
  "error",
  "warning",
];

function isFooterWidgetColor(value: unknown): value is FooterWidgetColor {
  return typeof value === "string" && FOOTER_WIDGET_COLORS.includes(value as FooterWidgetColor);
}

function isFooterWidgetAlign(value: unknown): value is FooterWidgetAlign {
  return value === "left" || value === "middle" || value === "right";
}

function isFooterWidgetFill(value: unknown): value is FooterWidgetFill {
  return value === "none" || value === "grow";
}

function toNonNegativeInt(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.floor(n));
}

function coerceFooterWidgetOverride(value: unknown): FooterWidgetConfigOverride | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  const out: FooterWidgetConfigOverride = {};

  if (typeof input.enabled === "boolean") out.enabled = input.enabled;

  const row = toNonNegativeInt(input.row);
  if (row !== undefined) out.row = row;

  const position = toNonNegativeInt(input.position);
  if (position !== undefined) out.position = position;

  if (isFooterWidgetAlign(input.align)) out.align = input.align;
  if (isFooterWidgetFill(input.fill)) out.fill = input.fill;

  const minWidth = toNonNegativeInt(input.minWidth);
  if (minWidth !== undefined) out.minWidth = minWidth;

  if (input.icon === null) {
    out.icon = null;
  } else if (input.icon && typeof input.icon === "object" && !Array.isArray(input.icon)) {
    const rawIcon = input.icon as Record<string, unknown>;
    const icon: FooterWidgetConfigIcon = {};
    if (typeof rawIcon.text === "string") icon.text = rawIcon.text;
    if (isFooterWidgetColor(rawIcon.color)) icon.color = rawIcon.color;
    out.icon = icon;
  }

  if (isFooterWidgetColor(input.textColor)) out.textColor = input.textColor;

  return out;
}

function coerceFooterConfig(value: unknown): FooterConfigSnapshot {
  const out: FooterConfigSnapshot = {
    refreshMs: DEFAULT_FOOTER_CONFIG.refreshMs,
    widgets: {},
  };

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return out;
  }

  const input = value as Record<string, unknown>;

  const refreshMs = toNonNegativeInt(input.refreshMs);
  if (refreshMs !== undefined) {
    out.refreshMs = Math.max(MIN_FOOTER_REFRESH_MS, refreshMs);
  }

  const widgetsRaw = input.widgets;
  if (widgetsRaw && typeof widgetsRaw === "object" && !Array.isArray(widgetsRaw)) {
    for (const [id, widgetValue] of Object.entries(widgetsRaw as Record<string, unknown>)) {
      const coerced = coerceFooterWidgetOverride(widgetValue);
      if (coerced) out.widgets[id] = coerced;
    }
  }

  return out;
}

function getFooterConfigPath(): string {
  return join(getAgentDir(), FOOTER_CONFIG_FILE);
}

function loadFooterConfig(): FooterConfigSnapshot {
  const config = readJsonObject(getFooterConfigPath());
  return coerceFooterConfig(config);
}

function writeFooterConfigFile(content: string): void {
  mkdirSync(getAgentDir(), { recursive: true });
  writeFileSync(getFooterConfigPath(), content, "utf8");
}

function cloneFooterWidgetOverride(override: FooterWidgetConfigOverride): FooterWidgetConfigOverride {
  return {
    ...override,
    icon: override.icon === null ? null : override.icon ? { ...override.icon } : undefined,
  };
}

function cloneFooterConfig(config: FooterConfigSnapshot): FooterConfigSnapshot {
  const widgets: Record<string, FooterWidgetConfigOverride> = {};
  for (const [id, override] of Object.entries(config.widgets)) {
    widgets[id] = cloneFooterWidgetOverride(override);
  }
  return {
    refreshMs: config.refreshMs,
    widgets,
  };
}

function isEmptyWidgetOverride(override: FooterWidgetConfigOverride | undefined): boolean {
  if (!override) return true;
  for (const value of Object.values(override)) {
    if (value !== undefined) return false;
  }
  return true;
}

function toFooterConfigObject(config: FooterConfigSnapshot): Record<string, unknown> {
  const outWidgets: Record<string, FooterWidgetConfigOverride> = {};
  for (const [id, override] of Object.entries(config.widgets)) {
    if (!isEmptyWidgetOverride(override)) {
      outWidgets[id] = cloneFooterWidgetOverride(override);
    }
  }

  const out: Record<string, unknown> = {
    refreshMs: Math.max(MIN_FOOTER_REFRESH_MS, Math.floor(config.refreshMs)),
  };

  if (Object.keys(outWidgets).length > 0) {
    out.widgets = outWidgets;
  }

  return out;
}

function writeFooterConfigSnapshot(config: FooterConfigSnapshot): void {
  writeFooterConfigFile(`${JSON.stringify(toFooterConfigObject(config), null, 2)}\n`);
}

function getWidgetState(config: FooterConfigSnapshot, widgetId: string): FooterWidgetState {
  const enabled = config.widgets[widgetId]?.enabled;
  if (enabled === true) return "enabled";
  if (enabled === false) return "disabled";
  return "default";
}

function updateWidgetOverride(
  config: FooterConfigSnapshot,
  widgetId: string,
  updater: (override: FooterWidgetConfigOverride) => void,
): void {
  const override = cloneFooterWidgetOverride(config.widgets[widgetId] ?? {});
  updater(override);

  if (isEmptyWidgetOverride(override)) {
    delete config.widgets[widgetId];
  } else {
    config.widgets[widgetId] = override;
  }
}

function setWidgetState(config: FooterConfigSnapshot, widgetId: string, state: FooterWidgetState): void {
  updateWidgetOverride(config, widgetId, (override) => {
    if (state === "default") {
      delete override.enabled;
    } else {
      override.enabled = state === "enabled";
    }
  });
}

function setWidgetNumberOverride(
  config: FooterConfigSnapshot,
  widgetId: string,
  key: "row" | "position" | "minWidth",
  value: string,
): void {
  updateWidgetOverride(config, widgetId, (override) => {
    if (value === "default") {
      delete override[key];
      return;
    }

    const n = toNonNegativeInt(value);
    if (n === undefined) return;
    override[key] = n;
  });
}

function setWidgetAlignOverride(config: FooterConfigSnapshot, widgetId: string, value: string): void {
  updateWidgetOverride(config, widgetId, (override) => {
    if (value === "default") {
      delete override.align;
      return;
    }
    if (isFooterWidgetAlign(value)) {
      override.align = value;
    }
  });
}

function setWidgetFillOverride(config: FooterConfigSnapshot, widgetId: string, value: string): void {
  updateWidgetOverride(config, widgetId, (override) => {
    if (value === "default") {
      delete override.fill;
      return;
    }
    if (isFooterWidgetFill(value)) {
      override.fill = value;
    }
  });
}

function getWidgetIconMode(config: FooterConfigSnapshot, widgetId: string): FooterWidgetIconMode {
  const iconOverride = config.widgets[widgetId]?.icon;
  if (iconOverride === null) return "hide";
  if (iconOverride !== undefined) return "show";
  return "default";
}

function setWidgetIconMode(config: FooterConfigSnapshot, widgetId: string, value: string): void {
  if (value !== "default" && value !== "show" && value !== "hide") return;

  updateWidgetOverride(config, widgetId, (override) => {
    if (value === "default") {
      delete override.icon;
      return;
    }

    if (value === "hide") {
      override.icon = null;
      return;
    }

    const baseIcon = getDefaultWidgetIcon(widgetId);
    const current = override.icon && override.icon !== null ? { ...override.icon } : {};
    if (!current.text && baseIcon?.text) current.text = baseIcon.text;
    if (!current.color && baseIcon?.color) current.color = baseIcon.color;
    override.icon = current;
  });
}

function getWidgetIconColorValue(config: FooterConfigSnapshot, widgetId: string): string {
  const color = config.widgets[widgetId]?.icon && config.widgets[widgetId]?.icon !== null
    ? config.widgets[widgetId]?.icon?.color
    : undefined;
  return color ?? "default";
}

function setWidgetIconColor(config: FooterConfigSnapshot, widgetId: string, value: string): void {
  updateWidgetOverride(config, widgetId, (override) => {
    if (value === "default") {
      if (override.icon && override.icon !== null) {
        delete override.icon.color;
        if (!override.icon.text) {
          delete override.icon;
        }
      }
      return;
    }

    if (!isFooterWidgetColor(value)) return;

    const baseIcon = getDefaultWidgetIcon(widgetId);
    const icon = override.icon && override.icon !== null ? { ...override.icon } : {};
    if (!icon.text && baseIcon?.text) icon.text = baseIcon.text;
    icon.color = value;
    override.icon = icon;
  });
}

function asOptionValues(base: readonly number[], currentValue: number | undefined): string[] {
  const values = new Set(base.map((n) => String(n)));
  if (currentValue !== undefined) values.add(String(currentValue));
  return ["default", ...Array.from(values).sort((a, b) => Number(a) - Number(b))];
}

function widgetSummary(config: FooterConfigSnapshot, widgetId: string): string {
  const defaults = FOOTER_WIDGET_EDITOR_DEFAULTS[widgetId] ?? {
    row: 0,
    position: 0,
    align: "left" as const,
    fill: "none" as const,
  };

  const override = config.widgets[widgetId];
  if (!override) return "default";

  const parts: string[] = [];

  if (override.enabled === true) parts.push("on");
  if (override.enabled === false) parts.push("off");

  const row = override.row ?? defaults.row;
  const position = override.position ?? defaults.position;
  const align = override.align ?? defaults.align;

  parts.push(`r${row}`);
  parts.push(`p${position}`);
  parts.push(align);

  if (override.icon === null) {
    parts.push("icon:off");
  } else if (override.icon !== undefined) {
    parts.push(override.icon.color ? `icon:${override.icon.color}` : "icon:on");
  }

  if (override.fill !== undefined) parts.push(`fill:${override.fill}`);
  if (override.minWidth !== undefined) parts.push(`w:${override.minWidth}`);

  return parts.join(" ");
}

function widgetDescription(widgetId: string): string {
  return FOOTER_WIDGET_DESCRIPTIONS[widgetId] ?? "Footer widget";
}

function widgetSettingLabel(widgetId: string, theme: Theme, config: FooterConfigSnapshot): string {
  const icon = FOOTER_WIDGET_SETTING_ICONS[widgetId];
  if (!icon) return widgetId;

  const iconMode = getWidgetIconMode(config, widgetId);
  if (iconMode === "hide") {
    return `${theme.fg("dim", icon)} ${widgetId}`;
  }

  const configuredIconColor = getWidgetIconColorValue(config, widgetId);
  const defaultIconColor = getDefaultWidgetIcon(widgetId)?.color;
  const resolvedColor = isFooterWidgetColor(configuredIconColor)
    ? configuredIconColor
    : (defaultIconColor ?? "dim");

  return `${theme.fg(resolvedColor, icon)} ${widgetId}`;
}

function getDefaultWidgetIcon(widgetId: string): FooterWidgetIcon | undefined {
  return FOOTER_WIDGET_ICON_DEFAULTS[widgetId];
}

function widgetSettingsItems(config: FooterConfigSnapshot, widgetId: string): SettingItem[] {
  const override = config.widgets[widgetId];
  const iconMode = getWidgetIconMode(config, widgetId);
  const defaultIcon = getDefaultWidgetIcon(widgetId);

  return [
    {
      id: "enabled",
      label: "visibility",
      currentValue: getWidgetState(config, widgetId),
      values: ["default", "enabled", "disabled"],
      description: "default = original behavior, enabled = force visible, disabled = force hidden",
    },
    {
      id: "icon",
      label: "icon",
      currentValue: iconMode,
      values: ["default", "show", "hide"],
      description: defaultIcon
        ? `Default icon: ${defaultIcon.text}`
        : "This widget has no built-in icon; show only applies if a custom/default icon exists.",
    },
    {
      id: "iconColor",
      label: "icon color",
      currentValue: getWidgetIconColorValue(config, widgetId),
      values: ["default", ...FOOTER_WIDGET_COLORS],
      description: "Color used for the icon when shown",
    },
    {
      id: "row",
      label: "row",
      currentValue: override?.row !== undefined ? String(override.row) : "default",
      values: asOptionValues(FOOTER_ROW_OPTIONS, override?.row),
      description: "Move this widget to another row",
    },
    {
      id: "position",
      label: "position",
      currentValue: override?.position !== undefined ? String(override.position) : "default",
      values: asOptionValues(FOOTER_POSITION_OPTIONS, override?.position),
      description: "Order within the same alignment group on that row",
    },
    {
      id: "align",
      label: "align",
      currentValue: override?.align ?? "default",
      values: ["default", "left", "middle", "right"],
    },
    {
      id: "fill",
      label: "fill",
      currentValue: override?.fill ?? "default",
      values: ["default", "none", "grow"],
      description: "grow consumes extra horizontal space",
    },
    {
      id: "minWidth",
      label: "min width",
      currentValue: override?.minWidth !== undefined ? String(override.minWidth) : "default",
      values: asOptionValues(FOOTER_MIN_WIDTH_OPTIONS, override?.minWidth),
    },
  ];
}

function createWidgetSettingsSubmenu(
  draft: FooterConfigSnapshot,
  theme: Theme,
  widgetId: string,
  applyDraft: () => void,
) {
  return (_currentValue: string, done: (selectedValue?: string) => void) => {
    const submenuItems = widgetSettingsItems(draft, widgetId);

    const subContainer = new Container();
    subContainer.addChild(new Text(theme.fg("accent", theme.bold(`Widget: ${widgetSettingLabel(widgetId, theme, draft)}`)), 1, 0));
    subContainer.addChild(new Text(theme.fg("dim", "Configure location and behavior"), 1, 0));

    const subSettings = new SettingsList(
      submenuItems,
      Math.min(submenuItems.length + 2, 14),
      getSettingsListTheme(),
      (fieldId, newValue) => {
        if (fieldId === "enabled" && (newValue === "default" || newValue === "enabled" || newValue === "disabled")) {
          setWidgetState(draft, widgetId, newValue);
        } else if (fieldId === "icon") {
          setWidgetIconMode(draft, widgetId, newValue);
        } else if (fieldId === "iconColor") {
          setWidgetIconColor(draft, widgetId, newValue);
        } else if (fieldId === "row" || fieldId === "position" || fieldId === "minWidth") {
          setWidgetNumberOverride(draft, widgetId, fieldId, newValue);
        } else if (fieldId === "align") {
          setWidgetAlignOverride(draft, widgetId, newValue);
        } else if (fieldId === "fill") {
          setWidgetFillOverride(draft, widgetId, newValue);
        }

        applyDraft();
      },
      () => {
        done(widgetSummary(draft, widgetId));
      },
    );

    subContainer.addChild(subSettings);
    subContainer.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter/space change • esc back"), 1, 0));

    return {
      render(width: number) {
        return subContainer.render(width);
      },
      invalidate() {
        subContainer.invalidate();
      },
      handleInput(data: string) {
        subSettings.handleInput?.(data);
      },
    };
  };
}

function rootFooterSettingsItems(
  draft: FooterConfigSnapshot,
  theme: Theme,
  applyDraft: () => void,
): SettingItem[] {
  const refreshValues = Array.from(
    new Set([String(draft.refreshMs), ...FOOTER_REFRESH_OPTIONS.map((n) => String(n))]),
  ).sort((a, b) => Number(a) - Number(b));

  const items: SettingItem[] = [
    {
      id: "refreshMs",
      label: "refresh interval (ms)",
      currentValue: String(draft.refreshMs),
      values: refreshValues,
      description: "How often git/footer data is refreshed. Lower = snappier, higher = fewer background git calls.",
    },
  ];

  for (const widgetId of FOOTER_WIDGET_IDS) {
    items.push({
      id: `widget:${widgetId}`,
      label: widgetSettingLabel(widgetId, theme, draft),
      currentValue: widgetSummary(draft, widgetId),
      description: widgetDescription(widgetId),
      submenu: createWidgetSettingsSubmenu(draft, theme, widgetId, applyDraft),
    });
  }

  return items;
}

function applyWidgetConfigOverrides(
  widgets: FooterWidget[],
  overrides: Record<string, FooterWidgetConfigOverride>,
): FooterWidget[] {
  return widgets.map((widget) => {
    const override = overrides[widget.id];
    if (!override) return widget;

    const location: FooterWidgetLocation = {
      row: override.row ?? widget.location.row,
      position: override.position ?? widget.location.position,
    };

    const textColor = override.textColor ?? widget.textColor;

    let icon = widget.icon;
    if (override.icon === null) {
      icon = undefined;
    } else if (override.icon) {
      const fallbackColor: FooterWidgetColor = widget.icon?.color ?? textColor ?? "dim";
      const nextText = override.icon.text ?? widget.icon?.text ?? "";
      const nextColor = override.icon.color ?? fallbackColor;
      icon = nextText ? { text: nextText, color: nextColor } : undefined;
    }

    let visible = widget.visible;
    let renderText = widget.renderText;

    if (override.enabled === false) {
      visible = () => false;
    } else if (override.enabled === true) {
      visible = () => true;
      const originalRenderText = renderText;
      renderText = (renderCtx, availableWidth) => {
        const out = originalRenderText(renderCtx, availableWidth);
        if (visibleWidth(out) > 0) return out;
        return widget.styled ? renderCtx.theme.fg("dim", "·") : "·";
      };
    }

    return {
      ...widget,
      location,
      align: override.align ?? widget.align,
      fill: override.fill ?? widget.fill,
      minWidth: override.minWidth !== undefined ? override.minWidth : widget.minWidth,
      icon,
      textColor,
      visible,
      renderText,
    };
  });
}

function widgetKey(widget: FooterWidget): string {
  return `${widget.location.row}:${widget.id}`;
}

function resolveWidgetSize(size: FooterWidgetSize | undefined, renderCtx: WidgetRenderContext): number {
  if (typeof size === "number") {
    return Math.max(0, Math.floor(size));
  }
  if (typeof size === "function") {
    return Math.max(0, Math.floor(size(renderCtx)));
  }
  return 0;
}

function isWidgetVisible(widget: FooterWidget, renderCtx: WidgetRenderContext): boolean {
  if (!widget.visible) return true;
  return widget.visible(renderCtx);
}

function renderWidget(
  widget: FooterWidget,
  renderCtx: WidgetRenderContext,
  allocatedWidth?: number,
): string {
  if (!isWidgetVisible(widget, renderCtx)) return "";

  const hasIcon = Boolean(widget.icon?.text);
  const iconText = widget.icon?.text ?? "";
  const iconWidth = hasIcon ? visibleWidth(iconText) : 0;

  const maxTotalWidth = allocatedWidth === undefined ? undefined : Math.max(0, Math.floor(allocatedWidth));
  const contentWidth =
    maxTotalWidth === undefined
      ? undefined
      : Math.max(0, maxTotalWidth - iconWidth);

  const rawText = widget.renderText(renderCtx, contentWidth);
  const styledText = widget.styled
    ? rawText
    : renderCtx.theme.fg(widget.textColor ?? "dim", rawText);

  const styledIcon = hasIcon && widget.icon
    ? renderCtx.theme.fg(widget.icon.color, iconText)
    : "";

  const combined = `${styledIcon}${styledText}`;
  if (maxTotalWidth === undefined) return combined;
  return truncateToWidth(combined, maxTotalWidth, "");
}

function prepareWidgetGroup(
  widgets: FooterWidget[],
  renderCtx: WidgetRenderContext,
): PreparedWidgetGroup {
  const sorted = [...widgets].sort((a, b) => a.location.position - b.location.position);
  const prepared: PreparedWidget[] = [];

  for (const widget of sorted) {
    const fill = widget.fill ?? "none";
    if (fill === "grow") {
      prepared.push({
        widget,
        fill,
        minWidth: resolveWidgetSize(widget.minWidth, renderCtx),
        fixedText: "",
        fixedWidth: 0,
      });
      continue;
    }

    const fixedText = renderWidget(widget, renderCtx);
    const fixedWidth = visibleWidth(fixedText);
    if (fixedWidth <= 0) continue;

    prepared.push({
      widget,
      fill,
      minWidth: 0,
      fixedText,
      fixedWidth,
    });
  }

  const gaps = Math.max(0, prepared.length - 1);
  const contentMinWidth = prepared.reduce((acc, item) => {
    if (item.fill === "grow") return acc + item.minWidth;
    return acc + item.fixedWidth;
  }, 0);

  return {
    widgets: prepared,
    minWidth: contentMinWidth + gaps,
  };
}

function renderGroup(
  group: PreparedWidgetGroup,
  renderCtx: WidgetRenderContext,
  fillExtras: Map<string, number>,
): string {
  const parts: string[] = [];

  for (const item of group.widgets) {
    if (item.fill === "grow") {
      const extra = fillExtras.get(widgetKey(item.widget)) ?? 0;
      const allocatedWidth = item.minWidth + extra;
      const rendered = renderWidget(item.widget, renderCtx, allocatedWidth);
      if (rendered) parts.push(rendered);
      continue;
    }

    if (item.fixedText) parts.push(item.fixedText);
  }

  return parts.join(" ");
}

function composeAlignedRow(
  width: number,
  left: string,
  middle: string,
  right: string,
  theme: Theme,
): string {
  const fallback = () => {
    const joined = [left, middle, right].filter((part) => part).join(" ");
    return truncateToWidth(joined, width, theme.fg("dim", "..."));
  };

  const leftWidth = visibleWidth(left);
  const middleWidth = visibleWidth(middle);
  const rightWidth = visibleWidth(right);

  if (!middle) {
    if (left && right) {
      if (leftWidth + rightWidth + 1 > width) return fallback();
      const gap = Math.max(1, width - leftWidth - rightWidth);
      return truncateToWidth(`${left}${" ".repeat(gap)}${right}`, width, theme.fg("dim", "..."));
    }

    if (left) return truncateToWidth(left, width, theme.fg("dim", "..."));
    if (right) {
      if (rightWidth > width) return fallback();
      return `${" ".repeat(width - rightWidth)}${right}`;
    }
    return "";
  }

  if (!left && !right) {
    if (middleWidth > width) return fallback();
    const start = Math.max(0, Math.floor((width - middleWidth) / 2));
    return truncateToWidth(`${" ".repeat(start)}${middle}`, width, theme.fg("dim", "..."));
  }

  const gapLeftMiddle = left ? 1 : 0;
  const gapMiddleRight = right ? 1 : 0;

  const leftBoundary = leftWidth + gapLeftMiddle;
  const rightBoundary = width - rightWidth - gapMiddleRight;
  if (rightBoundary < leftBoundary) return fallback();

  const slotWidth = rightBoundary - leftBoundary;
  let middleText = middle;
  if (middleWidth > slotWidth) {
    middleText = truncateToWidth(middleText, slotWidth, "");
  }

  const middleTextWidth = visibleWidth(middleText);
  const middleStart = leftBoundary + Math.max(0, Math.floor((slotWidth - middleTextWidth) / 2));

  const preMiddleSpaces = Math.max(0, middleStart - leftBoundary);
  const postMiddleSpaces = Math.max(0, rightBoundary - (middleStart + middleTextWidth));

  let out = "";
  if (left) {
    out += left;
    out += " ";
  }
  out += " ".repeat(preMiddleSpaces);
  out += middleText;
  out += " ".repeat(postMiddleSpaces);
  if (right) {
    out += " ";
    out += right;
  }

  return truncateToWidth(out, width, theme.fg("dim", "..."));
}

function computeFooterMetrics(
  ctx: ExtensionContext,
  git: GitInfo,
  thinkingLevel: string,
  theme: Theme,
): FooterMetrics {
  const entries = ctx.sessionManager.getBranch();
  const { latest, totalCost } = getUsageData(entries);

  const contextUsage = ctx.getContextUsage();
  const totalTokens = Math.max(
    1,
    Math.floor(toNumber(contextUsage?.contextWindow ?? ctx.model?.contextWindow ?? 200_000)),
  );

  const contextTokensRaw = contextUsage?.tokens;
  const contextTokensKnown = typeof contextTokensRaw === "number" && Number.isFinite(contextTokensRaw);
  const contextTokens = contextTokensKnown ? Math.max(0, Math.floor(contextTokensRaw)) : 0;

  const usedRaw = Number(contextUsage?.percent);
  const hasUsedPercent = Number.isFinite(usedRaw) && usedRaw >= 0;
  const usedPct = Math.max(
    0,
    Math.min(100, Math.round(hasUsedPercent ? usedRaw : (contextTokens * 100) / Math.max(1, totalTokens))),
  );

  let inputTokens = latest ? latest.input : contextTokens;
  let cacheTokens = latest ? latest.cacheRead + latest.cacheWrite : 0;

  const minUsedTokens = Math.max(0, contextTokens);
  if (inputTokens + cacheTokens < minUsedTokens) {
    inputTokens += minUsedTokens - (inputTokens + cacheTokens);
  }

  const usageFromLatest = Math.max(0, Math.floor(inputTokens + cacheTokens));
  const usageFromPercent = hasUsedPercent ? Math.floor((usedPct * totalTokens) / 100) : 0;
  const usedTokensForBar = contextTokensKnown ? contextTokens : Math.max(usageFromPercent, usageFromLatest);

  const model = normalizeModel(ctx.model?.name || ctx.model?.id || "Claude");
  const thinking = renderThinkingLevel(thinkingLevel, theme);

  const usedK = Math.floor(usedTokensForBar / 1000);
  const totalK = Math.max(1, Math.floor(totalTokens / 1000));

  return {
    model,
    thinking,
    totalTokens,
    usedTokensForBar,
    usedK,
    totalK,
    totalCost,
    locationText: git.repository || normalizePath(ctx.cwd),
    branch: git.branch,
    commit: git.commit,
    added: git.added,
    removed: git.removed,
    gitStatus: buildGitStatus(git.counts, theme),
  };
}

function buildFooterWidgets(renderCtx: WidgetRenderContext): FooterWidget[] {
  const modelIcon = STATUSLINE_SYMBOLS.model
    ? { text: STATUSLINE_SYMBOLS.model, color: "accent" as const }
    : undefined;

  return [
    {
      id: "model",
      location: { row: 1, position: 6 },
      align: "right",
      icon: modelIcon,
      textColor: "text",
      renderText: ({ metrics }) => metrics.model,
    },
    {
      id: "thinking",
      location: { row: 1, position: 7 },
      align: "right",
      styled: true,
      visible: ({ metrics }) => metrics.thinking !== "",
      renderText: ({ metrics }) => metrics.thinking,
    },
    {
      id: "context-capacity",
      location: { row: 0, position: 2 },
      align: "left",
      icon: { text: STATUSLINE_SYMBOLS.contextCapacityMarker, color: "accent" },
      textColor: "dim",
      renderText: ({ metrics }) => `${metrics.totalK}k`,
    },
    {
      id: "context-bar",
      location: { row: 0, position: 0 },
      align: "middle",
      fill: "grow",
      minWidth: ({ width }) => (width >= 100 ? 12 : width >= 70 ? 8 : 4),
      styled: true,
      renderText: ({ metrics, compactionSettings, theme }, availableWidth = 0) =>
        buildBricks(
          Math.max(0, Math.floor(availableWidth)),
          metrics.totalTokens,
          metrics.usedTokensForBar,
          compactionSettings,
          theme,
        ),
    },
    {
      id: "context-usage",
      location: { row: 0, position: 0 },
      align: "right",
      icon: { text: STATUSLINE_SYMBOLS.contextUsageMarker, color: "accent" },
      textColor: "dim",
      visible: ({ width }) => width >= 40,
      renderText: ({ metrics }) => `${metrics.usedK}k`,
    },
    {
      id: "total-cost",
      location: { row: 0, position: 1 },
      align: "right",
      icon: { text: STATUSLINE_SYMBOLS.currency, color: "warning" },
      textColor: "dim",
      visible: ({ width, metrics }) => width >= 60 && metrics.totalCost > 0,
      renderText: ({ metrics }) => metrics.totalCost.toFixed(2),
    },
    {
      id: "location",
      location: { row: 1, position: 0 },
      align: "left",
      icon: { text: STATUSLINE_SYMBOLS.path, color: "accent" },
      textColor: "dim",
      renderText: ({ metrics }) => metrics.locationText,
    },
    {
      id: "branch",
      location: { row: 1, position: 1 },
      align: "left",
      icon: { text: STATUSLINE_SYMBOLS.branch, color: "accent" },
      textColor: "dim",
      visible: ({ metrics }) => metrics.branch !== "",
      renderText: ({ metrics }) => metrics.branch,
    },
    {
      id: "commit",
      location: { row: 1, position: 2 },
      align: "left",
      icon: { text: STATUSLINE_SYMBOLS.commit, color: "accent" },
      textColor: "dim",
      visible: ({ metrics }) => metrics.commit !== "",
      renderText: ({ metrics }) => metrics.commit,
    },
    {
      id: "diff-added",
      location: { row: 1, position: 3 },
      align: "left",
      icon: { text: STATUSLINE_SYMBOLS.diffAdded, color: "success" },
      textColor: "dim",
      visible: ({ metrics }) => metrics.added > 0,
      renderText: ({ metrics }) => `${metrics.added}`,
    },
    {
      id: "diff-removed",
      location: { row: 1, position: 4 },
      align: "left",
      icon: { text: STATUSLINE_SYMBOLS.diffRemoved, color: "error" },
      textColor: "dim",
      visible: ({ metrics }) => metrics.removed > 0,
      renderText: ({ metrics }) => `${metrics.removed}`,
    },
    {
      id: "git-status",
      location: { row: 1, position: 5 },
      align: "left",
      styled: true,
      visible: ({ metrics }) => metrics.gitStatus !== "",
      renderText: ({ metrics }) => metrics.gitStatus,
    },
  ];
}

function renderWidgetRow(
  width: number,
  rowWidgets: FooterWidget[],
  renderCtx: WidgetRenderContext,
): string {
  if (width <= 0 || rowWidgets.length === 0) return "";

  const visibleWidgets = rowWidgets.filter((widget) => isWidgetVisible(widget, renderCtx));
  if (visibleWidgets.length === 0) return "";

  const leftGroup = prepareWidgetGroup(
    visibleWidgets.filter((widget) => widget.align === "left"),
    renderCtx,
  );
  const middleGroup = prepareWidgetGroup(
    visibleWidgets.filter((widget) => widget.align === "middle"),
    renderCtx,
  );
  const rightGroup = prepareWidgetGroup(
    visibleWidgets.filter((widget) => widget.align === "right"),
    renderCtx,
  );

  const groups = [leftGroup, middleGroup, rightGroup];
  const occupiedGroups = groups.filter((group) => group.widgets.length > 0);
  const interGroupGaps = Math.max(0, occupiedGroups.length - 1);

  const minRequiredWidth = groups.reduce((acc, group) => acc + group.minWidth, 0) + interGroupGaps;

  const fillExtras = new Map<string, number>();

  if (minRequiredWidth <= width) {
    const fillWidgets = groups.flatMap((group) =>
      group.widgets.filter((item) => item.fill === "grow"),
    );
    if (fillWidgets.length > 0) {
      const extraSpace = width - minRequiredWidth;
      const baseExtra = Math.floor(extraSpace / fillWidgets.length);
      let remainder = extraSpace % fillWidgets.length;

      for (const item of fillWidgets) {
        const add = baseExtra + (remainder > 0 ? 1 : 0);
        if (remainder > 0) remainder -= 1;
        fillExtras.set(widgetKey(item.widget), add);
      }
    }
  }

  const leftText = renderGroup(leftGroup, renderCtx, fillExtras);
  const middleText = renderGroup(middleGroup, renderCtx, fillExtras);
  const rightText = renderGroup(rightGroup, renderCtx, fillExtras);

  if (minRequiredWidth > width) {
    const fallback = [leftText, middleText, rightText].filter((part) => part).join(" ");
    return truncateToWidth(fallback, width, renderCtx.theme.fg("dim", "..."));
  }

  return composeAlignedRow(width, leftText, middleText, rightText, renderCtx.theme);
}

function renderFooterLines(
  width: number,
  ctx: ExtensionContext,
  git: GitInfo,
  thinkingLevel: string,
  theme: Theme,
  compactionSettings: CompactionSettingsSnapshot,
  footerConfig: FooterConfigSnapshot,
): string[] {
  if (width <= 0) return ["", ""];

  const metrics = computeFooterMetrics(ctx, git, thinkingLevel, theme);
  const renderCtx: WidgetRenderContext = {
    width,
    theme,
    ctx,
    compactionSettings,
    metrics,
  };

  const widgets = applyWidgetConfigOverrides(buildFooterWidgets(renderCtx), footerConfig.widgets);
  const highestRow = Math.max(1, ...widgets.map((widget) => widget.location.row));

  const rows: string[] = [];
  for (let row = 0; row <= highestRow; row++) {
    const rowWidgets = widgets.filter((widget) => widget.location.row === row);
    const line = renderWidgetRow(width, rowWidgets, renderCtx);
    rows.push(truncateToWidth(line.trimEnd(), width, theme.fg("dim", "...")));
  }

  while (rows.length < 2) rows.push("");
  return rows;
}

export default function (pi: ExtensionAPI) {
  let compactionSettings: CompactionSettingsSnapshot = { ...DEFAULT_COMPACTION_SETTINGS };
  let footerConfig: FooterConfigSnapshot = {
    refreshMs: DEFAULT_FOOTER_CONFIG.refreshMs,
    widgets: { ...DEFAULT_FOOTER_CONFIG.widgets },
  };

  const installFooter = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;

    compactionSettings = loadCompactionSettings(ctx.cwd);
    footerConfig = loadFooterConfig();

    ctx.ui.setFooter((tui, theme, footerData) => {
      let currentGit: GitInfo = { ...EMPTY_GIT_INFO };
      let refreshing = false;
      let refreshQueued = false;
      let disposed = false;

      const refreshGit = async () => {
        if (disposed) return;
        if (refreshing) {
          refreshQueued = true;
          return;
        }

        refreshing = true;
        try {
          do {
            refreshQueued = false;
            compactionSettings = loadCompactionSettings(ctx.cwd);
            footerConfig = loadFooterConfig();
            const git = await collectGitInfo(pi, ctx.cwd);
            if (disposed) return;
            currentGit = git;
            tui.requestRender();
          } while (!disposed && refreshQueued);
        } finally {
          refreshing = false;
        }
      };

      const onBranchChange = footerData.onBranchChange(() => {
        void refreshGit();
      });

      const refreshMs = Math.max(MIN_FOOTER_REFRESH_MS, footerConfig.refreshMs);
      const interval = setInterval(() => {
        void refreshGit();
      }, refreshMs);

      void refreshGit();

      return {
        invalidate() {},
        dispose() {
          disposed = true;
          onBranchChange();
          clearInterval(interval);
        },
        render(width: number): string[] {
          return renderFooterLines(width, ctx, currentGit, pi.getThinkingLevel(), theme, compactionSettings, footerConfig);
        },
      };
    });
  };

  pi.registerCommand("fancy-footer", {
    description: "Edit fancy footer config",
    handler: async (_args, ctx) => {
      const configPath = getFooterConfigPath();

      if (!ctx.hasUI) {
        ctx.ui.notify("/fancy-footer requires interactive UI mode", "warning");
        return;
      }

      let draft = cloneFooterConfig(loadFooterConfig());

      await ctx.ui.custom((tui, theme, _kb, done) => {
        const applyDraft = () => {
          try {
            writeFooterConfigSnapshot(draft);
            footerConfig = loadFooterConfig();
            installFooter(ctx);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(`Failed to save config: ${msg}`, "error");
          }
        };

        const container = new Container();
        container.addChild(new Text(theme.fg("accent", theme.bold("Fancy Footer Configuration")), 1, 0));
        container.addChild(new Text(theme.fg("dim", configPath), 1, 0));

        let settingsList: SettingsList;
        const syncRootValues = () => {
          settingsList.updateValue("refreshMs", String(draft.refreshMs));
          for (const widgetId of FOOTER_WIDGET_IDS) {
            settingsList.updateValue(`widget:${widgetId}`, widgetSummary(draft, widgetId));
          }
        };

        const items = rootFooterSettingsItems(draft, theme, () => {
          applyDraft();
          syncRootValues();
          tui.requestRender();
        });

        settingsList = new SettingsList(
          items,
          Math.min(items.length + 2, 18),
          getSettingsListTheme(),
          (id, newValue) => {
            if (id === "refreshMs") {
              const refreshMs = toNonNegativeInt(newValue);
              if (refreshMs !== undefined) {
                draft.refreshMs = Math.max(MIN_FOOTER_REFRESH_MS, refreshMs);
                applyDraft();
                syncRootValues();
              }
            }
            tui.requestRender();
          },
          () => {
            done(undefined);
          },
        );

        container.addChild(settingsList);
        container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter configure widget • enter/space change values • esc close"), 1, 0));

        return {
          render(width: number) {
            return container.render(width);
          },
          invalidate() {
            container.invalidate();
          },
          handleInput(data: string) {
            settingsList.handleInput?.(data);
            tui.requestRender();
          },
        };
      });
    },
  });

  pi.on("session_before_compact", async (event) => {
    compactionSettings = coerceCompactionSettings(event.preparation.settings, compactionSettings);
  });

  pi.on("session_start", async (_event, ctx) => {
    installFooter(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    installFooter(ctx);
  });
}
