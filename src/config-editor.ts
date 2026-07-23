import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  Key,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
} from "@earendil-works/pi-tui";
import {
  buildConfigurableWidgets,
  genericFooterSettingsItems,
  plainSettingValue,
  widgetSettingsSubmenu,
  type ConfigurableWidgetMeta,
} from "./config.ts";
import {
  buildLayoutModel,
  cycleAlign,
  moveHorizontal,
  moveVertical,
  setBenched,
  toggleFill,
  type LayoutChip,
  type LayoutModel,
  type LayoutRow,
} from "./layout.ts";
import {
  isGaugeStyleId,
  MIN_GAUGE_WIDTH,
  MAX_GAUGE_WIDTH,
  isFooterIconFamily,
  isFooterWidgetColor,
  type FooterConfigSnapshot,
} from "./shared.ts";
import type { NormalizedFancyFooterDataWidget } from "./data-widgets.ts";

interface OpenFooterConfigEditorOptions {
  ctx: ExtensionContext;
  configPath: string;
  draft: FooterConfigSnapshot;
  extensionWidgets: readonly NormalizedFancyFooterDataWidget[];
  applyDraft: () => void;
}

type Selection =
  | { area: "grid" | "bench"; widgetId: string }
  | { area: "globals"; index: number };

interface ChipSpan {
  start: number;
  end: number;
}

// Each chip row independently degrades until it fits: full widget names,
// then short names, then icons only. The status line under the preview
// always shows the selected widget's full name.
type ChipMode = "full" | "short" | "icon";
const CHIP_MODES: readonly ChipMode[] = ["full", "short", "icon"];
const CHIP_GAP = 2;

export async function openFooterConfigEditor({
  ctx,
  configPath,
  draft,
  extensionWidgets,
  applyDraft,
}: OpenFooterConfigEditorOptions): Promise<void> {
  await ctx.ui.custom((tui, theme, keybindings, done) => {
    let submenu: Component | undefined;
    // Screen columns of the last selected chip's center, used to pick the
    // nearest chip when moving between rows.
    let preferredColumn = 0;
    let chipSpans = new Map<string, ChipSpan>();

    const widgets = (): ConfigurableWidgetMeta[] =>
      buildConfigurableWidgets(draft, extensionWidgets);

    const model = (): LayoutModel => buildLayoutModel(draft, widgets());

    const globalsItems = () => genericFooterSettingsItems(draft, theme);

    const initialSelection = (): Selection => {
      const current = model();
      for (const row of current.rows) {
        if (row.ordered.length > 0) {
          return { area: "grid", widgetId: row.ordered[0]!.widget.id };
        }
      }
      if (current.bench.length > 0) {
        return { area: "bench", widgetId: current.bench[0]!.widget.id };
      }
      return { area: "globals", index: 0 };
    };

    let selection: Selection = initialSelection();

    // ── selection helpers ────────────────────────────────────────────

    // Non-empty chip rows in navigation order: grid rows, then the bench.
    type NavRow =
      | { kind: "grid"; row: LayoutRow }
      | { kind: "bench"; chips: LayoutChip[] };

    const navRows = (current: LayoutModel): NavRow[] => {
      const rows: NavRow[] = current.rows
        .filter((row) => row.ordered.length > 0)
        .map((row) => ({ kind: "grid" as const, row }));
      if (current.bench.length > 0) {
        rows.push({ kind: "bench", chips: current.bench });
      }
      return rows;
    };

    const navRowChips = (row: NavRow): LayoutChip[] =>
      row.kind === "grid" ? row.row.ordered : row.chips;

    const findNavIndex = (rows: NavRow[], widgetId: string): number =>
      rows.findIndex((row) =>
        navRowChips(row).some((chip) => chip.widget.id === widgetId),
      );

    const chipCenter = (widgetId: string): number => {
      const span = chipSpans.get(widgetId);
      if (!span) return preferredColumn;
      return Math.floor((span.start + span.end) / 2);
    };

    const nearestChip = (row: NavRow, column: number): LayoutChip => {
      const chips = navRowChips(row);
      let best = chips[0]!;
      let bestDistance = Infinity;
      for (const chip of chips) {
        const distance = Math.abs(chipCenter(chip.widget.id) - column);
        if (distance < bestDistance) {
          best = chip;
          bestDistance = distance;
        }
      }
      return best;
    };

    const selectChip = (chip: LayoutChip) => {
      selection = {
        area: chip.placement.benched ? "bench" : "grid",
        widgetId: chip.widget.id,
      };
      preferredColumn = chipCenter(chip.widget.id);
    };

    // After a mutation the selected widget may have changed rows or moved
    // between the grid and the bench; recompute which area it lives in.
    const syncSelection = () => {
      if (selection.area === "globals") return;
      const widgetId = selection.widgetId;
      const current = model();
      const benched = current.bench.some((chip) => chip.widget.id === widgetId);
      selection = { area: benched ? "bench" : "grid", widgetId };
    };

    const moveSelectionHorizontal = (direction: -1 | 1) => {
      if (selection.area === "globals") return;
      const rows = navRows(model());
      const index = findNavIndex(rows, selection.widgetId);
      if (index < 0) return;
      const chips = navRowChips(rows[index]!);
      const chipIndex = chips.findIndex(
        (chip) => chip.widget.id === (selection as { widgetId: string }).widgetId,
      );
      const next = chips[chipIndex + direction];
      if (next) selectChip(next);
    };

    const moveSelectionVertical = (direction: -1 | 1) => {
      const current = model();
      const rows = navRows(current);
      const globals = globalsItems();

      if (selection.area === "globals") {
        const next = selection.index + direction;
        if (next >= 0 && next < globals.length) {
          selection = { area: "globals", index: next };
        } else if (next < 0 && rows.length > 0) {
          selectChip(nearestChip(rows[rows.length - 1]!, preferredColumn));
        }
        return;
      }

      const index = findNavIndex(rows, selection.widgetId);
      if (index < 0) return;
      const target = index + direction;
      if (target >= 0 && target < rows.length) {
        preferredColumn = chipCenter(selection.widgetId);
        selectChip(nearestChip(rows[target]!, preferredColumn));
      } else if (target >= rows.length && globals.length > 0) {
        preferredColumn = chipCenter(selection.widgetId);
        selection = { area: "globals", index: 0 };
      }
    };

    // ── widget actions ───────────────────────────────────────────────

    const chipActions: {
      keys: string[];
      hint?: string;
      run: (widgetId: string) => void;
    }[] = [
      {
        keys: ["l"],
        run: (id) => moveHorizontal(draft, widgets(), id, -1),
      },
      {
        keys: ["r"],
        hint: "l/r move",
        run: (id) => moveHorizontal(draft, widgets(), id, 1),
      },
      {
        keys: ["u"],
        run: (id) => moveVertical(draft, widgets(), id, -1),
      },
      {
        keys: ["d"],
        hint: "u/d row",
        run: (id) => moveVertical(draft, widgets(), id, 1),
      },
      {
        keys: ["a"],
        hint: "a align",
        run: (id) => cycleAlign(draft, widgets(), id),
      },
      {
        keys: ["f"],
        hint: "f fill",
        run: (id) => toggleFill(draft, widgets(), id),
      },
      {
        keys: ["x", " "],
        hint: "x hide",
        run: (id) => {
          const benched = model().bench.some((chip) => chip.widget.id === id);
          setBenched(draft, widgets(), id, !benched);
        },
      },
    ];

    const chipHints = [
      "←→↑↓ select",
      ...chipActions.map((action) => action.hint).filter(Boolean),
      "⏎ settings",
      "esc close",
    ].join(" · ");

    const globalsHints = "↑↓ navigate · ⏎/space change · esc close";

    // ── globals mutation (value cycling) ─────────────────────────────

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
        case "gaugeStyle": {
          const style = plainSettingValue(newValue);
          if (isGaugeStyleId(style)) draft.gaugeStyle = style;
          break;
        }
        case "gaugeColorOk": {
          const color = plainSettingValue(newValue);
          if (isFooterWidgetColor(color)) draft.gaugeColors.ok = color;
          break;
        }
        case "gaugeColorWarning": {
          const color = plainSettingValue(newValue);
          if (isFooterWidgetColor(color)) draft.gaugeColors.warning = color;
          break;
        }
        case "gaugeColorError": {
          const color = plainSettingValue(newValue);
          if (isFooterWidgetColor(color)) draft.gaugeColors.error = color;
          break;
        }
        case "gaugeWidth": {
          const parsed = Number(newValue);
          if (
            Number.isInteger(parsed) &&
            parsed >= MIN_GAUGE_WIDTH &&
            parsed <= MAX_GAUGE_WIDTH
          ) {
            draft.gaugeWidth = parsed;
          }
          break;
        }
        case "defaultTextColor": {
          const color = plainSettingValue(newValue);
          if (isFooterWidgetColor(color)) draft.defaultTextColor = color;
          break;
        }
        case "defaultIconColor": {
          const color = plainSettingValue(newValue);
          if (isFooterWidgetColor(color)) draft.defaultIconColor = color;
          break;
        }
      }
    };

    const cycleGlobalValue = () => {
      if (selection.area !== "globals") return;
      const item = globalsItems()[selection.index];
      if (!item?.values || item.values.length === 0) return;
      const currentIndex = item.values.indexOf(item.currentValue);
      const nextValue =
        item.values[(currentIndex + 1 + item.values.length) % item.values.length];
      if (nextValue === undefined) return;
      setGenericField(item.id, nextValue);
      applyDraft();
    };

    const activateSelection = () => {
      if (selection.area === "globals") {
        cycleGlobalValue();
        return;
      }
      const widget = widgets().find(
        (entry) => entry.id === (selection as { widgetId: string }).widgetId,
      );
      if (!widget) return;
      submenu = widgetSettingsSubmenu(draft, theme, widget, () => {
        applyDraft();
        tui.requestRender();
      })("", () => {
        submenu = undefined;
        tui.requestRender();
      });
    };

    // ── preview rendering ────────────────────────────────────────────

    const chipText = (chip: LayoutChip, mode: ChipMode): string => {
      const icon = chip.widget.defaultIcon?.text ?? "◌";
      if (mode === "icon") return icon;
      const label =
        mode === "full" ? chip.widget.label : chip.widget.shortLabel;
      const grow = chip.placement.fill === "grow" ? " ↔" : "";
      return `${icon} ${label}${grow}`;
    };

    const styledChip = (
      chip: LayoutChip,
      mode: ChipMode,
      selected: boolean,
    ): string => {
      const plain = chipText(chip, mode);
      if (selected) return theme.inverse(plain);
      if (chip.placement.benched) return theme.fg("dim", plain);

      const icon = chip.widget.defaultIcon?.text ?? "◌";
      const iconColor = chip.widget.defaultIcon
        ? draft.defaultIconColor
        : "dim";
      if (mode === "icon") return theme.fg(iconColor, icon);
      const label =
        mode === "full" ? chip.widget.label : chip.widget.shortLabel;
      const grow =
        chip.placement.fill === "grow" ? theme.fg("dim", " ↔") : "";
      return `${theme.fg(iconColor, icon)} ${label}${grow}`;
    };

    interface PlacedChip {
      chip: LayoutChip;
      column: number;
      width: number;
    }

    const groupWidth = (chips: LayoutChip[], mode: ChipMode) =>
      chips.reduce(
        (acc, chip, index) =>
          acc + visibleWidth(chipText(chip, mode)) + (index > 0 ? CHIP_GAP : 0),
        0,
      );

    const rowFits = (
      contentWidth: number,
      row: LayoutRow,
      mode: ChipMode,
    ): boolean => {
      const blocks = [
        groupWidth(row.groups.left, mode),
        groupWidth(row.groups.middle, mode),
        groupWidth(row.groups.right, mode),
      ].filter((width) => width > 0);
      return (
        blocks.reduce((acc, width) => acc + width, 0) +
          (blocks.length - 1) * CHIP_GAP <=
        contentWidth
      );
    };

    // The widest mode in which the row fits; icons-only as a last resort.
    const rowChipMode = (contentWidth: number, row: LayoutRow): ChipMode =>
      CHIP_MODES.find((mode) => rowFits(contentWidth, row, mode)) ?? "icon";

    // Mirrors composeAlignedRow() in render.ts: left group flush left, right
    // group flush right, middle group centered. Falls back to a flat join
    // when the row overflows even icons-only.
    const placeRowChips = (
      contentWidth: number,
      row: LayoutRow,
      mode: ChipMode,
    ): PlacedChip[] => {
      const leftWidth = groupWidth(row.groups.left, mode);
      const middleWidth = groupWidth(row.groups.middle, mode);
      const rightWidth = groupWidth(row.groups.right, mode);

      const placed: PlacedChip[] = [];
      const placeGroup = (chips: LayoutChip[], start: number) => {
        let column = start;
        for (const chip of chips) {
          const width = visibleWidth(chipText(chip, mode));
          placed.push({ chip, column, width });
          column += width + CHIP_GAP;
        }
      };

      if (!rowFits(contentWidth, row, mode)) {
        placeGroup(row.ordered, 0);
        return placed;
      }

      placeGroup(row.groups.left, 0);
      const rightStart = contentWidth - rightWidth;
      let middleStart = Math.floor((contentWidth - middleWidth) / 2);
      middleStart = Math.max(
        leftWidth > 0 ? leftWidth + CHIP_GAP : 0,
        Math.min(
          middleStart,
          rightWidth > 0
            ? rightStart - CHIP_GAP - middleWidth
            : contentWidth - middleWidth,
        ),
      );
      placeGroup(row.groups.middle, middleStart);
      placeGroup(row.groups.right, rightStart);
      return placed;
    };

    const renderChipLine = (
      width: number,
      gutter: string,
      placed: PlacedChip[],
      mode: ChipMode,
      selectedId: string | undefined,
    ): string => {
      const gutterWidth = visibleWidth(gutter);
      let line = gutter;
      let column = 0;
      for (const entry of placed) {
        if (entry.column > column) {
          line += " ".repeat(entry.column - column);
          column = entry.column;
        }
        line += styledChip(
          entry.chip,
          mode,
          entry.chip.widget.id === selectedId,
        );
        chipSpans.set(entry.chip.widget.id, {
          start: gutterWidth + entry.column,
          end: gutterWidth + entry.column + entry.width,
        });
        column += entry.width;
      }
      return truncateToWidth(line, width);
    };

    const selectedDescription = (): string | undefined => {
      if (selection.area === "globals") {
        return globalsItems()[selection.index]?.description;
      }
      const widgetId = selection.widgetId;
      return widgets().find((entry) => entry.id === widgetId)?.description;
    };

    return {
      render(width: number) {
        if (submenu) return submenu.render(width);

        const current = model();
        const selectedId =
          selection.area === "globals" ? undefined : selection.widgetId;
        chipSpans = new Map();

        const lines = [
          truncateToWidth(
            theme.fg("accent", theme.bold("Fancy Footer Configuration")),
            width,
          ),
          truncateToWidth(theme.fg("dim", configPath), width),
          "",
          truncateToWidth(theme.bold("Widgets"), width),
        ];

        const gutterDigits = String(current.rows.length - 1).length;
        for (const row of current.rows) {
          const gutter = theme.fg(
            "dim",
            `${String(row.row).padStart(gutterDigits)}│ `,
          );
          if (row.ordered.length === 0) {
            lines.push(
              truncateToWidth(`${gutter}${theme.fg("dim", "(empty)")}`, width),
            );
            continue;
          }
          const contentWidth = Math.max(10, width - gutterDigits - 2);
          const mode = rowChipMode(contentWidth, row);
          const placed = placeRowChips(contentWidth, row, mode);
          lines.push(renderChipLine(width, gutter, placed, mode, selectedId));
        }

        if (current.bench.length > 0) {
          lines.push(truncateToWidth(theme.fg("dim", "hidden"), width));
          const gutter = " ".repeat(gutterDigits + 2);
          const contentWidth = Math.max(10, width - gutterDigits - 2);
          const mode =
            CHIP_MODES.find(
              (candidate) =>
                groupWidth(current.bench, candidate) <= contentWidth,
            ) ?? "icon";
          const placedBench: PlacedChip[] = [];
          let column = 0;
          for (const chip of current.bench) {
            const chipWidth = visibleWidth(chipText(chip, mode));
            placedBench.push({ chip, column, width: chipWidth });
            column += chipWidth + CHIP_GAP;
          }
          lines.push(
            renderChipLine(width, gutter, placedBench, mode, selectedId),
          );
        }

        if (selection.area !== "globals") {
          const widgetId = selection.widgetId;
          const chip =
            current.rows
              .flatMap((row) => row.ordered)
              .find((entry) => entry.widget.id === widgetId) ??
            current.bench.find((entry) => entry.widget.id === widgetId);
          if (chip) {
            const placement = chip.placement;
            const group = placement.benched
              ? current.bench
              : current.rows[placement.row]!.groups[placement.align];
            const index = group.findIndex(
              (entry) => entry.widget.id === widgetId,
            );
            const info = placement.benched
              ? "hidden"
              : `row ${placement.row} · ${placement.align} · pos ${index}${
                  placement.fill === "grow" ? " · grow" : ""
                }`;
            lines.push("");
            lines.push(
              truncateToWidth(
                `${theme.inverse(chip.widget.label)} ${theme.fg("dim", `— ${info}`)}`,
                width,
              ),
            );
          }
        }

        lines.push("");
        lines.push(truncateToWidth(theme.bold("General"), width));
        const globals = globalsItems();
        const labelWidth = Math.min(
          Math.max(...globals.map((item) => visibleWidth(item.label)), 0),
          Math.max(8, width - 12),
        );
        for (const [index, item] of globals.entries()) {
          const selected =
            selection.area === "globals" && selection.index === index;
          const prefix = selected ? theme.fg("accent", "→ ") : "  ";
          const label = truncateToWidth(item.label, labelWidth, "");
          const paddedLabel =
            label + " ".repeat(Math.max(0, labelWidth - visibleWidth(label)));
          const valueWidth = Math.max(4, width - 2 - labelWidth - 2);
          const value = truncateToWidth(item.currentValue, valueWidth, "");
          lines.push(
            truncateToWidth(
              `${prefix}${selected ? theme.fg("accent", paddedLabel) : paddedLabel}  ${selected ? theme.fg("accent", value) : theme.fg("dim", value)}`,
              width,
            ),
          );
        }

        const description = selectedDescription();
        if (description) {
          lines.push("");
          for (const line of wrapTextWithAnsi(
            description,
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
              selection.area === "globals" ? globalsHints : chipHints,
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

        if (keybindings.matches(data, "tui.select.cancel")) {
          done(undefined);
          return;
        }

        if (matchesKey(data, Key.left)) {
          moveSelectionHorizontal(-1);
        } else if (matchesKey(data, Key.right)) {
          moveSelectionHorizontal(1);
        } else if (keybindings.matches(data, "tui.select.up")) {
          moveSelectionVertical(-1);
        } else if (keybindings.matches(data, "tui.select.down")) {
          moveSelectionVertical(1);
        } else if (keybindings.matches(data, "tui.select.confirm")) {
          activateSelection();
        } else if (selection.area === "globals" && data === " ") {
          cycleGlobalValue();
        } else if (selection.area !== "globals") {
          const action = chipActions.find((entry) => entry.keys.includes(data));
          if (action) {
            action.run(selection.widgetId);
            applyDraft();
            syncSelection();
          }
        }

        tui.requestRender();
      },
    };
  });
}
