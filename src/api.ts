import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
  FooterIconFamily,
  FooterWidgetAlign,
  FooterWidgetColor,
  FooterWidgetFill,
} from "./shared.ts";

export const FANCY_FOOTER_PROTOCOL_VERSION = 1 as const;
export const FANCY_FOOTER_WIDGET_CHANNEL = "pi-fancy-footer:widget";
export const FANCY_FOOTER_READY_CHANNEL = "pi-fancy-footer:ready";

export interface FancyFooterTextContent {
  type: "text";
  text: string;
}

export interface FancyFooterDataWidgetIcon {
  glyphs: string | Partial<Record<FooterIconFamily, string>>;
  color?: FooterWidgetColor;
}

export interface FancyFooterDataWidgetStyle {
  textColor?: FooterWidgetColor;
}

export interface FancyFooterDataWidgetLayout {
  enabled?: boolean;
  row?: number;
  position?: number;
  align?: FooterWidgetAlign;
  fill?: FooterWidgetFill;
  minWidth?: number;
}

export interface FancyFooterDataWidget {
  id: string;
  label?: string;
  description?: string;
  content: FancyFooterTextContent;
  icon?: FancyFooterDataWidgetIcon | false;
  style?: FancyFooterDataWidgetStyle;
  layout?: FancyFooterDataWidgetLayout;
}

export type FancyFooterWidgetMessage =
  | {
      protocol: typeof FANCY_FOOTER_PROTOCOL_VERSION;
      type: "upsert";
      widget: FancyFooterDataWidget;
    }
  | {
      protocol: typeof FANCY_FOOTER_PROTOCOL_VERSION;
      type: "remove";
      id: string;
    };

export interface FancyFooterReadyMessage {
  protocol: typeof FANCY_FOOTER_PROTOCOL_VERSION;
  version: string;
}

export interface FancyFooterClient {
  upsert(widget: FancyFooterDataWidget): void;
  remove(id: string): void;
  onReady(handler: (message: FancyFooterReadyMessage) => void): () => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Create a typed client over the same import-free event-bus protocol. */
export function createFancyFooterClient(pi: ExtensionAPI): FancyFooterClient {
  return {
    upsert: (widget) => {
      const message: FancyFooterWidgetMessage = {
        protocol: FANCY_FOOTER_PROTOCOL_VERSION,
        type: "upsert",
        widget,
      };
      pi.events.emit(FANCY_FOOTER_WIDGET_CHANNEL, message);
    },
    remove: (id) => {
      const message: FancyFooterWidgetMessage = {
        protocol: FANCY_FOOTER_PROTOCOL_VERSION,
        type: "remove",
        id,
      };
      pi.events.emit(FANCY_FOOTER_WIDGET_CHANNEL, message);
    },
    onReady: (handler) =>
      pi.events.on(FANCY_FOOTER_READY_CHANNEL, (raw) => {
        if (
          !isRecord(raw) ||
          raw.protocol !== FANCY_FOOTER_PROTOCOL_VERSION ||
          typeof raw.version !== "string"
        ) {
          return;
        }
        handler(raw as unknown as FancyFooterReadyMessage);
      }),
  };
}

export type {
  FooterIconFamily,
  FooterWidgetAlign,
  FooterWidgetColor,
  FooterWidgetFill,
} from "./shared.ts";
