import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
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
  DEFAULT_COMPACTION_SETTINGS,
  CONTEXT_BAR_STYLE_IDS,
  CONTEXT_BAR_STYLES,
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
  type CompactionSettingsSnapshot,
  type BuiltInFooterWidgetId,
  type ContextBarStyleId,
  type FancyFooterWidgetContribution,
  type FooterConfigSnapshot,
  type FooterIconFamily,
  type FooterWidgetAlign,
  type FooterWidgetColor,
  type FooterWidgetConfigOverride,
  type FooterWidgetFill,
  type FooterWidgetIconMode,
  type FooterWidgetState,
  clampInt,
  getContextBarStyle,
  getDefaultWidgetIcon,
  resolveFancyFooterWidgetIcon,
  isContextBarStyleId,
  isFooterIconFamily,
  isFooterWidgetAlign,
  isFooterWidgetColor,
  isFooterWidgetFill,
  toBoundedNonNegativeInt,
  widgetSummary,
} from "./shared.ts";

const footerWidgetColorSchema = Type.Union(
  FOOTER_WIDGET_COLORS.map((value) => Type.Literal(value)),
);
const footerIconFamilySchema = Type.Union(
  FOOTER_ICON_FAMILIES.map((value) => Type.Literal(value)),
);
const contextBarStyleSchema = Type.Union(
  CONTEXT_BAR_STYLE_IDS.map((value) => Type.Literal(value)),
);
const footerWidgetAlignSchema = Type.Union([
  Type.Literal("left"),
  Type.Literal("middle"),
  Type.Literal("right"),
]);
const footerWidgetFillSchema = Type.Union([
  Type.Literal("none"),
  Type.Literal("grow"),
]);
const footerWidgetIconModeSchema = Type.Union([
  Type.Literal("default"),
  Type.Literal("hide"),
]);

const FooterWidgetConfigOverrideSchema = Type.Object(
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

const FooterConfigFileSchema = Type.Object(
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
            Type.Optional(FooterWidgetConfigOverrideSchema),
          ]),
        ),
        { additionalProperties: false },
      ),
    ),
    extensionWidgets: Type.Optional(
      Type.Record(
        Type.String({ minLength: 1 }),
        FooterWidgetConfigOverrideSchema,
      ),
    ),
  },
  { additionalProperties: false },
);

const validateFooterConfigFile = TypeCompiler.Compile(FooterConfigFileSchema);
let lastFooterConfigError: string | undefined;

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
  let globalSettings: Record<string, unknown> | undefined;
  let projectSettings: Record<string, unknown> | undefined;

  try {
    const globalValue = parseJsonFile(join(getAgentDir(), "settings.json"));
    if (
      globalValue &&
      typeof globalValue === "object" &&
      !Array.isArray(globalValue)
    ) {
      globalSettings = globalValue as Record<string, unknown>;
    }
  } catch {
    globalSettings = undefined;
  }

  try {
    const projectValue = parseJsonFile(join(cwd, ".pi", "settings.json"));
    if (
      projectValue &&
      typeof projectValue === "object" &&
      !Array.isArray(projectValue)
    ) {
      projectSettings = projectValue as Record<string, unknown>;
    }
  } catch {
    projectSettings = undefined;
  }

  let resolved = { ...DEFAULT_COMPACTION_SETTINGS };
  if (globalSettings?.compaction !== undefined) {
    resolved = coerceCompactionSettings(globalSettings.compaction, resolved);
  }
  if (projectSettings?.compaction !== undefined) {
    resolved = coerceCompactionSettings(projectSettings.compaction, resolved);
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
  const outWidgets: Partial<
    Record<BuiltInFooterWidgetId, FooterWidgetConfigOverride>
  > = {};

  for (const widgetId of FOOTER_WIDGET_IDS) {
    const override = config.widgets[widgetId];
    if (isEmptyWidgetOverride(override)) continue;
    outWidgets[widgetId] = structuredClone(override);
  }

  const outExtensionWidgets: Record<string, FooterWidgetConfigOverride> = {};
  for (const [widgetId, override] of Object.entries(config.extensionWidgets)) {
    if (isEmptyWidgetOverride(override)) continue;
    outExtensionWidgets[widgetId] = structuredClone(override);
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

  if (Object.keys(outWidgets).length > 0) {
    out.widgets = outWidgets;
  }
  if (Object.keys(outExtensionWidgets).length > 0) {
    out.extensionWidgets = outExtensionWidgets;
  }

  return out;
}

export function writeFooterConfigSnapshot(config: FooterConfigSnapshot): void {
  writeFooterConfigFile(
    `${JSON.stringify(toFooterConfigObject(config), null, 2)}\n`,
  );
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
}

function getWidgetOverrideBucket(
  config: FooterConfigSnapshot,
  bucket: WidgetConfigBucket,
): Record<string, FooterWidgetConfigOverride> {
  return bucket === "widgets"
    ? (config.widgets as Record<string, FooterWidgetConfigOverride>)
    : config.extensionWidgets;
}

function getWidgetState(
  config: FooterConfigSnapshot,
  bucket: WidgetConfigBucket,
  widgetId: string,
): FooterWidgetState {
  const enabled = getWidgetOverrideBucket(config, bucket)[widgetId]?.enabled;
  if (enabled === true) return "enabled";
  if (enabled === false) return "disabled";
  return "default";
}

function updateWidgetOverride(
  config: FooterConfigSnapshot,
  bucket: WidgetConfigBucket,
  widgetId: string,
  updater: (override: FooterWidgetConfigOverride) => void,
): void {
  const target = getWidgetOverrideBucket(config, bucket);
  const override = structuredClone(target[widgetId] ?? {});
  updater(override);

  if (isEmptyWidgetOverride(override)) {
    delete target[widgetId];
  } else {
    target[widgetId] = override;
  }
}

function setWidgetState(
  config: FooterConfigSnapshot,
  bucket: WidgetConfigBucket,
  widgetId: string,
  state: FooterWidgetState,
): void {
  updateWidgetOverride(config, bucket, widgetId, (override) => {
    if (state === "default") {
      delete override.enabled;
    } else {
      override.enabled = state === "enabled";
    }
  });
}

function setWidgetNumberOverride(
  config: FooterConfigSnapshot,
  bucket: WidgetConfigBucket,
  widgetId: string,
  key: "row" | "position" | "minWidth",
  value: string,
): void {
  updateWidgetOverride(config, bucket, widgetId, (override) => {
    if (value === "default") {
      delete override[key];
      return;
    }

    const max =
      key === "row"
        ? MAX_WIDGET_ROW
        : key === "position"
          ? MAX_WIDGET_POSITION
          : MAX_WIDGET_MIN_WIDTH;

    const n = toBoundedNonNegativeInt(value, max);
    if (n === undefined) return;
    override[key] = n;
  });
}

function setWidgetAlignOverride(
  config: FooterConfigSnapshot,
  bucket: WidgetConfigBucket,
  widgetId: string,
  value: string,
): void {
  updateWidgetOverride(config, bucket, widgetId, (override) => {
    if (value === "default") {
      delete override.align;
      return;
    }
    if (isFooterWidgetAlign(value)) {
      override.align = value;
    }
  });
}

function setWidgetFillOverride(
  config: FooterConfigSnapshot,
  bucket: WidgetConfigBucket,
  widgetId: string,
  value: string,
): void {
  updateWidgetOverride(config, bucket, widgetId, (override) => {
    if (value === "default") {
      delete override.fill;
      return;
    }
    if (isFooterWidgetFill(value)) {
      override.fill = value;
    }
  });
}

function getWidgetIconMode(
  config: FooterConfigSnapshot,
  bucket: WidgetConfigBucket,
  widgetId: string,
): FooterWidgetIconMode {
  return getWidgetOverrideBucket(config, bucket)[widgetId]?.icon === "hide"
    ? "hide"
    : "default";
}

function setWidgetIconMode(
  config: FooterConfigSnapshot,
  bucket: WidgetConfigBucket,
  widgetId: string,
  value: string,
): void {
  if (value !== "default" && value !== "hide") return;

  updateWidgetOverride(config, bucket, widgetId, (override) => {
    if (value === "default") {
      delete override.icon;
      return;
    }
    override.icon = value;
  });
}

function getWidgetIconColorValue(
  config: FooterConfigSnapshot,
  bucket: WidgetConfigBucket,
  widgetId: string,
): string {
  return (
    getWidgetOverrideBucket(config, bucket)[widgetId]?.iconColor ?? "default"
  );
}

function setWidgetIconColor(
  config: FooterConfigSnapshot,
  bucket: WidgetConfigBucket,
  widgetId: string,
  value: string,
): void {
  updateWidgetOverride(config, bucket, widgetId, (override) => {
    if (value === "default") {
      delete override.iconColor;
      return;
    }

    if (!isFooterWidgetColor(value)) return;
    override.iconColor = value;
  });
}

function getWidgetTextColorValue(
  config: FooterConfigSnapshot,
  bucket: WidgetConfigBucket,
  widgetId: string,
): string {
  return (
    getWidgetOverrideBucket(config, bucket)[widgetId]?.textColor ?? "default"
  );
}

function setWidgetTextColor(
  config: FooterConfigSnapshot,
  bucket: WidgetConfigBucket,
  widgetId: string,
  value: string,
): void {
  updateWidgetOverride(config, bucket, widgetId, (override) => {
    if (value === "default") {
      delete override.textColor;
      return;
    }

    if (!isFooterWidgetColor(value)) return;
    override.textColor = value;
  });
}

function asOptionValues(
  base: readonly number[],
  currentValue: number | undefined,
): string[] {
  const values = new Set(base.map((n) => String(n)));
  if (currentValue !== undefined) values.add(String(currentValue));
  return [
    "default",
    ...Array.from(values).sort((a, b) => Number(a) - Number(b)),
  ];
}

export { widgetSummary } from "./shared.ts";

function summarizeWidgetOverride(
  override: FooterWidgetConfigOverride | undefined,
  defaults: ConfigurableWidgetMeta["defaults"],
): string {
  if (!override) return "default";

  const parts: string[] = [];
  if (override.enabled === true) parts.push("on");
  if (override.enabled === false) parts.push("off");

  if (override.row !== undefined && override.row !== defaults.row) {
    parts.push(`row:${override.row}`);
  }
  if (
    override.position !== undefined &&
    override.position !== defaults.position
  ) {
    parts.push(`pos:${override.position}`);
  }
  if (override.align !== undefined && override.align !== defaults.align) {
    parts.push(`align:${override.align}`);
  }
  if (override.fill !== undefined && override.fill !== defaults.fill) {
    parts.push(`fill:${override.fill}`);
  }
  if (
    override.minWidth !== undefined &&
    override.minWidth !== defaults.minWidth
  ) {
    parts.push(`width:${override.minWidth}`);
  }
  if (override.icon === "hide") parts.push("icon:hidden");
  if (override.iconColor !== undefined)
    parts.push(`icon:${override.iconColor}`);
  if (override.textColor !== undefined)
    parts.push(`text:${override.textColor}`);

  return parts.length > 0 ? parts.join(" ") : "default";
}

function builtInWidgetMeta(
  widgetId: BuiltInFooterWidgetId,
  config: FooterConfigSnapshot,
): ConfigurableWidgetMeta {
  return {
    id: widgetId,
    label: widgetId,
    description: FOOTER_WIDGET_META[widgetId].description,
    defaults: FOOTER_WIDGET_META[widgetId].defaults,
    defaultIcon: getDefaultWidgetIcon(widgetId, config.iconFamily),
    bucket: "widgets",
  };
}

function extensionWidgetMeta(
  widget: FancyFooterWidgetContribution,
  config: FooterConfigSnapshot,
): ConfigurableWidgetMeta {
  return {
    id: widget.id,
    label: widget.label ?? widget.id,
    description: widget.description,
    defaults: widget.defaults,
    defaultIcon: resolveFancyFooterWidgetIcon(widget.icon, config.iconFamily),
    bucket: "extensionWidgets",
  };
}

function widgetSettingLabel(
  widget: ConfigurableWidgetMeta,
  theme: Theme,
  config: FooterConfigSnapshot,
): string {
  const icon = widget.defaultIcon?.text ?? "◌";
  const iconMode = getWidgetIconMode(config, widget.bucket, widget.id);
  if (iconMode === "hide") {
    return `${theme.fg("dim", icon)} ${widget.label}`;
  }

  const configuredIconColor = getWidgetIconColorValue(
    config,
    widget.bucket,
    widget.id,
  );
  const resolvedColor = isFooterWidgetColor(configuredIconColor)
    ? configuredIconColor
    : config.defaultIconColor;

  return `${theme.fg(resolvedColor, icon)} ${widget.label}`;
}

function widgetSettingsItems(
  config: FooterConfigSnapshot,
  widget: ConfigurableWidgetMeta,
): SettingItem[] {
  const override = getWidgetOverrideBucket(config, widget.bucket)[widget.id];
  const iconMode = getWidgetIconMode(config, widget.bucket, widget.id);

  return [
    {
      id: "enabled",
      label: "visibility",
      currentValue: getWidgetState(config, widget.bucket, widget.id),
      values: ["default", "enabled", "disabled"],
      description:
        "Choose whether this widget follows its normal behavior, always shows, or stays hidden.",
    },
    {
      id: "icon",
      label: "icon",
      currentValue: iconMode,
      values: ["default", "hide"],
      description: widget.defaultIcon
        ? `Use the default ${config.iconFamily} icon: ${widget.defaultIcon.text}`
        : "This widget doesn't have a built-in icon.",
    },
    {
      id: "iconColor",
      label: "icon color",
      currentValue: getWidgetIconColorValue(config, widget.bucket, widget.id),
      values: ["default", ...FOOTER_WIDGET_COLORS],
      description: "Choose the icon color when the icon is visible.",
    },
    {
      id: "textColor",
      label: "text color",
      currentValue: getWidgetTextColorValue(config, widget.bucket, widget.id),
      values: ["default", ...FOOTER_WIDGET_COLORS],
      description: "Choose the text color for this widget.",
    },
    {
      id: "row",
      label: "row",
      currentValue:
        override?.row !== undefined ? String(override.row) : "default",
      values: asOptionValues(FOOTER_ROW_OPTIONS, override?.row),
      description: "Move this widget to a different row.",
    },
    {
      id: "position",
      label: "position",
      currentValue:
        override?.position !== undefined
          ? String(override.position)
          : "default",
      values: asOptionValues(FOOTER_POSITION_OPTIONS, override?.position),
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
      values: asOptionValues(FOOTER_MIN_WIDTH_OPTIONS, override?.minWidth),
      description: "Reserve at least this much width for the widget.",
    },
  ];
}

function createWidgetSettingsSubmenu(
  draft: FooterConfigSnapshot,
  theme: Theme,
  widget: ConfigurableWidgetMeta,
  applyDraft: () => void,
) {
  return (_currentValue: string, done: (selectedValue?: string) => void) => {
    const submenuItems = widgetSettingsItems(draft, widget);

    const subContainer = new Container();
    subContainer.addChild(
      new Text(
        theme.fg(
          "accent",
          theme.bold(`Widget: ${widgetSettingLabel(widget, theme, draft)}`),
        ),
        1,
        0,
      ),
    );
    subContainer.addChild(
      new Text(
        theme.fg("dim", "Change this widget's layout and appearance"),
        1,
        0,
      ),
    );

    const subSettings = new SettingsList(
      submenuItems,
      Math.min(submenuItems.length + 2, 14),
      getSettingsListTheme(),
      (fieldId, newValue) => {
        if (
          fieldId === "enabled" &&
          (newValue === "default" ||
            newValue === "enabled" ||
            newValue === "disabled")
        ) {
          setWidgetState(draft, widget.bucket, widget.id, newValue);
        } else if (fieldId === "icon") {
          setWidgetIconMode(draft, widget.bucket, widget.id, newValue);
        } else if (fieldId === "iconColor") {
          setWidgetIconColor(draft, widget.bucket, widget.id, newValue);
        } else if (fieldId === "textColor") {
          setWidgetTextColor(draft, widget.bucket, widget.id, newValue);
        } else if (
          fieldId === "row" ||
          fieldId === "position" ||
          fieldId === "minWidth"
        ) {
          setWidgetNumberOverride(
            draft,
            widget.bucket,
            widget.id,
            fieldId,
            newValue,
          );
        } else if (fieldId === "align") {
          setWidgetAlignOverride(draft, widget.bucket, widget.id, newValue);
        } else if (fieldId === "fill") {
          setWidgetFillOverride(draft, widget.bucket, widget.id, newValue);
        }

        applyDraft();
      },
      () => {
        done(
          widget.bucket === "widgets"
            ? widgetSummary(draft, widget.id as BuiltInFooterWidgetId)
            : summarizeWidgetOverride(
                draft.extensionWidgets[widget.id],
                widget.defaults,
              ),
        );
      },
    );

    subContainer.addChild(subSettings);
    subContainer.addChild(
      new Text(
        theme.fg("dim", "↑↓ navigate • enter/space change • esc back"),
        1,
        0,
      ),
    );

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

function formatContextBarStyleValue(value: ContextBarStyleId): string {
  const style = getContextBarStyle(value);
  return `${style.label} ${style.used}${style.free}${style.reserved}`;
}

export function coerceContextBarStyleValue(
  value: string,
): ContextBarStyleId | undefined {
  if (isContextBarStyleId(value)) return value;

  for (const styleId of CONTEXT_BAR_STYLE_IDS) {
    if (formatContextBarStyleValue(styleId) === value) {
      return styleId;
    }
  }

  return undefined;
}

export function genericFooterSettingsItems(
  draft: FooterConfigSnapshot,
): SettingItem[] {
  const refreshValues = Array.from(
    new Set([
      String(draft.refreshMs),
      ...FOOTER_REFRESH_OPTIONS.map((n) => String(n)),
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
      currentValue: formatContextBarStyleValue(draft.contextBarStyle),
      values: CONTEXT_BAR_STYLE_IDS.map(formatContextBarStyleValue),
      description:
        "Choose the character style for the context usage bar: " +
        CONTEXT_BAR_STYLES.map((s, i) => {
          const repr = s.label + " " + s.used + s.free + s.reserved;
          return i === CONTEXT_BAR_STYLES.length - 1 ? "or " + repr : repr;
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

export function widgetFooterSettingsItems(
  draft: FooterConfigSnapshot,
  theme: Theme,
  applyDraft: () => void,
): SettingItem[] {
  return FOOTER_WIDGET_IDS.map((widgetId) => {
    const widget = builtInWidgetMeta(widgetId, draft);
    return {
      id: `widget:${widgetId}`,
      label: widgetSettingLabel(widget, theme, draft),
      currentValue: widgetSummary(draft, widgetId),
      description: widget.description,
      submenu: createWidgetSettingsSubmenu(draft, theme, widget, applyDraft),
    };
  });
}

export function extensionWidgetFooterSettingsItems(
  draft: FooterConfigSnapshot,
  theme: Theme,
  applyDraft: () => void,
  widgets: readonly FancyFooterWidgetContribution[],
): SettingItem[] {
  return widgets.map((widget) => {
    const meta = extensionWidgetMeta(widget, draft);
    return {
      id: `extension-widget:${widget.id}`,
      label: widgetSettingLabel(meta, theme, draft),
      currentValue: summarizeWidgetOverride(
        draft.extensionWidgets[widget.id],
        meta.defaults,
      ),
      description: meta.description,
      submenu: createWidgetSettingsSubmenu(draft, theme, meta, applyDraft),
    };
  });
}

export function rootFooterSettingsItems(
  draft: FooterConfigSnapshot,
  theme: Theme,
  applyDraft: () => void,
  extensionWidgets: readonly FancyFooterWidgetContribution[] = [],
): SettingItem[] {
  return [
    ...genericFooterSettingsItems(draft),
    ...widgetFooterSettingsItems(draft, theme, applyDraft),
    ...extensionWidgetFooterSettingsItems(
      draft,
      theme,
      applyDraft,
      extensionWidgets,
    ),
  ];
}

export function coerceRefreshMs(value: string): number | undefined {
  const refreshMs = toBoundedNonNegativeInt(value, MAX_FOOTER_REFRESH_MS);
  if (refreshMs === undefined) return undefined;
  return Math.max(MIN_FOOTER_REFRESH_MS, refreshMs);
}

export function coerceWidgetColor(
  value: string,
): FooterWidgetColor | undefined {
  if (!isFooterWidgetColor(value)) return undefined;
  return value;
}

export function coerceIconFamily(value: string): FooterIconFamily | undefined {
  if (!isFooterIconFamily(value)) return undefined;
  return value;
}
