import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import {
  getAgentDir,
  getSettingsListTheme,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  type SettingItem,
  SettingsList,
  Text,
} from "@earendil-works/pi-tui";
import {
  GAUGE_STYLES,
  getGaugeStyle,
  type GaugeStyleDef,
  DEFAULT_FOOTER_CONFIG,
  DEFAULT_PROVIDER_STATUS_CONFIG,
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
  MAX_PROVIDER_STATUS_CACHE_TTL_MS,
  MAX_PROVIDER_STATUS_REFRESH_MS,
  MAX_WIDGET_MIN_WIDTH,
  MAX_WIDGET_POSITION,
  MAX_WIDGET_ROW,
  MIN_FOOTER_REFRESH_MS,
  MIN_GAUGE_WIDTH,
  MAX_GAUGE_WIDTH,
  GAUGE_WIDTH_OPTIONS,
  DEFAULT_GAUGE_COLORS,
  MIN_PROVIDER_STATUS_CACHE_TTL_MS,
  MIN_PROVIDER_STATUS_REFRESH_MS,
  PROVIDER_STATUS_DISPLAYS,
  PROVIDER_STATUS_PROVIDER_IDS,
  type BuiltInFooterWidgetId,
  type NormalizedFancyFooterWidgetContribution,
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
const gaugeStyleSchema = literalUnion(
  GAUGE_STYLES.map((style) => style.label),
);
const footerWidgetAlignSchema = literalUnion(["left", "middle", "right"]);
const footerWidgetFillSchema = literalUnion(["none", "grow"]);
const footerWidgetIconModeSchema = literalUnion(["default", "hide"]);
const providerStatusProviderSchema = literalUnion(
  PROVIDER_STATUS_PROVIDER_IDS,
);
const providerStatusDisplaySchema = literalUnion(PROVIDER_STATUS_DISPLAYS);

const providerStatusConfigSchema = Type.Object(
  {
    refreshMs: Type.Optional(
      Type.Integer({
        minimum: MIN_PROVIDER_STATUS_REFRESH_MS,
        maximum: MAX_PROVIDER_STATUS_REFRESH_MS,
      }),
    ),
    cacheTtlMs: Type.Optional(
      Type.Integer({
        minimum: MIN_PROVIDER_STATUS_CACHE_TTL_MS,
        maximum: MAX_PROVIDER_STATUS_CACHE_TTL_MS,
      }),
    ),
    providers: Type.Optional(Type.Array(providerStatusProviderSchema)),
    display: Type.Optional(providerStatusDisplaySchema),
    showCredits: Type.Optional(Type.Boolean()),
    showReset: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

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
    gaugeStyle: Type.Optional(gaugeStyleSchema),
    gaugeWidth: Type.Optional(
      Type.Integer({ minimum: MIN_GAUGE_WIDTH, maximum: MAX_GAUGE_WIDTH }),
    ),
    gaugeColors: Type.Optional(
      Type.Object(
        {
          ok: Type.Optional(footerWidgetColorSchema),
          warning: Type.Optional(footerWidgetColorSchema),
          error: Type.Optional(footerWidgetColorSchema),
        },
        { additionalProperties: false },
      ),
    ),
    defaultTextColor: Type.Optional(footerWidgetColorSchema),
    defaultIconColor: Type.Optional(footerWidgetColorSchema),
    providerStatus: Type.Optional(providerStatusConfigSchema),
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

function parseProviderStatusConfig(
  input: FooterConfigSnapshot["providerStatus"] | undefined,
): FooterConfigSnapshot["providerStatus"] {
  const providers = input?.providers ?? DEFAULT_PROVIDER_STATUS_CONFIG.providers;
  const knownProviders = PROVIDER_STATUS_PROVIDER_IDS.filter((id) =>
    providers.includes(id),
  );
  return {
    refreshMs:
      input?.refreshMs ?? DEFAULT_PROVIDER_STATUS_CONFIG.refreshMs,
    cacheTtlMs:
      input?.cacheTtlMs ?? DEFAULT_PROVIDER_STATUS_CONFIG.cacheTtlMs,
    providers: knownProviders,
    display: input?.display ?? DEFAULT_PROVIDER_STATUS_CONFIG.display,
    showCredits:
      input?.showCredits ?? DEFAULT_PROVIDER_STATUS_CONFIG.showCredits,
    showReset: input?.showReset ?? DEFAULT_PROVIDER_STATUS_CONFIG.showReset,
  };
}

// Keys that existed in earlier releases, mapped to their replacement (or
// undefined when the key was removed without one).
const RENAMED_CONFIG_KEYS: Record<string, string | undefined> = {
  contextBarStyle: "gaugeStyle",
};

function knownKeysAt(path: string): readonly string[] {
  if (path === "") return Object.keys(footerConfigFileSchema.properties);
  if (path === "/providerStatus") {
    return Object.keys(providerStatusConfigSchema.properties);
  }
  if (path === "/gaugeColors") return Object.keys(DEFAULT_GAUGE_COLORS);
  if (path === "/widgets") return FOOTER_WIDGET_IDS;
  if (/^\/(widgets|extensionWidgets)\/[^/]+$/.test(path)) {
    return Object.keys(footerWidgetConfigOverrideSchema.properties);
  }
  return [];
}

function describeConfigError(error: {
  message: string;
  instancePath?: string;
  params?: unknown;
}): string[] {
  const path = error.instancePath || "";
  const display = path || "/";
  const params = error.params as
    | { additionalProperties?: unknown }
    | undefined;
  const unknown = Array.isArray(params?.additionalProperties)
    ? params.additionalProperties.filter(
        (key): key is string => typeof key === "string",
      )
    : [];
  if (unknown.length === 0) return [`  - ${display}: ${error.message}`];

  const known = knownKeysAt(path);
  return unknown.map((key) => {
    if (key in RENAMED_CONFIG_KEYS) {
      const replacement = RENAMED_CONFIG_KEYS[key];
      const hint = replacement
        ? `it was renamed to "${replacement}"`
        : "it was removed";
      return `  - ${display}: unknown key "${key}" (${hint})`;
    }
    const suggestion = closestKey(key, known);
    return `  - ${display}: unknown key "${key}"${
      suggestion ? ` (did you mean "${suggestion}"?)` : ""
    }`;
  });
}

function closestKey(
  key: string,
  candidates: readonly string[],
): string | undefined {
  let best: string | undefined;
  let bestDistance = Math.max(2, Math.floor(key.length / 3));
  for (const candidate of candidates) {
    const distance = editDistance(key.toLowerCase(), candidate.toLowerCase());
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(
        current + 1,
        row[j - 1]! + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[b.length]!;
}

export function footerConfigValidationErrors(value: unknown): string[] {
  if (validateFooterConfigFile.Check(value)) return [];
  const seen = new Set<string>();
  const messages: string[] = [];
  for (const error of validateFooterConfigFile.Errors(value)) {
    for (const message of describeConfigError(error)) {
      if (seen.has(message)) continue;
      seen.add(message);
      messages.push(message);
    }
  }
  return messages;
}

function parseFooterConfig(
  filePath: string,
  value: unknown,
): FooterConfigSnapshot {
  if (value === undefined) return defaultFooterConfig();

  const errors = footerConfigValidationErrors(value);
  if (errors.length > 0) {
    throw new Error(`Invalid ${filePath}:\n${errors.join("\n")}`);
  }

  const input = value as FooterConfigSnapshot;
  return {
    refreshMs: input.refreshMs ?? DEFAULT_FOOTER_CONFIG.refreshMs,
    iconFamily: input.iconFamily ?? DEFAULT_FOOTER_CONFIG.iconFamily,
    gaugeStyle: input.gaugeStyle ?? DEFAULT_FOOTER_CONFIG.gaugeStyle,
    gaugeWidth: input.gaugeWidth ?? DEFAULT_FOOTER_CONFIG.gaugeWidth,
    gaugeColors: {
      ok: input.gaugeColors?.ok ?? DEFAULT_GAUGE_COLORS.ok,
      warning: input.gaugeColors?.warning ?? DEFAULT_GAUGE_COLORS.warning,
      error: input.gaugeColors?.error ?? DEFAULT_GAUGE_COLORS.error,
    },
    defaultTextColor:
      input.defaultTextColor ?? DEFAULT_FOOTER_CONFIG.defaultTextColor,
    defaultIconColor:
      input.defaultIconColor ?? DEFAULT_FOOTER_CONFIG.defaultIconColor,
    providerStatus: parseProviderStatusConfig(input.providerStatus),
    widgets: pruneWidgetOverrides(
      input.widgets as Record<string, FooterWidgetConfigOverride> | undefined,
    ) as Partial<Record<BuiltInFooterWidgetId, FooterWidgetConfigOverride>>,
    extensionWidgets: pruneWidgetOverrides(input.extensionWidgets),
  };
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
      console.warn(
        `${message}\nUsing default footer settings until the config is fixed. Run /fancy-footer to edit it interactively.`,
      );
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
    gaugeStyle: config.gaugeStyle,
    gaugeWidth: clampInt(config.gaugeWidth, MIN_GAUGE_WIDTH, MAX_GAUGE_WIDTH),
    defaultTextColor: config.defaultTextColor,
    defaultIconColor: config.defaultIconColor,
  };

  if (
    config.gaugeColors.ok !== DEFAULT_GAUGE_COLORS.ok ||
    config.gaugeColors.warning !== DEFAULT_GAUGE_COLORS.warning ||
    config.gaugeColors.error !== DEFAULT_GAUGE_COLORS.error
  ) {
    out.gaugeColors = structuredClone(config.gaugeColors);
  }

  if (
    config.providerStatus.refreshMs !==
      DEFAULT_PROVIDER_STATUS_CONFIG.refreshMs ||
    config.providerStatus.cacheTtlMs !==
      DEFAULT_PROVIDER_STATUS_CONFIG.cacheTtlMs ||
    config.providerStatus.display !== DEFAULT_PROVIDER_STATUS_CONFIG.display ||
    config.providerStatus.showCredits !==
      DEFAULT_PROVIDER_STATUS_CONFIG.showCredits ||
    config.providerStatus.showReset !==
      DEFAULT_PROVIDER_STATUS_CONFIG.showReset ||
    config.providerStatus.providers.join(",") !==
      DEFAULT_PROVIDER_STATUS_CONFIG.providers.join(",")
  ) {
    out.providerStatus = structuredClone(config.providerStatus);
  }

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
  extensionWidgets: readonly NormalizedFancyFooterWidgetContribution[],
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
      case "textColor": {
        const color = plainSettingValue(newValue);
        if (color === "default") {
          delete override[fieldId];
        } else if (isFooterWidgetColor(color)) {
          override[fieldId] = color;
        }
        break;
      }
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

// Settings values for colors and gauge styles carry a preview prefix
// (e.g. "\u2588\u2588 success" or "\u25b0\u25b0\u25b0\u25b1\u25b1 parallelograms") so the list shows
// what each option resolves to. plainSettingValue() recovers the bare
// option name when a change comes back from the settings list.
function colorSettingValue(theme: Theme, color: string): string {
  if (!isFooterWidgetColor(color)) return color;
  return `${theme.fg(color, "\u2588\u2588")} ${color}`;
}

function gaugeStyleSettingValue(style: GaugeStyleDef): string {
  return `${style.filled.repeat(3)}${style.empty.repeat(2)} ${style.label}`;
}

export function plainSettingValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/\x1b\[[0-9;]*m/g, "").trim();
  const parts = stripped.split(/\s+/);
  return parts[parts.length - 1] ?? stripped;
}

function widgetSettingsItems(
  config: FooterConfigSnapshot,
  widget: ConfigurableWidgetMeta,
  theme: Theme,
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
      currentValue: colorSettingValue(theme, override?.iconColor ?? "default"),
      values: ["default", ...FOOTER_WIDGET_COLORS].map((color) =>
        colorSettingValue(theme, color),
      ),
      description: "Choose the icon color when the icon is visible.",
    },
    {
      id: "textColor",
      label: "text color",
      currentValue: colorSettingValue(theme, override?.textColor ?? "default"),
      values: ["default", ...FOOTER_WIDGET_COLORS].map((color) =>
        colorSettingValue(theme, color),
      ),
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
    const submenuItems = widgetSettingsItems(draft, widget, theme);
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
  theme: Theme,
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
      id: "gaugeStyle",
      label: "gauge style",
      currentValue: gaugeStyleSettingValue(getGaugeStyle(draft.gaugeStyle)),
      values: GAUGE_STYLES.map((style) => gaugeStyleSettingValue(style)),
      description:
        "Choose the glyphs used by the context and provider status gauges.",
    },
    {
      id: "gaugeWidth",
      label: "gauge width (cells)",
      currentValue: String(draft.gaugeWidth),
      values: GAUGE_WIDTH_OPTIONS.map((value) => String(value)),
      description:
        "Choose how many cells the provider status gauges and the compact context gauge span. A context bar with fill set to grow spans the row instead.",
    },
    {
      id: "gaugeColorOk",
      label: "gauge color (healthy)",
      currentValue: colorSettingValue(theme, draft.gaugeColors.ok),
      values: FOOTER_WIDGET_COLORS.map((color) =>
        colorSettingValue(theme, color),
      ),
      description:
        "Choose the fill color for healthy gauges. Defaults to the theme accent so gauges only stand out when running low.",
    },
    {
      id: "gaugeColorWarning",
      label: "gauge color (warning)",
      currentValue: colorSettingValue(theme, draft.gaugeColors.warning),
      values: FOOTER_WIDGET_COLORS.map((color) =>
        colorSettingValue(theme, color),
      ),
      description: "Choose the fill color for gauges below 60% remaining.",
    },
    {
      id: "gaugeColorError",
      label: "gauge color (critical)",
      currentValue: colorSettingValue(theme, draft.gaugeColors.error),
      values: FOOTER_WIDGET_COLORS.map((color) =>
        colorSettingValue(theme, color),
      ),
      description: "Choose the fill color for gauges below 25% remaining.",
    },
    {
      id: "defaultTextColor",
      label: "default text color",
      currentValue: colorSettingValue(theme, draft.defaultTextColor),
      values: FOOTER_WIDGET_COLORS.map((color) =>
        colorSettingValue(theme, color),
      ),
      description:
        "Choose the default text color for widgets. You can still change individual widgets.",
    },
    {
      id: "defaultIconColor",
      label: "default icon color",
      currentValue: colorSettingValue(theme, draft.defaultIconColor),
      values: FOOTER_WIDGET_COLORS.map((color) =>
        colorSettingValue(theme, color),
      ),
      description:
        "Choose the default icon color for widgets. You can still change individual widgets.",
    },
  ];
}

export function createFooterConfigSections(
  draft: FooterConfigSnapshot,
  theme: Theme,
  applyDraft: () => void,
  extensionWidgets: readonly NormalizedFancyFooterWidgetContribution[],
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
      items: genericFooterSettingsItems(draft, theme),
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
