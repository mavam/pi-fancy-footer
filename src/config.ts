import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import {
  getAgentDir,
  getSettingsListTheme,
  type Theme,
} from "@mariozechner/pi-coding-agent";
import {
  Container,
  type SettingItem,
  SettingsList,
  Text,
} from "@mariozechner/pi-tui";
import {
  CONTEXT_BAR_STYLES,
  DEFAULT_COMPACTION_SETTINGS,
  DEFAULT_FOOTER_CONFIG,
  FOOTER_CONFIG_FILE,
  FOOTER_ICON_FAMILIES,
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
  type BuiltInFooterWidgetId,
  type CompactionSettingsSnapshot,
  type FancyFooterWidgetContribution,
  type FooterConfigSnapshot,
  type FooterWidgetAlign,
  type FooterWidgetColor,
  type FooterWidgetConfigOverride,
  type FooterWidgetFill,
  clampInt,
  getDefaultWidgetIcon,
  isFooterWidgetAlign,
  isFooterWidgetColor,
  isFooterWidgetFill,
  resolveFancyFooterWidgetIcon,
  toBoundedNonNegativeInt,
  widgetSummary,
} from "./shared.ts";

const literalUnion = (values: readonly string[]) =>
  Type.Union(values.map((value) => Type.Literal(value)));

const footerWidgetColorSchema = literalUnion(FOOTER_WIDGET_COLORS);
const footerIconFamilySchema = literalUnion(FOOTER_ICON_FAMILIES);
const contextBarStyleSchema = literalUnion(
  CONTEXT_BAR_STYLES.map((style) => style.label),
);
const footerWidgetAlignSchema = literalUnion(["left", "middle", "right"]);
const footerWidgetFillSchema = literalUnion(["none", "grow"]);
const footerWidgetIconModeSchema = literalUnion(["default", "hide"]);

const footerWidgetConfigOverrideSchema = Type.Object(
  {
    enabled: Type.Optional(Type.Boolean()),
    row: Type.Optional(Type.Integer({ minimum: 0, maximum: MAX_WIDGET_ROW })),
    position: Type.Optional(
      Type.Integer({ minimum: 0, maximum: MAX_WIDGET_POSITION }),
    ),
    align: Type.Optional(footerWidgetAlignSchema),
    fill: Type.Optional(footerWidgetFillSchema),
    minWidth: Type.Optional(
      Type.Integer({ minimum: 0, maximum: MAX_WIDGET_MIN_WIDTH }),
    ),
    icon: Type.Optional(footerWidgetIconModeSchema),
    iconColor: Type.Optional(footerWidgetColorSchema),
    textColor: Type.Optional(footerWidgetColorSchema),
  },
  { additionalProperties: false },
);

const footerConfigFileSchema = Type.Object(
  {
    refreshMs: Type.Optional(
      Type.Integer({
        minimum: MIN_FOOTER_REFRESH_MS,
        maximum: MAX_FOOTER_REFRESH_MS,
      }),
    ),
    iconFamily: Type.Optional(footerIconFamilySchema),
    contextBarStyle: Type.Optional(contextBarStyleSchema),
    defaultTextColor: Type.Optional(footerWidgetColorSchema),
    defaultIconColor: Type.Optional(footerWidgetColorSchema),
    widgets: Type.Optional(
      Type.Object(
        Object.fromEntries(
          FOOTER_WIDGET_IDS.map((widgetId) => [
            widgetId,
            Type.Optional(footerWidgetConfigOverrideSchema),
          ]),
        ),
        { additionalProperties: false },
      ),
    ),
    extensionWidgets: Type.Optional(
      Type.Record(
        Type.String({ minLength: 1 }),
        footerWidgetConfigOverrideSchema,
      ),
    ),
  },
  { additionalProperties: false },
);

const validateFooterConfigFile = Compile(footerConfigFileSchema);
let lastFooterConfigError: string | undefined;

export type FooterConfigSectionId = "generic" | "widgets" | "extension-widgets";

export interface FooterConfigSection {
  id: FooterConfigSectionId;
  title: string;
  items: SettingItem[];
}

type WidgetConfigBucket = "widgets" | "extensionWidgets";

interface ConfigurableWidgetMeta {
  id: string;
  label: string;
  description: string;
  defaults: {
    row: number;
    position: number;
    align: FooterWidgetAlign;
    fill: FooterWidgetFill;
    minWidth?: number;
  };
  defaultIcon?: { text: string; color: FooterWidgetColor };
  bucket: WidgetConfigBucket;
  section: Extract<FooterConfigSectionId, "widgets" | "extension-widgets">;
  builtInId?: BuiltInFooterWidgetId;
}

function parseJsonFile(filePath: string): unknown | undefined {
  if (!existsSync(filePath)) return undefined;
  const content = readFileSync(filePath, "utf8");
  try {
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`Failed to parse ${filePath}: ${error}`);
  }
}

function defaultFooterConfig(): FooterConfigSnapshot {
  return structuredClone(DEFAULT_FOOTER_CONFIG);
}

function pruneWidgetOverrides(
  overrides: Record<string, FooterWidgetConfigOverride> | undefined,
): Record<string, FooterWidgetConfigOverride> {
  if (!overrides) return {};

  const pruned: Record<string, FooterWidgetConfigOverride> = {};
  for (const [widgetId, override] of Object.entries(overrides)) {
    if (!override || Object.keys(override).length === 0) continue;
    pruned[widgetId] = structuredClone(override);
  }
  return pruned;
}

function parseFooterConfig(
  filePath: string,
  value: unknown,
): FooterConfigSnapshot {
  if (value === undefined) return defaultFooterConfig();

  if (!validateFooterConfigFile.Check(value)) {
    const errors = Array.from(validateFooterConfigFile.Errors(value))
      .map((error) => `  - ${error.path || "/"}: ${error.message}`)
      .join("\n");
    throw new Error(`Invalid ${filePath}:\n${errors}`);
  }

  const input = value as FooterConfigSnapshot;
  return {
    refreshMs: input.refreshMs ?? DEFAULT_FOOTER_CONFIG.refreshMs,
    iconFamily: input.iconFamily ?? DEFAULT_FOOTER_CONFIG.iconFamily,
    contextBarStyle:
      input.contextBarStyle ?? DEFAULT_FOOTER_CONFIG.contextBarStyle,
    defaultTextColor:
      input.defaultTextColor ?? DEFAULT_FOOTER_CONFIG.defaultTextColor,
    defaultIconColor:
      input.defaultIconColor ?? DEFAULT_FOOTER_CONFIG.defaultIconColor,
    widgets: pruneWidgetOverrides(
      input.widgets as Record<string, FooterWidgetConfigOverride> | undefined,
    ) as Partial<Record<BuiltInFooterWidgetId, FooterWidgetConfigOverride>>,
    extensionWidgets: pruneWidgetOverrides(input.extensionWidgets),
  };
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
    enabled:
      typeof settings.enabled === "boolean"
        ? settings.enabled
        : fallback.enabled,
    reserveTokens: Number.isFinite(reserveRaw)
      ? Math.max(0, Math.floor(reserveRaw))
      : fallback.reserveTokens,
    keepRecentTokens: Number.isFinite(keepRecentRaw)
      ? Math.max(0, Math.floor(keepRecentRaw))
      : fallback.keepRecentTokens,
  };
}

export function loadCompactionSettings(
  cwd: string,
): CompactionSettingsSnapshot {
  let resolved = { ...DEFAULT_COMPACTION_SETTINGS };

  for (const filePath of [
    join(getAgentDir(), "settings.json"),
    join(cwd, ".pi", "settings.json"),
  ]) {
    try {
      const value = parseJsonFile(filePath);
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        continue;
      }
      const settings = value as Record<string, unknown>;
      if (settings.compaction !== undefined) {
        resolved = coerceCompactionSettings(settings.compaction, resolved);
      }
    } catch {
      // Ignore unrelated settings parsing failures.
    }
  }

  return resolved;
}

export function getFooterConfigPath(): string {
  return join(getAgentDir(), FOOTER_CONFIG_FILE);
}

export function loadFooterConfig(): FooterConfigSnapshot {
  const configPath = getFooterConfigPath();

  try {
    const config = parseJsonFile(configPath);
    const parsed = parseFooterConfig(configPath, config);
    lastFooterConfigError = undefined;
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message !== lastFooterConfigError) {
      console.warn(message);
      lastFooterConfigError = message;
    }
    return defaultFooterConfig();
  }
}

function writeFooterConfigFile(content: string): void {
  mkdirSync(getAgentDir(), { recursive: true });
  writeFileSync(getFooterConfigPath(), content, "utf8");
}

export function cloneFooterConfig(
  config: FooterConfigSnapshot,
): FooterConfigSnapshot {
  return structuredClone(config);
}

function isEmptyWidgetOverride(
  override: FooterWidgetConfigOverride | undefined,
): boolean {
  if (!override) return true;
  for (const value of Object.values(override)) {
    if (value !== undefined) return false;
  }
  return true;
}

function toFooterConfigObject(
  config: FooterConfigSnapshot,
): Record<string, unknown> {
  const widgets: Partial<
    Record<BuiltInFooterWidgetId, FooterWidgetConfigOverride>
  > = {};
  for (const widgetId of FOOTER_WIDGET_IDS) {
    const override = config.widgets[widgetId];
    if (isEmptyWidgetOverride(override)) continue;
    widgets[widgetId] = structuredClone(override);
  }

  const extensionWidgets: Record<string, FooterWidgetConfigOverride> = {};
  for (const [widgetId, override] of Object.entries(config.extensionWidgets)) {
    if (isEmptyWidgetOverride(override)) continue;
    extensionWidgets[widgetId] = structuredClone(override);
  }

  const out: Record<string, unknown> = {
    refreshMs: clampInt(
      config.refreshMs,
      MIN_FOOTER_REFRESH_MS,
      MAX_FOOTER_REFRESH_MS,
    ),
    iconFamily: config.iconFamily,
    contextBarStyle: config.contextBarStyle,
    defaultTextColor: config.defaultTextColor,
    defaultIconColor: config.defaultIconColor,
  };

  if (Object.keys(widgets).length > 0) out.widgets = widgets;
  if (Object.keys(extensionWidgets).length > 0) {
    out.extensionWidgets = extensionWidgets;
  }

  return out;
}

export function writeFooterConfigSnapshot(config: FooterConfigSnapshot): void {
  writeFooterConfigFile(
    `${JSON.stringify(toFooterConfigObject(config), null, 2)}\n`,
  );
}

function getWidgetOverride(
  config: FooterConfigSnapshot,
  widget: ConfigurableWidgetMeta,
): FooterWidgetConfigOverride | undefined {
  return widget.bucket === "widgets"
    ? config.widgets[widget.id as BuiltInFooterWidgetId]
    : config.extensionWidgets[widget.id];
}

function updateWidgetOverride(
  config: FooterConfigSnapshot,
  widget: ConfigurableWidgetMeta,
  mutate: (override: FooterWidgetConfigOverride) => void,
): void {
  const target =
    widget.bucket === "widgets"
      ? (config.widgets as Record<string, FooterWidgetConfigOverride>)
      : config.extensionWidgets;
  const override = structuredClone(target[widget.id] ?? {});
  mutate(override);

  if (isEmptyWidgetOverride(override)) {
    delete target[widget.id];
  } else {
    target[widget.id] = override;
  }
}

function summarizeExtensionWidgetOverride(
  config: FooterConfigSnapshot,
  widget: ConfigurableWidgetMeta,
): string {
  const override = config.extensionWidgets[widget.id];
  if (!override) return "default";

  const parts: string[] = [];
  if (override.enabled === true) parts.push("on");
  if (override.enabled === false) parts.push("off");
  if (override.row !== undefined && override.row !== widget.defaults.row) {
    parts.push(`row:${override.row}`);
  }
  if (
    override.position !== undefined &&
    override.position !== widget.defaults.position
  ) {
    parts.push(`pos:${override.position}`);
  }
  if (
    override.align !== undefined &&
    override.align !== widget.defaults.align
  ) {
    parts.push(`align:${override.align}`);
  }
  if (override.fill !== undefined && override.fill !== widget.defaults.fill) {
    parts.push(`fill:${override.fill}`);
  }
  if (
    override.minWidth !== undefined &&
    override.minWidth !== widget.defaults.minWidth
  ) {
    parts.push(`width:${override.minWidth}`);
  }
  if (widget.defaultIcon && override.icon === "hide") parts.push("icon:hidden");
  if (
    widget.defaultIcon &&
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

  return parts.length > 0 ? parts.join(" ") : "default";
}

export { widgetSummary } from "./shared.ts";

function summarizeWidget(
  config: FooterConfigSnapshot,
  widget: ConfigurableWidgetMeta,
): string {
  return widget.builtInId
    ? widgetSummary(config, widget.builtInId)
    : summarizeExtensionWidgetOverride(config, widget);
}

function buildConfigurableWidgets(
  config: FooterConfigSnapshot,
  extensionWidgets: readonly FancyFooterWidgetContribution[],
): ConfigurableWidgetMeta[] {
  return [
    ...FOOTER_WIDGET_IDS.map((widgetId) => ({
      id: widgetId,
      label: widgetId,
      description: FOOTER_WIDGET_META[widgetId].description,
      defaults: FOOTER_WIDGET_META[widgetId].defaults,
      defaultIcon: getDefaultWidgetIcon(widgetId, config.iconFamily),
      bucket: "widgets" as const,
      section: "widgets" as const,
      builtInId: widgetId,
    })),
    ...extensionWidgets.map((widget) => ({
      id: widget.id,
      label: widget.label ?? widget.id,
      description: widget.description,
      defaults: widget.defaults,
      defaultIcon: resolveFancyFooterWidgetIcon(widget.icon, config.iconFamily),
      bucket: "extensionWidgets" as const,
      section: "extension-widgets" as const,
    })),
  ];
}

function widgetLabel(
  config: FooterConfigSnapshot,
  widget: ConfigurableWidgetMeta,
  theme: Theme,
): string {
  const icon = widget.defaultIcon?.text ?? "◌";
  const override = getWidgetOverride(config, widget);
  if (override?.icon === "hide") {
    return `${theme.fg("dim", icon)} ${widget.label}`;
  }

  const iconColor =
    widget.defaultIcon && override?.iconColor !== undefined
      ? override.iconColor
      : config.defaultIconColor;
  return `${theme.fg(iconColor, icon)} ${widget.label}`;
}

function applyWidgetField(
  config: FooterConfigSnapshot,
  widget: ConfigurableWidgetMeta,
  fieldId: string,
  newValue: string,
): void {
  updateWidgetOverride(config, widget, (override) => {
    switch (fieldId) {
      case "enabled":
        if (newValue === "default") delete override.enabled;
        else if (newValue === "enabled") override.enabled = true;
        else if (newValue === "disabled") override.enabled = false;
        break;
      case "icon":
        if (newValue === "default") delete override.icon;
        else if (newValue === "hide") override.icon = "hide";
        break;
      case "iconColor":
      case "textColor":
        if (newValue === "default") {
          delete override[fieldId];
        } else if (isFooterWidgetColor(newValue)) {
          override[fieldId] = newValue;
        }
        break;
      case "align":
        if (newValue === "default") delete override.align;
        else if (isFooterWidgetAlign(newValue)) override.align = newValue;
        break;
      case "fill":
        if (newValue === "default") delete override.fill;
        else if (isFooterWidgetFill(newValue)) override.fill = newValue;
        break;
      case "row":
      case "position":
      case "minWidth": {
        if (newValue === "default") {
          delete override[fieldId];
          break;
        }
        const max =
          fieldId === "row"
            ? MAX_WIDGET_ROW
            : fieldId === "position"
              ? MAX_WIDGET_POSITION
              : MAX_WIDGET_MIN_WIDTH;
        const parsed = toBoundedNonNegativeInt(newValue, max);
        if (parsed !== undefined) override[fieldId] = parsed;
        break;
      }
    }
  });
}

function optionValues(
  base: readonly number[],
  currentValue: number | undefined,
): string[] {
  const values = new Set(base.map((value) => String(value)));
  if (currentValue !== undefined) values.add(String(currentValue));
  return [
    "default",
    ...Array.from(values).sort((a, b) => Number(a) - Number(b)),
  ];
}

function widgetSettingsItems(
  config: FooterConfigSnapshot,
  widget: ConfigurableWidgetMeta,
): SettingItem[] {
  const override = getWidgetOverride(config, widget);

  return [
    {
      id: "enabled",
      label: "visibility",
      currentValue:
        override?.enabled === true
          ? "enabled"
          : override?.enabled === false
            ? "disabled"
            : "default",
      values: ["default", "enabled", "disabled"],
      description:
        "Choose whether this widget follows its normal behavior, always shows, or stays hidden.",
    },
    {
      id: "icon",
      label: "icon",
      currentValue: override?.icon === "hide" ? "hide" : "default",
      values: ["default", "hide"],
      description: widget.defaultIcon
        ? `Use the default ${config.iconFamily} icon: ${widget.defaultIcon.text}`
        : "This widget doesn't have a built-in icon.",
    },
    {
      id: "iconColor",
      label: "icon color",
      currentValue: override?.iconColor ?? "default",
      values: ["default", ...FOOTER_WIDGET_COLORS],
      description: "Choose the icon color when the icon is visible.",
    },
    {
      id: "textColor",
      label: "text color",
      currentValue: override?.textColor ?? "default",
      values: ["default", ...FOOTER_WIDGET_COLORS],
      description: "Choose the text color for this widget.",
    },
    {
      id: "row",
      label: "row",
      currentValue:
        override?.row !== undefined ? String(override.row) : "default",
      values: optionValues(FOOTER_ROW_OPTIONS, override?.row),
      description: "Move this widget to a different row.",
    },
    {
      id: "position",
      label: "position",
      currentValue:
        override?.position !== undefined
          ? String(override.position)
          : "default",
      values: optionValues(FOOTER_POSITION_OPTIONS, override?.position),
      description:
        "Change where this widget appears within its alignment group on that row.",
    },
    {
      id: "align",
      label: "align",
      currentValue: override?.align ?? "default",
      values: ["default", "left", "middle", "right"],
      description:
        "Place this widget on the left, middle, or right side of the row.",
    },
    {
      id: "fill",
      label: "fill",
      currentValue: override?.fill ?? "default",
      values: ["default", "none", "grow"],
      description: "Let this widget grow to use extra horizontal space.",
    },
    {
      id: "minWidth",
      label: "min width",
      currentValue:
        override?.minWidth !== undefined
          ? String(override.minWidth)
          : "default",
      values: optionValues(FOOTER_MIN_WIDTH_OPTIONS, override?.minWidth),
      description: "Reserve at least this much width for the widget.",
    },
  ];
}

function widgetSettingsSubmenu(
  draft: FooterConfigSnapshot,
  theme: Theme,
  widget: ConfigurableWidgetMeta,
  applyDraft: () => void,
) {
  return (_currentValue: string, done: (selectedValue?: string) => void) => {
    const submenuItems = widgetSettingsItems(draft, widget);
    const container = new Container();
    container.addChild(
      new Text(
        theme.fg(
          "accent",
          theme.bold(`Widget: ${widgetLabel(draft, widget, theme)}`),
        ),
        1,
        0,
      ),
    );
    container.addChild(
      new Text(
        theme.fg("dim", "Change this widget's layout and appearance"),
        1,
        0,
      ),
    );

    const settings = new SettingsList(
      submenuItems,
      Math.min(submenuItems.length + 2, 14),
      getSettingsListTheme(),
      (fieldId, newValue) => {
        applyWidgetField(draft, widget, fieldId, newValue);
        applyDraft();
      },
      () => {
        done(summarizeWidget(draft, widget));
      },
    );

    container.addChild(settings);
    container.addChild(
      new Text(
        theme.fg("dim", "↑↓ navigate • enter/space change • esc back"),
        1,
        0,
      ),
    );

    return {
      render(width: number) {
        return container.render(width);
      },
      invalidate() {
        container.invalidate();
      },
      handleInput(data: string) {
        settings.handleInput?.(data);
      },
    };
  };
}

function genericFooterSettingsItems(
  draft: FooterConfigSnapshot,
): SettingItem[] {
  const refreshValues = Array.from(
    new Set([
      String(draft.refreshMs),
      ...FOOTER_REFRESH_OPTIONS.map((value) => String(value)),
    ]),
  ).sort((a, b) => Number(a) - Number(b));

  return [
    {
      id: "refreshMs",
      label: "refresh interval (ms)",
      currentValue: String(draft.refreshMs),
      values: refreshValues,
      description:
        "Choose how often the footer refreshes. Lower values update faster. Higher values reduce background Git calls.",
    },
    {
      id: "iconFamily",
      label: "icon family",
      currentValue: draft.iconFamily,
      values: [...FOOTER_ICON_FAMILIES],
      description:
        "Choose the icon style used across the footer and this configuration screen.",
    },
    {
      id: "contextBarStyle",
      label: "context bar style",
      currentValue: draft.contextBarStyle,
      values: CONTEXT_BAR_STYLES.map((style) => style.label),
      description:
        "Choose the character style for the context usage bar: " +
        CONTEXT_BAR_STYLES.map((style, index) => {
          const sample = `${style.label} ${style.used}${style.free}${style.reserved}`;
          return index === CONTEXT_BAR_STYLES.length - 1
            ? `or ${sample}`
            : sample;
        }).join(", ") +
        ".",
    },
    {
      id: "defaultTextColor",
      label: "default text color",
      currentValue: draft.defaultTextColor,
      values: [...FOOTER_WIDGET_COLORS],
      description:
        "Choose the default text color for widgets. You can still change individual widgets.",
    },
    {
      id: "defaultIconColor",
      label: "default icon color",
      currentValue: draft.defaultIconColor,
      values: [...FOOTER_WIDGET_COLORS],
      description:
        "Choose the default icon color for widgets. You can still change individual widgets.",
    },
  ];
}

export function createFooterConfigSections(
  draft: FooterConfigSnapshot,
  theme: Theme,
  applyDraft: () => void,
  extensionWidgets: readonly FancyFooterWidgetContribution[],
): FooterConfigSection[] {
  const widgets = buildConfigurableWidgets(draft, extensionWidgets);

  const widgetItems = (
    section: ConfigurableWidgetMeta["section"],
  ): SettingItem[] =>
    widgets
      .filter((widget) => widget.section === section)
      .map((widget) => ({
        id: `${section}:${widget.id}`,
        label: widgetLabel(draft, widget, theme),
        currentValue: summarizeWidget(draft, widget),
        description: widget.description,
        submenu: widgetSettingsSubmenu(draft, theme, widget, applyDraft),
      }));

  const sections: FooterConfigSection[] = [
    {
      id: "generic",
      title: "General",
      items: genericFooterSettingsItems(draft),
    },
    {
      id: "widgets",
      title: "Built-in widgets",
      items: widgetItems("widgets"),
    },
  ];

  const extensionItems = widgetItems("extension-widgets");
  if (extensionItems.length > 0) {
    sections.push({
      id: "extension-widgets",
      title: "Extension widgets",
      items: extensionItems,
    });
  }

  return sections;
}
