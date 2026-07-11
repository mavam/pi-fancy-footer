import {
  MAX_WIDGET_POSITION,
  MAX_WIDGET_ROW,
  clampInt,
  type FooterConfigSnapshot,
  type FooterWidgetAlign,
  type FooterWidgetFill,
} from "./shared.ts";
import {
  getWidgetOverride,
  updateWidgetOverride,
  type ConfigurableWidgetMeta,
} from "./config.ts";

export const WIDGET_ALIGNS: readonly FooterWidgetAlign[] = [
  "left",
  "middle",
  "right",
];

export interface EffectivePlacement {
  row: number;
  position: number;
  align: FooterWidgetAlign;
  fill: FooterWidgetFill;
  benched: boolean;
}

export interface LayoutChip {
  widget: ConfigurableWidgetMeta;
  placement: EffectivePlacement;
}

export interface LayoutRow {
  row: number;
  groups: Record<FooterWidgetAlign, LayoutChip[]>;
  /** Visual order: left group, then middle, then right. */
  ordered: LayoutChip[];
}

export interface LayoutModel {
  rows: LayoutRow[];
  bench: LayoutChip[];
}

export function effectivePlacement(
  config: FooterConfigSnapshot,
  widget: ConfigurableWidgetMeta,
): EffectivePlacement {
  const override = getWidgetOverride(config, widget);
  return {
    row: clampInt(override?.row ?? widget.defaults.row, 0, MAX_WIDGET_ROW),
    position: clampInt(
      override?.position ?? widget.defaults.position,
      0,
      MAX_WIDGET_POSITION,
    ),
    align: override?.align ?? widget.defaults.align,
    fill: override?.fill ?? widget.defaults.fill,
    benched: (override?.enabled ?? widget.defaults.enabled ?? true) === false,
  };
}

// Widgets keep their base order (built-ins first, then extensions) and each
// group sorts by position with a stable sort, matching prepareWidgetGroup()
// in render.ts.
export function buildLayoutModel(
  config: FooterConfigSnapshot,
  widgets: readonly ConfigurableWidgetMeta[],
): LayoutModel {
  const chips: LayoutChip[] = widgets.map((widget) => ({
    widget,
    placement: effectivePlacement(config, widget),
  }));

  const bench = chips.filter((chip) => chip.placement.benched);
  const placed = chips.filter((chip) => !chip.placement.benched);

  const highestRow = placed.reduce(
    (acc, chip) => Math.max(acc, chip.placement.row),
    1,
  );

  const rows: LayoutRow[] = [];
  for (let row = 0; row <= highestRow; row++) {
    const groups: Record<FooterWidgetAlign, LayoutChip[]> = {
      left: [],
      middle: [],
      right: [],
    };
    for (const chip of placed) {
      if (chip.placement.row === row) groups[chip.placement.align].push(chip);
    }
    for (const align of WIDGET_ALIGNS) {
      groups[align].sort((a, b) => a.placement.position - b.placement.position);
    }
    rows.push({
      row,
      groups,
      ordered: [...groups.left, ...groups.middle, ...groups.right],
    });
  }

  return { rows, bench };
}

function findChip(model: LayoutModel, widgetId: string): LayoutChip | undefined {
  for (const row of model.rows) {
    const chip = row.ordered.find((entry) => entry.widget.id === widgetId);
    if (chip) return chip;
  }
  return model.bench.find((entry) => entry.widget.id === widgetId);
}

// A widget's (row, align, position) triple is only removed from its override
// when all three equal its defaults: default positions are sparse and shared
// across widgets, so pruning a single key could reorder its group.
function setPlacement(
  config: FooterConfigSnapshot,
  widget: ConfigurableWidgetMeta,
  placement: { row: number; align: FooterWidgetAlign; position: number },
): void {
  updateWidgetOverride(config, widget, (override) => {
    if (
      placement.row === widget.defaults.row &&
      placement.align === widget.defaults.align &&
      placement.position === widget.defaults.position
    ) {
      delete override.row;
      delete override.align;
      delete override.position;
      return;
    }
    override.row = placement.row;
    override.align = placement.align;
    override.position = placement.position;
  });
}

// When the group is exactly its default members in default order, restore
// the default (possibly sparse, non-zero-based) positions so setPlacement
// prunes the overrides and the config file stays minimal. Otherwise assign
// dense positions 0..n-1.
function renumberGroup(
  config: FooterConfigSnapshot,
  group: readonly LayoutChip[],
  row: number,
  align: FooterWidgetAlign,
): void {
  const isDefaultGroup = group.every(
    (chip, index) =>
      chip.widget.defaults.row === row &&
      chip.widget.defaults.align === align &&
      (index === 0 ||
        group[index - 1]!.widget.defaults.position <
          chip.widget.defaults.position),
  );

  for (const [index, chip] of group.entries()) {
    setPlacement(config, chip.widget, {
      row,
      align,
      position: isDefaultGroup ? chip.widget.defaults.position : index,
    });
  }
}

export function moveHorizontal(
  config: FooterConfigSnapshot,
  widgets: readonly ConfigurableWidgetMeta[],
  widgetId: string,
  direction: -1 | 1,
): void {
  const model = buildLayoutModel(config, widgets);
  const chip = findChip(model, widgetId);
  if (!chip || chip.placement.benched) return;

  const { row, align } = chip.placement;
  const group = [...model.rows[row]!.groups[align]];
  const index = group.findIndex((entry) => entry.widget.id === widgetId);
  const target = index + direction;

  if (target >= 0 && target < group.length) {
    [group[index], group[target]] = [group[target]!, group[index]!];
    renumberGroup(config, group, row, align);
    return;
  }

  const nextAlign =
    WIDGET_ALIGNS[WIDGET_ALIGNS.indexOf(align) + direction];
  if (!nextAlign) return;

  group.splice(index, 1);
  renumberGroup(config, group, row, align);

  const neighbor = [...model.rows[row]!.groups[nextAlign]];
  if (direction === 1) neighbor.unshift(chip);
  else neighbor.push(chip);
  renumberGroup(config, neighbor, row, nextAlign);
}

export function moveVertical(
  config: FooterConfigSnapshot,
  widgets: readonly ConfigurableWidgetMeta[],
  widgetId: string,
  direction: -1 | 1,
): void {
  const model = buildLayoutModel(config, widgets);
  const chip = findChip(model, widgetId);
  if (!chip) return;

  if (chip.placement.benched) {
    if (direction === -1) unbenchToBottomRow(config, widgets, widgetId);
    return;
  }

  const { row, align } = chip.placement;
  const bottomRow = model.rows.length - 1;

  if (direction === 1 && row === bottomRow) {
    setBenched(config, widgets, widgetId, true);
    return;
  }

  const targetRow = clampInt(row + direction, 0, MAX_WIDGET_ROW);
  if (targetRow === row) return;

  const source = model.rows[row]!.groups[align].filter(
    (entry) => entry.widget.id !== widgetId,
  );
  renumberGroup(config, source, row, align);

  const target = [...(model.rows[targetRow]?.groups[align] ?? []), chip];
  renumberGroup(config, target, targetRow, align);
}

export function cycleAlign(
  config: FooterConfigSnapshot,
  widgets: readonly ConfigurableWidgetMeta[],
  widgetId: string,
): void {
  const model = buildLayoutModel(config, widgets);
  const chip = findChip(model, widgetId);
  if (!chip || chip.placement.benched) return;

  const { row, align } = chip.placement;
  const nextAlign =
    WIDGET_ALIGNS[(WIDGET_ALIGNS.indexOf(align) + 1) % WIDGET_ALIGNS.length]!;

  const source = model.rows[row]!.groups[align].filter(
    (entry) => entry.widget.id !== widgetId,
  );
  renumberGroup(config, source, row, align);

  const target = [...model.rows[row]!.groups[nextAlign], chip];
  renumberGroup(config, target, row, nextAlign);
}

export function toggleFill(
  config: FooterConfigSnapshot,
  widgets: readonly ConfigurableWidgetMeta[],
  widgetId: string,
): void {
  const widget = widgets.find((entry) => entry.id === widgetId);
  if (!widget) return;

  const current = effectivePlacement(config, widget).fill;
  const next: FooterWidgetFill = current === "grow" ? "none" : "grow";
  updateWidgetOverride(config, widget, (override) => {
    if (next === widget.defaults.fill) delete override.fill;
    else override.fill = next;
  });
}

// Benching only touches `enabled`, so a bench round-trip restores the exact
// placement. The override is dropped when it matches the widget's default
// enabled state.
export function setBenched(
  config: FooterConfigSnapshot,
  widgets: readonly ConfigurableWidgetMeta[],
  widgetId: string,
  benched: boolean,
): void {
  const widget = widgets.find((entry) => entry.id === widgetId);
  if (!widget) return;

  const defaultEnabled = widget.defaults.enabled ?? true;
  updateWidgetOverride(config, widget, (override) => {
    if (benched === !defaultEnabled) delete override.enabled;
    else override.enabled = !benched;
  });
}

// "u" from the bench re-enables the widget on the bottom-most row so it
// reappears adjacent to the bench, at the end of its alignment group. A
// widget already stored on that row keeps its exact placement.
function unbenchToBottomRow(
  config: FooterConfigSnapshot,
  widgets: readonly ConfigurableWidgetMeta[],
  widgetId: string,
): void {
  setBenched(config, widgets, widgetId, false);

  const model = buildLayoutModel(config, widgets);
  const chip = findChip(model, widgetId);
  if (!chip) return;

  const bottomRow = model.rows.length - 1;
  if (chip.placement.row === bottomRow) return;

  const source = model.rows[chip.placement.row]!.groups[
    chip.placement.align
  ].filter((entry) => entry.widget.id !== widgetId);
  renumberGroup(config, source, chip.placement.row, chip.placement.align);

  const target = [
    ...model.rows[bottomRow]!.groups[chip.placement.align],
    chip,
  ];
  renumberGroup(config, target, bottomRow, chip.placement.align);
}
