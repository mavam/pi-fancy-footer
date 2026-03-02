import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getSettingsListTheme, type Theme } from "@mariozechner/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@mariozechner/pi-tui";
import {
  DEFAULT_COMPACTION_SETTINGS,
  DEFAULT_FOOTER_CONFIG,
  FOOTER_CONFIG_FILE,
  FOOTER_MIN_WIDTH_OPTIONS,
  FOOTER_POSITION_OPTIONS,
  FOOTER_REFRESH_OPTIONS,
  FOOTER_ROW_OPTIONS,
  FOOTER_WIDGET_COLORS,
  FOOTER_WIDGET_IDS,
  FOOTER_WIDGET_META,
  MAX_FOOTER_REFRESH_MS,
  MAX_WIDGET_MIN_WIDTH,
  MAX_WIDGET_POSITION,
  MAX_WIDGET_ROW,
  MIN_FOOTER_REFRESH_MS,
  type CompactionSettingsSnapshot,
  type FooterConfigSnapshot,
  type FooterWidgetAlign,
  type FooterWidgetColor,
  type FooterWidgetConfigOverride,
  type FooterWidgetFill,
  type FooterWidgetIconMode,
  type FooterWidgetId,
  type FooterWidgetState,
  clampInt,
  getDefaultWidgetIcon,
  isFooterWidgetAlign,
  isFooterWidgetColor,
  isFooterWidgetFill,
  isFooterWidgetId,
  toBoundedNonNegativeInt,
} from "./shared.ts";

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

export function coerceCompactionSettings(
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

export function loadCompactionSettings(cwd: string): CompactionSettingsSnapshot {
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

function coerceFooterWidgetOverride(value: unknown): FooterWidgetConfigOverride | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const input = value as Record<string, unknown>;
  const out: FooterWidgetConfigOverride = {};

  if (typeof input.enabled === "boolean") out.enabled = input.enabled;

  const row = toBoundedNonNegativeInt(input.row, MAX_WIDGET_ROW);
  if (row !== undefined) out.row = row;

  const position = toBoundedNonNegativeInt(input.position, MAX_WIDGET_POSITION);
  if (position !== undefined) out.position = position;

  if (isFooterWidgetAlign(input.align)) out.align = input.align;
  if (isFooterWidgetFill(input.fill)) out.fill = input.fill;

  const minWidth = toBoundedNonNegativeInt(input.minWidth, MAX_WIDGET_MIN_WIDTH);
  if (minWidth !== undefined) out.minWidth = minWidth;

  if (input.icon === "show" || input.icon === "hide") {
    out.icon = input.icon;
  }

  if (isFooterWidgetColor(input.iconColor)) out.iconColor = input.iconColor;
  if (isFooterWidgetColor(input.textColor)) out.textColor = input.textColor;

  return out;
}

function coerceFooterConfig(value: unknown): FooterConfigSnapshot {
  const out: FooterConfigSnapshot = {
    refreshMs: DEFAULT_FOOTER_CONFIG.refreshMs,
    showPiBanner: DEFAULT_FOOTER_CONFIG.showPiBanner,
    defaultTextColor: DEFAULT_FOOTER_CONFIG.defaultTextColor,
    defaultIconColor: DEFAULT_FOOTER_CONFIG.defaultIconColor,
    widgets: {},
  };

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return out;
  }

  const input = value as Record<string, unknown>;

  const refreshMs = toBoundedNonNegativeInt(input.refreshMs, MAX_FOOTER_REFRESH_MS);
  if (refreshMs !== undefined) {
    out.refreshMs = Math.max(MIN_FOOTER_REFRESH_MS, refreshMs);
  }

  if (typeof input.showPiBanner === "boolean") {
    out.showPiBanner = input.showPiBanner;
  }

  if (isFooterWidgetColor(input.defaultTextColor)) {
    out.defaultTextColor = input.defaultTextColor;
  }

  if (isFooterWidgetColor(input.defaultIconColor)) {
    out.defaultIconColor = input.defaultIconColor;
  }

  const widgetsRaw = input.widgets;
  if (widgetsRaw && typeof widgetsRaw === "object" && !Array.isArray(widgetsRaw)) {
    for (const [id, widgetValue] of Object.entries(widgetsRaw as Record<string, unknown>)) {
      if (!isFooterWidgetId(id)) continue;
      const coerced = coerceFooterWidgetOverride(widgetValue);
      if (coerced) out.widgets[id] = coerced;
    }
  }

  return out;
}

export function getFooterConfigPath(): string {
  return join(getAgentDir(), FOOTER_CONFIG_FILE);
}

export function loadFooterConfig(): FooterConfigSnapshot {
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
  };
}

export function cloneFooterConfig(config: FooterConfigSnapshot): FooterConfigSnapshot {
  const widgets: Partial<Record<FooterWidgetId, FooterWidgetConfigOverride>> = {};
  for (const widgetId of FOOTER_WIDGET_IDS) {
    const override = config.widgets[widgetId];
    if (!override) continue;
    widgets[widgetId] = cloneFooterWidgetOverride(override);
  }

  return {
    refreshMs: config.refreshMs,
    showPiBanner: config.showPiBanner,
    defaultTextColor: config.defaultTextColor,
    defaultIconColor: config.defaultIconColor,
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
  const outWidgets: Partial<Record<FooterWidgetId, FooterWidgetConfigOverride>> = {};

  for (const widgetId of FOOTER_WIDGET_IDS) {
    const override = config.widgets[widgetId];
    if (isEmptyWidgetOverride(override)) continue;
    outWidgets[widgetId] = cloneFooterWidgetOverride(override);
  }

  const out: Record<string, unknown> = {
    refreshMs: clampInt(config.refreshMs, MIN_FOOTER_REFRESH_MS, MAX_FOOTER_REFRESH_MS),
    showPiBanner: config.showPiBanner,
    defaultTextColor: config.defaultTextColor,
    defaultIconColor: config.defaultIconColor,
  };

  if (Object.keys(outWidgets).length > 0) {
    out.widgets = outWidgets;
  }

  return out;
}

export function writeFooterConfigSnapshot(config: FooterConfigSnapshot): void {
  writeFooterConfigFile(`${JSON.stringify(toFooterConfigObject(config), null, 2)}\n`);
}

function getWidgetState(config: FooterConfigSnapshot, widgetId: FooterWidgetId): FooterWidgetState {
  const enabled = config.widgets[widgetId]?.enabled;
  if (enabled === true) return "enabled";
  if (enabled === false) return "disabled";
  return "default";
}

function updateWidgetOverride(
  config: FooterConfigSnapshot,
  widgetId: FooterWidgetId,
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

function setWidgetState(config: FooterConfigSnapshot, widgetId: FooterWidgetId, state: FooterWidgetState): void {
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
  widgetId: FooterWidgetId,
  key: "row" | "position" | "minWidth",
  value: string,
): void {
  updateWidgetOverride(config, widgetId, (override) => {
    if (value === "default") {
      delete override[key];
      return;
    }

    const max = key === "row"
      ? MAX_WIDGET_ROW
      : key === "position"
        ? MAX_WIDGET_POSITION
        : MAX_WIDGET_MIN_WIDTH;

    const n = toBoundedNonNegativeInt(value, max);
    if (n === undefined) return;
    override[key] = n;
  });
}

function setWidgetAlignOverride(config: FooterConfigSnapshot, widgetId: FooterWidgetId, value: string): void {
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

function setWidgetFillOverride(config: FooterConfigSnapshot, widgetId: FooterWidgetId, value: string): void {
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

function getWidgetIconMode(config: FooterConfigSnapshot, widgetId: FooterWidgetId): FooterWidgetIconMode {
  const iconOverride = config.widgets[widgetId]?.icon;
  if (iconOverride === "show" || iconOverride === "hide") return iconOverride;
  return "default";
}

function setWidgetIconMode(config: FooterConfigSnapshot, widgetId: FooterWidgetId, value: string): void {
  if (value !== "default" && value !== "show" && value !== "hide") return;

  updateWidgetOverride(config, widgetId, (override) => {
    if (value === "default") {
      delete override.icon;
      return;
    }
    override.icon = value;
  });
}

function getWidgetIconColorValue(config: FooterConfigSnapshot, widgetId: FooterWidgetId): string {
  return config.widgets[widgetId]?.iconColor ?? "default";
}

function setWidgetIconColor(config: FooterConfigSnapshot, widgetId: FooterWidgetId, value: string): void {
  updateWidgetOverride(config, widgetId, (override) => {
    if (value === "default") {
      delete override.iconColor;
      return;
    }

    if (!isFooterWidgetColor(value)) return;
    override.iconColor = value;
  });
}

function getWidgetTextColorValue(config: FooterConfigSnapshot, widgetId: FooterWidgetId): string {
  return config.widgets[widgetId]?.textColor ?? "default";
}

function setWidgetTextColor(config: FooterConfigSnapshot, widgetId: FooterWidgetId, value: string): void {
  updateWidgetOverride(config, widgetId, (override) => {
    if (value === "default") {
      delete override.textColor;
      return;
    }

    if (!isFooterWidgetColor(value)) return;
    override.textColor = value;
  });
}

function asOptionValues(base: readonly number[], currentValue: number | undefined): string[] {
  const values = new Set(base.map((n) => String(n)));
  if (currentValue !== undefined) values.add(String(currentValue));
  return ["default", ...Array.from(values).sort((a, b) => Number(a) - Number(b))];
}

export function widgetSummary(config: FooterConfigSnapshot, widgetId: FooterWidgetId): string {
  const defaults = FOOTER_WIDGET_META[widgetId].defaults;

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

  if (override.icon === "hide") {
    parts.push("icon:off");
  } else if (override.icon === "show") {
    parts.push("icon:on");
  }

  if (override.iconColor !== undefined) {
    parts.push(`icon:${override.iconColor}`);
  }

  if (override.textColor !== undefined) {
    parts.push(`text:${override.textColor}`);
  }

  if (override.fill !== undefined) parts.push(`fill:${override.fill}`);
  if (override.minWidth !== undefined) parts.push(`w:${override.minWidth}`);

  return parts.join(" ");
}

function widgetDescription(widgetId: FooterWidgetId): string {
  return FOOTER_WIDGET_META[widgetId].description;
}

function widgetSettingLabel(widgetId: FooterWidgetId, theme: Theme, config: FooterConfigSnapshot): string {
  const icon = FOOTER_WIDGET_META[widgetId].settingIcon;

  const iconMode = getWidgetIconMode(config, widgetId);
  if (iconMode === "hide") {
    return `${theme.fg("dim", icon)} ${widgetId}`;
  }

  const configuredIconColor = getWidgetIconColorValue(config, widgetId);
  const resolvedColor = isFooterWidgetColor(configuredIconColor)
    ? configuredIconColor
    : config.defaultIconColor;

  return `${theme.fg(resolvedColor, icon)} ${widgetId}`;
}

function widgetSettingsItems(config: FooterConfigSnapshot, widgetId: FooterWidgetId): SettingItem[] {
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
      id: "textColor",
      label: "text color",
      currentValue: getWidgetTextColorValue(config, widgetId),
      values: ["default", ...FOOTER_WIDGET_COLORS],
      description: "Color used for this widget text",
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
  widgetId: FooterWidgetId,
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
        } else if (fieldId === "textColor") {
          setWidgetTextColor(draft, widgetId, newValue);
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

export function rootFooterSettingsItems(
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
    {
      id: "showPiBanner",
      label: "show π banner",
      currentValue: draft.showPiBanner ? "on" : "off",
      values: ["on", "off"],
      description: "Show rainbow pi banner in the header.",
    },
    {
      id: "defaultTextColor",
      label: "default text color",
      currentValue: draft.defaultTextColor,
      values: [...FOOTER_WIDGET_COLORS],
      description: "Global text color default for all widgets. Per-widget textColor overrides still win.",
    },
    {
      id: "defaultIconColor",
      label: "default icon color",
      currentValue: draft.defaultIconColor,
      values: [...FOOTER_WIDGET_COLORS],
      description: "Global icon color default for all widgets. Per-widget iconColor overrides still win.",
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

export function coerceRefreshMs(value: string): number | undefined {
  const refreshMs = toBoundedNonNegativeInt(value, MAX_FOOTER_REFRESH_MS);
  if (refreshMs === undefined) return undefined;
  return Math.max(MIN_FOOTER_REFRESH_MS, refreshMs);
}

export function coerceWidgetColor(value: string): FooterWidgetColor | undefined {
  if (!isFooterWidgetColor(value)) return undefined;
  return value;
}
