import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { FancyFooterWidgetContribution } from "./shared.ts";

export const FANCY_FOOTER_DISCOVER_WIDGETS_EVENT =
  "pi-fancy-footer:discover-widgets";
export const FANCY_FOOTER_REQUEST_WIDGET_DISCOVERY_EVENT =
  "pi-fancy-footer:request-widget-discovery";
export const FANCY_FOOTER_REQUEST_WIDGET_REFRESH_EVENT =
  "pi-fancy-footer:request-widget-refresh";

export interface FancyFooterWidgetDiscoveryRequest {
  registerWidget: (widget: FancyFooterWidgetContribution) => void;
}

export type FancyFooterWidgetProvider =
  | FancyFooterWidgetContribution
  | readonly FancyFooterWidgetContribution[]
  | (() =>
      | FancyFooterWidgetContribution
      | readonly FancyFooterWidgetContribution[]
      | undefined)
  | undefined;

function toWidgetList(
  provider: FancyFooterWidgetProvider,
): readonly FancyFooterWidgetContribution[] {
  const value = typeof provider === "function" ? provider() : provider;
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

export function contributeFancyFooterWidgets(
  pi: ExtensionAPI,
  provider: FancyFooterWidgetProvider,
): void {
  pi.events.on(FANCY_FOOTER_DISCOVER_WIDGETS_EVENT, (payload) => {
    const request = payload as FancyFooterWidgetDiscoveryRequest | undefined;
    if (!request || typeof request.registerWidget !== "function") return;

    for (const widget of toWidgetList(provider)) {
      request.registerWidget(widget);
    }
  });
}

export function requestFancyFooterWidgetDiscovery(pi: ExtensionAPI): void {
  pi.events.emit(FANCY_FOOTER_REQUEST_WIDGET_DISCOVERY_EVENT, {});
}

export function requestFancyFooterRefresh(pi: ExtensionAPI): void {
  pi.events.emit(FANCY_FOOTER_REQUEST_WIDGET_REFRESH_EVENT, {});
}

export type { FancyFooterWidgetContribution } from "./shared.ts";
export type {
  FooterIconFamily,
  FooterWidgetAlign,
  FooterWidgetColor,
  FooterWidgetEditorDefaults,
  FooterWidgetFill,
  WidgetRenderContext,
} from "./shared.ts";
