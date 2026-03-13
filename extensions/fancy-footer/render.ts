import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionContext, SessionEntry, Theme } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import {
  FOOTER_WIDGET_META,
  MAX_CONTEXT_BAR_CELLS,
  MAX_WIDGET_MIN_WIDTH,
  MAX_WIDGET_POSITION,
  MAX_WIDGET_ROW,
  STATUSLINE_SYMBOLS,
  type CompactionSettingsSnapshot,
  type FooterConfigSnapshot,
  type FooterMetrics,
  type FooterWidget,
  type FooterWidgetId,
  type FooterWidgetSize,
  type GitCounts,
  type GitInfo,
  type PreparedWidget,
  type PreparedWidgetGroup,
  type SessionUsageMetrics,
  type WidgetRenderContext,
  clampInt,
  formatThinkingLevel,
  getDefaultWidgetIcon,
  normalizeModel,
  normalizePath,
  toNumber,
} from "./shared.ts";

function getUsageData(entries: SessionEntry[]): SessionUsageMetrics {
  let latest: SessionUsageMetrics["latest"];
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

export function collectSessionUsageMetrics(ctx: ExtensionContext): SessionUsageMetrics {
  return getUsageData(ctx.sessionManager.getBranch());
}

function buildBricks(
  cells: number,
  totalTokens: number,
  usedTokens: number,
  settings: CompactionSettingsSnapshot,
  theme: Theme,
): string {
  const n = clampInt(cells, 0, MAX_CONTEXT_BAR_CELLS);
  if (n === 0) return "";

  const total = Math.max(1, Math.floor(totalTokens));
  const clampedUsedTokens = Math.max(0, Math.min(total, Math.floor(usedTokens)));

  const reserveTokens = settings.enabled ? Math.max(0, Math.floor(settings.reserveTokens)) : 0;
  const safeTokens = Math.max(0, Math.min(total, total - reserveTokens));

  let safeCells = Math.floor((safeTokens * n) / total);
  safeCells = Math.max(0, Math.min(n, safeCells));

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

function buildGitStatus(counts: GitCounts): Pick<FooterMetrics, "gitStatusSymbol" | "gitStatusText"> {
  if (counts.ahead > 0 && counts.behind > 0) {
    return { gitStatusSymbol: STATUSLINE_SYMBOLS.gitDiverged, gitStatusText: `${counts.ahead}/${counts.behind}` };
  }
  if (counts.ahead > 0) {
    return { gitStatusSymbol: STATUSLINE_SYMBOLS.gitAhead, gitStatusText: `${counts.ahead}` };
  }
  if (counts.behind > 0) {
    return { gitStatusSymbol: STATUSLINE_SYMBOLS.gitBehind, gitStatusText: `${counts.behind}` };
  }
  return { gitStatusSymbol: "", gitStatusText: "" };
}

function resolveGitStatusSymbolColor(
  symbol: string,
  configuredColor: FooterConfigSnapshot["defaultIconColor"],
): FooterConfigSnapshot["defaultIconColor"] {
  if (configuredColor !== "text") return configuredColor;
  if (symbol === STATUSLINE_SYMBOLS.gitBehind) return "warning";
  if (symbol === STATUSLINE_SYMBOLS.gitAhead || symbol === STATUSLINE_SYMBOLS.gitDiverged) return "accent";
  return configuredColor;
}

function widgetKey(widget: FooterWidget): string {
  return `${widget.location.row}:${widget.id}`;
}

function resolveWidgetSize(size: FooterWidgetSize | undefined, renderCtx: WidgetRenderContext): number {
  if (typeof size === "number") {
    return clampInt(size, 0, MAX_WIDGET_MIN_WIDTH);
  }
  if (typeof size === "function") {
    return clampInt(size(renderCtx), 0, MAX_WIDGET_MIN_WIDTH);
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
  const contentWidth = maxTotalWidth === undefined
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
  usageMetrics: SessionUsageMetrics,
): FooterMetrics {
  const { latest, totalCost } = usageMetrics;

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
  const thinking = formatThinkingLevel(thinkingLevel);

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
    pullRequestNumber: git.pullRequest?.number ?? 0,
    added: git.added,
    removed: git.removed,
    ...buildGitStatus(git.counts),
  };
}

function baseWidgetDefaults(widgetId: FooterWidgetId): Pick<FooterWidget, "id" | "location" | "align" | "fill" | "icon" | "textColor"> {
  const defaults = FOOTER_WIDGET_META[widgetId].defaults;

  return {
    id: widgetId,
    location: {
      row: defaults.row,
      position: defaults.position,
    },
    align: defaults.align,
    fill: defaults.fill,
    icon: getDefaultWidgetIcon(widgetId),
    textColor: "dim",
  };
}

function buildFooterWidgets(): FooterWidget[] {
  return [
    {
      ...baseWidgetDefaults("model"),
      renderText: ({ metrics }) => metrics.model,
    },
    {
      ...baseWidgetDefaults("thinking"),
      visible: ({ metrics }) => metrics.thinking !== "",
      renderText: ({ metrics }) => metrics.thinking,
    },
    {
      ...baseWidgetDefaults("context-capacity"),
      renderText: ({ metrics }) => `${metrics.totalK}k`,
    },
    {
      ...baseWidgetDefaults("context-bar"),
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
      ...baseWidgetDefaults("context-usage"),
      visible: ({ width }) => width >= 40,
      renderText: ({ metrics }) => `${metrics.usedK}k`,
    },
    {
      ...baseWidgetDefaults("total-cost"),
      visible: ({ width, metrics }) => width >= 60 && metrics.totalCost > 0,
      renderText: ({ metrics }) => metrics.totalCost.toFixed(2),
    },
    {
      ...baseWidgetDefaults("location"),
      renderText: ({ metrics }) => metrics.locationText,
    },
    {
      ...baseWidgetDefaults("branch"),
      visible: ({ metrics }) => metrics.branch !== "",
      renderText: ({ metrics }) => metrics.branch,
    },
    {
      ...baseWidgetDefaults("commit"),
      visible: ({ metrics }) => metrics.commit !== "",
      renderText: ({ metrics }) => metrics.commit,
    },
    {
      ...baseWidgetDefaults("pull-request"),
      visible: ({ metrics }) => metrics.pullRequestNumber > 0,
      renderText: ({ metrics }) => `${metrics.pullRequestNumber}`,
    },
    {
      ...baseWidgetDefaults("diff-added"),
      visible: ({ metrics }) => metrics.added > 0,
      renderText: ({ metrics }) => `${metrics.added}`,
    },
    {
      ...baseWidgetDefaults("diff-removed"),
      visible: ({ metrics }) => metrics.removed > 0,
      renderText: ({ metrics }) => `${metrics.removed}`,
    },
    {
      ...baseWidgetDefaults("git-status"),
      styled: true,
      visible: ({ metrics }) => metrics.gitStatusSymbol !== "",
      renderText: ({ metrics, theme, defaultIconColor, defaultTextColor }) => {
        const symbolColor = resolveGitStatusSymbolColor(metrics.gitStatusSymbol, defaultIconColor);
        return `${theme.fg(symbolColor, metrics.gitStatusSymbol)}${theme.fg(defaultTextColor, metrics.gitStatusText)}`;
      },
    },
  ];
}

function applyWidgetConfigOverrides(
  widgets: FooterWidget[],
  overrides: FooterConfigSnapshot["widgets"],
  defaultTextColor: FooterConfigSnapshot["defaultTextColor"],
  defaultIconColor: FooterConfigSnapshot["defaultIconColor"],
): FooterWidget[] {
  return widgets.map((widget) => {
    const override = overrides[widget.id] ?? {};

    const location = {
      row: clampInt(override.row ?? widget.location.row, 0, MAX_WIDGET_ROW),
      position: clampInt(override.position ?? widget.location.position, 0, MAX_WIDGET_POSITION),
    };

    const textColor = override.textColor ?? defaultTextColor;
    const resolvedIconColor = override.iconColor ?? defaultIconColor;

    let icon = widget.icon;
    if (override.icon === "hide") {
      icon = undefined;
    } else if (override.icon === "show") {
      icon = widget.icon ?? getDefaultWidgetIcon(widget.id);
    }

    if (icon) {
      icon = {
        ...icon,
        color: resolvedIconColor,
      };
    }

    let visible = widget.visible;
    let renderText = widget.renderText;

    const baseRenderText = renderText;
    renderText = (renderCtx, availableWidth) =>
      baseRenderText(
        {
          ...renderCtx,
          defaultIconColor: resolvedIconColor,
          defaultTextColor: textColor,
        },
        availableWidth,
      );

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
      minWidth: override.minWidth !== undefined
        ? clampInt(override.minWidth, 0, MAX_WIDGET_MIN_WIDTH)
        : widget.minWidth,
      icon,
      textColor,
      visible,
      renderText,
    };
  });
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

export function renderFooterLines(
  width: number,
  ctx: ExtensionContext,
  git: GitInfo,
  thinkingLevel: string,
  theme: Theme,
  usageMetrics: SessionUsageMetrics,
  compactionSettings: CompactionSettingsSnapshot,
  footerConfig: FooterConfigSnapshot,
): string[] {
  if (width <= 0) return ["", ""];

  const metrics = computeFooterMetrics(ctx, git, thinkingLevel, usageMetrics);
  const renderCtx: WidgetRenderContext = {
    width,
    theme,
    ctx,
    compactionSettings,
    metrics,
    defaultIconColor: footerConfig.defaultIconColor,
    defaultTextColor: footerConfig.defaultTextColor,
  };

  const widgets = applyWidgetConfigOverrides(
    buildFooterWidgets(),
    footerConfig.widgets,
    footerConfig.defaultTextColor,
    footerConfig.defaultIconColor,
  );
  const highestRow = clampInt(
    Math.max(1, ...widgets.map((widget) => widget.location.row)),
    1,
    MAX_WIDGET_ROW,
  );

  const rows: string[] = [];
  for (let row = 0; row <= highestRow; row++) {
    const rowWidgets = widgets.filter((widget) => widget.location.row === row);
    const line = renderWidgetRow(width, rowWidgets, renderCtx);
    rows.push(truncateToWidth(line.trimEnd(), width, theme.fg("dim", "...")));
  }

  while (rows.length < 2) rows.push("");
  return rows;
}
