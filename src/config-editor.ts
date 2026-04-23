import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@mariozechner/pi-tui";
import {
  createFooterConfigSections,
  type FooterConfigSectionId,
} from "./config.ts";
import {
  isContextBarStyleId,
  isFooterIconFamily,
  isFooterWidgetColor,
  type FancyFooterWidgetContribution,
  type FooterConfigSnapshot,
} from "./shared.ts";

interface OpenFooterConfigEditorOptions {
  ctx: ExtensionContext;
  configPath: string;
  draft: FooterConfigSnapshot;
  extensionWidgets: readonly FancyFooterWidgetContribution[];
  applyDraft: () => void;
}

export async function openFooterConfigEditor({
  ctx,
  configPath,
  draft,
  extensionWidgets,
  applyDraft,
}: OpenFooterConfigEditorOptions): Promise<void> {
  await ctx.ui.custom((tui, theme, keybindings, done) => {
    let activeSection: FooterConfigSectionId = "generic";
    const selection: Record<FooterConfigSectionId, number> = {
      generic: 0,
      widgets: 0,
      "extension-widgets": 0,
    };
    let submenu: Component | undefined;

    const sections = () =>
      createFooterConfigSections(
        draft,
        theme,
        () => {
          applyDraft();
          tui.requestRender();
        },
        extensionWidgets,
      );

    const sectionIds = () => sections().map((section) => section.id);

    const itemsForSection = (sectionId: FooterConfigSectionId) =>
      sections().find((section) => section.id === sectionId)?.items ?? [];

    const clampSelection = (sectionId: FooterConfigSectionId) => {
      const items = itemsForSection(sectionId);
      if (items.length === 0) {
        selection[sectionId] = 0;
        return;
      }
      selection[sectionId] = Math.max(
        0,
        Math.min(selection[sectionId], items.length - 1),
      );
    };

    const selectedItem = () => {
      clampSelection(activeSection);
      const items = itemsForSection(activeSection);
      return items[selection[activeSection]];
    };

    const setGenericField = (fieldId: string, newValue: string) => {
      switch (fieldId) {
        case "refreshMs": {
          const parsed = Number(newValue);
          if (Number.isInteger(parsed)) draft.refreshMs = parsed;
          break;
        }
        case "iconFamily":
          if (isFooterIconFamily(newValue)) draft.iconFamily = newValue;
          break;
        case "contextBarStyle":
          if (isContextBarStyleId(newValue)) draft.contextBarStyle = newValue;
          break;
        case "defaultTextColor":
          if (isFooterWidgetColor(newValue)) draft.defaultTextColor = newValue;
          break;
        case "defaultIconColor":
          if (isFooterWidgetColor(newValue)) draft.defaultIconColor = newValue;
          break;
      }
    };

    const moveSection = (direction: 1 | -1) => {
      const ids = sectionIds();
      const currentIndex = ids.indexOf(activeSection);
      if (currentIndex < 0 || ids.length === 0) return;

      activeSection =
        ids[(currentIndex + direction + ids.length) % ids.length] ??
        activeSection;
      clampSelection(activeSection);
    };

    const moveSelection = (direction: 1 | -1) => {
      const entries = sectionIds().flatMap((sectionId) =>
        itemsForSection(sectionId).map((_, index) => ({ sectionId, index })),
      );
      if (entries.length === 0) return;

      clampSelection(activeSection);
      const current = entries.findIndex(
        (entry) =>
          entry.sectionId === activeSection &&
          entry.index === selection[activeSection],
      );
      const next =
        entries[
          (Math.max(0, current) + direction + entries.length) % entries.length
        ];
      if (!next) return;

      activeSection = next.sectionId;
      selection[next.sectionId] = next.index;
    };

    const activateSelectedItem = () => {
      const item = selectedItem();
      if (!item) return;

      if (item.submenu) {
        submenu = item.submenu(item.currentValue, () => {
          submenu = undefined;
          tui.requestRender();
        });
        return;
      }

      if (!item.values || item.values.length === 0) return;
      const currentIndex = item.values.indexOf(item.currentValue);
      const nextValue =
        item.values[
          (currentIndex + 1 + item.values.length) % item.values.length
        ];
      if (nextValue === undefined) return;

      setGenericField(item.id, nextValue);
      applyDraft();
    };

    const renderSection = (width: number, sectionId: FooterConfigSectionId) => {
      const section = sections().find((entry) => entry.id === sectionId);
      if (!section) return [];

      const items = section.items;
      clampSelection(sectionId);
      const lines = [
        truncateToWidth(
          activeSection === sectionId
            ? theme.fg("accent", theme.bold(section.title))
            : theme.bold(section.title),
          width,
        ),
      ];

      if (items.length === 0) {
        lines.push(
          truncateToWidth(theme.fg("dim", "  No settings available"), width),
        );
        return lines;
      }

      const labelWidth = Math.min(
        28,
        Math.max(...items.map((item) => visibleWidth(item.label)), 0),
      );
      for (const [index, item] of items.entries()) {
        const selected =
          activeSection === sectionId && selection[sectionId] === index;
        const prefix = selected ? theme.fg("accent", "→ ") : "  ";
        const paddedLabel =
          item.label +
          " ".repeat(Math.max(0, labelWidth - visibleWidth(item.label)));
        const valueWidth = Math.max(
          4,
          width - visibleWidth(prefix) - labelWidth - 4,
        );
        const value = truncateToWidth(item.currentValue, valueWidth, "");

        lines.push(
          truncateToWidth(
            `${prefix}${selected ? theme.fg("accent", paddedLabel) : paddedLabel}  ${selected ? theme.fg("accent", value) : theme.fg("dim", value)}`,
            width,
          ),
        );
      }

      return lines;
    };

    return {
      render(width: number) {
        if (submenu) return submenu.render(width);

        const lines = [
          truncateToWidth(
            theme.fg("accent", theme.bold("Fancy Footer Configuration")),
            width,
          ),
          truncateToWidth(theme.fg("dim", configPath), width),
        ];

        for (const [index, sectionId] of sectionIds().entries()) {
          lines.push("");
          lines.push(...renderSection(width, sectionId));
          if (index === sectionIds().length - 1) continue;
        }

        const item = selectedItem();
        if (item?.description) {
          lines.push("");
          for (const line of wrapTextWithAnsi(
            item.description,
            Math.max(10, width - 2),
          )) {
            lines.push(truncateToWidth(theme.fg("dim", line), width));
          }
        }

        lines.push("");
        lines.push(
          truncateToWidth(
            theme.fg(
              "dim",
              "↑↓ navigate • Tab/Shift+Tab switch section • Enter configure widget/change values • Esc close",
            ),
            width,
          ),
        );

        return lines;
      },
      invalidate() {
        submenu?.invalidate?.();
      },
      handleInput(data: string) {
        if (submenu) {
          submenu.handleInput?.(data);
          tui.requestRender();
          return;
        }

        if (keybindings.matches(data, "tui.select.up")) {
          moveSelection(-1);
        } else if (keybindings.matches(data, "tui.select.down")) {
          moveSelection(1);
        } else if (matchesKey(data, Key.tab)) {
          moveSection(1);
        } else if (matchesKey(data, Key.shift("tab"))) {
          moveSection(-1);
        } else if (
          keybindings.matches(data, "tui.select.confirm") ||
          data === " "
        ) {
          activateSelectedItem();
        } else if (keybindings.matches(data, "tui.select.cancel")) {
          done(undefined);
          return;
        }

        tui.requestRender();
      },
    };
  });
}
