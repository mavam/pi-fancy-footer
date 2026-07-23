import { Type } from "typebox";
import { Compile } from "typebox/compile";
import {
  FANCY_FOOTER_PROTOCOL_VERSION,
  type FancyFooterDataWidget,
  type FancyFooterDataWidgetIcon,
} from "./api.ts";
import {
  FOOTER_ICON_FAMILIES,
  FOOTER_WIDGET_COLORS,
  MAX_WIDGET_MIN_WIDTH,
  MAX_WIDGET_POSITION,
  MAX_WIDGET_ROW,
  isFooterWidgetId,
  type FooterIconFamily,
  type FooterWidgetAlign,
  type FooterWidgetColor,
  type FooterWidgetEditorDefaults,
  type FooterWidgetFill,
  type FooterWidgetIcon,
} from "./shared.ts";

export const MAX_DATA_WIDGET_TEXT_CODE_POINTS = 512;
export const MAX_DATA_WIDGET_ID_LENGTH = 128;

const DATA_WIDGET_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9][A-Za-z0-9_-]*)+$/u;

const literalUnion = (values: readonly string[]) =>
  Type.Union(values.map((value) => Type.Literal(value)));

const colorSchema = literalUnion(FOOTER_WIDGET_COLORS);
const dataWidgetIdSchema = Type.String({
  minLength: 3,
  maxLength: MAX_DATA_WIDGET_ID_LENGTH,
  pattern: DATA_WIDGET_ID_PATTERN.source,
});
const glyphsSchema = Type.Union([
  Type.String(),
  Type.Object(
    Object.fromEntries(
      FOOTER_ICON_FAMILIES.map((family) => [
        family,
        Type.Optional(Type.String()),
      ]),
    ),
    { additionalProperties: false },
  ),
]);
const dataWidgetSchema = Type.Object(
  {
    id: dataWidgetIdSchema,
    label: Type.Optional(Type.String({ minLength: 1 })),
    description: Type.Optional(Type.String({ minLength: 1 })),
    content: Type.Object(
      {
        type: Type.Literal("text"),
        text: Type.String(),
      },
      { additionalProperties: false },
    ),
    icon: Type.Optional(
      Type.Union([
        Type.Literal(false),
        Type.Object(
          {
            glyphs: glyphsSchema,
            color: Type.Optional(colorSchema),
          },
          { additionalProperties: false },
        ),
      ]),
    ),
    style: Type.Optional(
      Type.Object(
        { textColor: Type.Optional(colorSchema) },
        { additionalProperties: false },
      ),
    ),
    layout: Type.Optional(
      Type.Object(
        {
          enabled: Type.Optional(Type.Boolean()),
          row: Type.Optional(
            Type.Integer({ minimum: 0, maximum: MAX_WIDGET_ROW }),
          ),
          position: Type.Optional(
            Type.Integer({ minimum: 0, maximum: MAX_WIDGET_POSITION }),
          ),
          align: Type.Optional(literalUnion(["left", "middle", "right"])),
          fill: Type.Optional(literalUnion(["none", "grow"])),
          minWidth: Type.Optional(
            Type.Integer({ minimum: 0, maximum: MAX_WIDGET_MIN_WIDTH }),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
const upsertMessageSchema = Type.Object(
  {
    protocol: Type.Literal(FANCY_FOOTER_PROTOCOL_VERSION),
    type: Type.Literal("upsert"),
    widget: dataWidgetSchema,
  },
  { additionalProperties: false },
);
const removeMessageSchema = Type.Object(
  {
    protocol: Type.Literal(FANCY_FOOTER_PROTOCOL_VERSION),
    type: Type.Literal("remove"),
    id: dataWidgetIdSchema,
  },
  { additionalProperties: false },
);
const validateUpsertMessage = Compile(upsertMessageSchema);
const validateRemoveMessage = Compile(removeMessageSchema);

export interface NormalizedFancyFooterDataWidget {
  id: string;
  label: string;
  description: string;
  content: { type: "text"; text: string };
  icon?: FancyFooterDataWidgetIcon | false;
  preferredTextColor?: FooterWidgetColor;
  defaults: FooterWidgetEditorDefaults;
}

function sanitizeInlineText(text: string, maxCodePoints: number): string {
  const inline = text
    .replace(/[\u0000-\u001f\u007f-\u009f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return Array.from(inline).slice(0, maxCodePoints).join("");
}

export function sanitizeDataWidgetText(text: string): string {
  return sanitizeInlineText(text, MAX_DATA_WIDGET_TEXT_CODE_POINTS);
}

function sanitizeGlyph(text: string): string {
  return sanitizeInlineText(text, 16);
}

function normalizeIcon(
  icon: FancyFooterDataWidget["icon"],
): FancyFooterDataWidgetIcon | false | undefined {
  if (icon === undefined || icon === false) return icon;
  const sourceGlyphs = icon.glyphs;
  const glyphs =
    typeof sourceGlyphs === "string"
      ? sanitizeGlyph(sourceGlyphs)
      : Object.fromEntries(
          FOOTER_ICON_FAMILIES.flatMap((family) => {
            const glyph = sourceGlyphs[family];
            return glyph === undefined ? [] : [[family, sanitizeGlyph(glyph)]];
          }),
        );
  return { glyphs, ...(icon.color ? { color: icon.color } : {}) };
}

function normalizeWidget(
  widget: FancyFooterDataWidget,
): NormalizedFancyFooterDataWidget | undefined {
  const id = sanitizeInlineText(widget.id, MAX_DATA_WIDGET_ID_LENGTH);
  if (!id || isFooterWidgetId(id)) return undefined;

  const label = sanitizeInlineText(widget.label ?? id, 128) || id;
  const description =
    sanitizeInlineText(widget.description ?? label, 512) || label;
  return {
    id,
    label,
    description,
    content: { type: "text", text: sanitizeDataWidgetText(widget.content.text) },
    icon: normalizeIcon(widget.icon),
    preferredTextColor: widget.style?.textColor,
    defaults: {
      enabled: widget.layout?.enabled,
      row: widget.layout?.row ?? 1,
      position: widget.layout?.position ?? 0,
      align: (widget.layout?.align ?? "right") as FooterWidgetAlign,
      fill: (widget.layout?.fill ?? "none") as FooterWidgetFill,
      minWidth: widget.layout?.minWidth,
    },
  };
}

export class FancyFooterDataWidgetStore {
  private readonly widgets = new Map<string, NormalizedFancyFooterDataWidget>();

  apply(raw: unknown): boolean {
    if (validateUpsertMessage.Check(raw)) {
      const widget = normalizeWidget(raw.widget as FancyFooterDataWidget);
      if (!widget) return false;
      this.widgets.set(widget.id, widget);
      return true;
    }
    if (validateRemoveMessage.Check(raw)) {
      const id = sanitizeInlineText(raw.id as string, 128);
      return id !== "" && !isFooterWidgetId(id) && this.widgets.delete(id);
    }
    return false;
  }

  clear(): boolean {
    if (this.widgets.size === 0) return false;
    this.widgets.clear();
    return true;
  }

  values(): NormalizedFancyFooterDataWidget[] {
    return [...this.widgets.values()].sort((left, right) =>
      left.label.localeCompare(right.label),
    );
  }
}

export function resolveDataWidgetIcon(
  icon: NormalizedFancyFooterDataWidget["icon"],
  iconFamily: FooterIconFamily,
): FooterWidgetIcon | undefined {
  if (!icon) return undefined;
  const text =
    typeof icon.glyphs === "string"
      ? icon.glyphs
      : (icon.glyphs[iconFamily] ?? "");
  return text ? { text, color: icon.color ?? "text" } : undefined;
}

export function createMicrotaskCoalescer(callback: () => void): () => void {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      callback();
    });
  };
}
