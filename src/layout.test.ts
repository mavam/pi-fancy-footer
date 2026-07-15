import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FOOTER_CONFIG,
  MAX_WIDGET_ROW,
  type FooterConfigSnapshot,
  type NormalizedFancyFooterWidgetContribution,
} from "./shared.ts";
import { buildConfigurableWidgets } from "./config.ts";
import {
  buildLayoutModel,
  cycleAlign,
  effectivePlacement,
  moveHorizontal,
  moveVertical,
  setBenched,
  toggleFill,
} from "./layout.ts";

function makeConfig(): FooterConfigSnapshot {
  return structuredClone(DEFAULT_FOOTER_CONFIG);
}

function makeExtensionWidget(
  id: string,
  defaults: NormalizedFancyFooterWidgetContribution["defaults"],
): NormalizedFancyFooterWidgetContribution {
  return {
    id,
    label: id,
    description: `Extension widget ${id}`,
    defaults,
    render: () => "",
  };
}

function builtInWidgets(config: FooterConfigSnapshot) {
  return buildConfigurableWidgets(config, []);
}

function ids(chips: readonly { widget: { id: string } }[]): string[] {
  return chips.map((chip) => chip.widget.id);
}

// ── buildLayoutModel ───────────────────────────────────────────────────

test("buildLayoutModel groups default widgets like the renderer", () => {
  const config = makeConfig();
  const model = buildLayoutModel(config, builtInWidgets(config));

  assert.equal(model.rows.length, 2);
  // context-capacity and commit are hidden by default and start on the bench.
  assert.deepEqual(ids(model.bench), ["context-capacity", "commit"]);
  assert.deepEqual(ids(model.rows[0]!.groups.left), [
    "context-bar",
    "provider-status",
  ]);
  assert.deepEqual(ids(model.rows[0]!.groups.right), [
    "cache-read",
    "cache-write",
    "cache-hit-rate",
    "total-cost",
  ]);
  assert.deepEqual(ids(model.rows[1]!.groups.left), [
    "location",
    "branch",
    "pull-request",
    "pull-request-review-threads",
    "pull-request-ci-status",
    "diff-added",
    "diff-removed",
    "git-status",
  ]);
  assert.deepEqual(ids(model.rows[1]!.groups.right), ["model", "thinking"]);
  assert.deepEqual(
    ids(model.rows[1]!.ordered),
    [...ids(model.rows[1]!.groups.left), "model", "thinking"],
  );
});

test("buildLayoutModel breaks position ties by base order", () => {
  const config = makeConfig();
  const widgets = buildConfigurableWidgets(config, [
    makeExtensionWidget("ext-a", {
      row: 1,
      position: 0,
      align: "left",
      fill: "none",
    }),
  ]);

  const model = buildLayoutModel(config, widgets);
  // "location" also defaults to row 1 / left / position 0 and precedes the
  // extension widget in base order.
  assert.deepEqual(ids(model.rows[1]!.groups.left).slice(0, 2), [
    "location",
    "ext-a",
  ]);
});

test("buildLayoutModel puts disabled widgets on the bench", () => {
  const config = makeConfig();
  config.widgets["pull-request"] = { enabled: false };
  const model = buildLayoutModel(config, builtInWidgets(config));

  assert.deepEqual(ids(model.bench), [
    "context-capacity",
    "commit",
    "pull-request",
  ]);
  assert.ok(!ids(model.rows[1]!.groups.left).includes("pull-request"));
});

// ── moveHorizontal ─────────────────────────────────────────────────────

test("moveHorizontal swaps within a group", () => {
  const config = makeConfig();
  const widgets = builtInWidgets(config);
  moveHorizontal(config, widgets, "branch", 1);

  const model = buildLayoutModel(config, widgets);
  assert.deepEqual(ids(model.rows[1]!.groups.left).slice(0, 3), [
    "location",
    "pull-request",
    "branch",
  ]);
});

test("moveHorizontal returns to a minimal config when moved back", () => {
  const config = makeConfig();
  const widgets = builtInWidgets(config);
  moveHorizontal(config, widgets, "branch", 1);
  moveHorizontal(config, widgets, "branch", -1);

  assert.deepEqual(config.widgets, {});
});

test("moveHorizontal flows across alignment groups at the edge", () => {
  const config = makeConfig();
  const widgets = builtInWidgets(config);
  // git-status is the right edge of row 1's left group; the middle group is
  // empty, so it should land there.
  moveHorizontal(config, widgets, "git-status", 1);

  const model = buildLayoutModel(config, widgets);
  assert.ok(!ids(model.rows[1]!.groups.left).includes("git-status"));
  assert.deepEqual(ids(model.rows[1]!.groups.middle), ["git-status"]);
});

test("moveHorizontal enters the far end of the neighboring group", () => {
  const config = makeConfig();
  const widgets = builtInWidgets(config);
  // "model" is the left edge of row 1's right group; moving left lands at
  // the end of the (empty) middle group, then again into the left group end.
  moveHorizontal(config, widgets, "model", -1);
  moveHorizontal(config, widgets, "model", -1);

  const model = buildLayoutModel(config, widgets);
  const left = ids(model.rows[1]!.groups.left);
  assert.equal(left[left.length - 1], "model");
  assert.deepEqual(ids(model.rows[1]!.groups.right), ["thinking"]);
});

test("moveHorizontal is a no-op at the outer edges", () => {
  const config = makeConfig();
  const widgets = builtInWidgets(config);
  moveHorizontal(config, widgets, "location", -1);
  moveHorizontal(config, widgets, "thinking", 1);

  assert.deepEqual(config.widgets, {});
});

test("moveHorizontal renumbers groups densely when order is custom", () => {
  const config = makeConfig();
  const widgets = builtInWidgets(config);
  moveHorizontal(config, widgets, "thinking", -1);

  // Right group of row 1 is now [thinking, model]; not the default order, so
  // positions are dense.
  assert.deepEqual(config.widgets.thinking, {
    row: 1,
    align: "right",
    position: 0,
  });
  assert.deepEqual(config.widgets.model, {
    row: 1,
    align: "right",
    position: 1,
  });
});

// ── moveVertical ───────────────────────────────────────────────────────

test("moveVertical moves a widget to the same-align group of the next row", () => {
  const config = makeConfig();
  const widgets = builtInWidgets(config);
  moveVertical(config, widgets, "branch", -1);

  const model = buildLayoutModel(config, widgets);
  const left = ids(model.rows[0]!.groups.left);
  assert.equal(left[left.length - 1], "branch");
  assert.ok(!ids(model.rows[1]!.groups.left).includes("branch"));
});

test("moveVertical round-trip restores a minimal config", () => {
  const config = makeConfig();
  const widgets = builtInWidgets(config);
  moveVertical(config, widgets, "branch", -1);
  moveVertical(config, widgets, "branch", 1);
  // Coming back down appends at the end of the left group; walk it back to
  // its default slot right after "location".
  for (let i = 0; i < 6; i++) moveHorizontal(config, widgets, "branch", -1);

  const model = buildLayoutModel(config, widgets);
  assert.deepEqual(ids(model.rows[1]!.groups.left).slice(0, 3), [
    "location",
    "branch",
    "pull-request",
  ]);
  assert.deepEqual(config.widgets, {});
});

test("moveVertical benches a widget moved below the bottom row", () => {
  const config = makeConfig();
  const widgets = builtInWidgets(config);
  moveVertical(config, widgets, "branch", 1);

  assert.deepEqual(config.widgets.branch, { enabled: false });
  const model = buildLayoutModel(config, widgets);
  assert.deepEqual(ids(model.bench), [
    "context-capacity",
    "branch",
    "commit",
  ]);
});

test("moveVertical bench round-trip preserves placement", () => {
  const config = makeConfig();
  const widgets = builtInWidgets(config);
  moveVertical(config, widgets, "branch", 1);
  moveVertical(config, widgets, "branch", -1);

  assert.deepEqual(config.widgets, {});
});

test("moveVertical unbenches onto the bottom-most row", () => {
  const config = makeConfig();
  const widgets = builtInWidgets(config);
  // context-bar lives on row 0; bench it, then bring it back up.
  setBenched(config, widgets, "context-bar", true);
  moveVertical(config, widgets, "context-bar", -1);

  const model = buildLayoutModel(config, widgets);
  assert.deepEqual(ids(model.bench), ["context-capacity", "commit"]);
  const left = ids(model.rows[1]!.groups.left);
  assert.equal(left[left.length - 1], "context-bar");
});

test("setBenched round-trips a default-hidden widget with a minimal override", () => {
  const config = makeConfig();
  const widgets = builtInWidgets(config);

  setBenched(config, widgets, "context-capacity", false);
  assert.deepEqual(config.widgets["context-capacity"], { enabled: true });
  let model = buildLayoutModel(config, widgets);
  assert.deepEqual(ids(model.bench), ["commit"]);
  assert.deepEqual(ids(model.rows[0]!.groups.left), [
    "context-bar",
    "context-capacity",
    "provider-status",
  ]);

  setBenched(config, widgets, "context-capacity", true);
  assert.deepEqual(config.widgets, {});
  model = buildLayoutModel(config, widgets);
  assert.deepEqual(ids(model.bench), ["context-capacity", "commit"]);
});

test("moveVertical clamps at row 0 and MAX_WIDGET_ROW", () => {
  const config = makeConfig();
  const widgets = builtInWidgets(config);
  moveVertical(config, widgets, "context-bar", -1);
  assert.deepEqual(config.widgets, {});

  config.widgets.branch = { row: MAX_WIDGET_ROW };
  moveVertical(config, widgets, "branch", 1);
  assert.deepEqual(config.widgets.branch, { enabled: false, row: MAX_WIDGET_ROW });
});

// ── cycleAlign ─────────────────────────────────────────────────────────

test("cycleAlign moves through left, middle, right, and back", () => {
  const config = makeConfig();
  const widgets = builtInWidgets(config);

  cycleAlign(config, widgets, "branch");
  let model = buildLayoutModel(config, widgets);
  assert.deepEqual(ids(model.rows[1]!.groups.middle), ["branch"]);

  cycleAlign(config, widgets, "branch");
  model = buildLayoutModel(config, widgets);
  const right = ids(model.rows[1]!.groups.right);
  assert.equal(right[right.length - 1], "branch");

  cycleAlign(config, widgets, "branch");
  model = buildLayoutModel(config, widgets);
  const left = ids(model.rows[1]!.groups.left);
  assert.equal(left[left.length - 1], "branch");
});

// ── toggleFill ─────────────────────────────────────────────────────────

test("toggleFill flips fill and prunes at the default", () => {
  const config = makeConfig();
  const widgets = builtInWidgets(config);

  toggleFill(config, widgets, "context-bar");
  assert.deepEqual(config.widgets["context-bar"], { fill: "grow" });

  toggleFill(config, widgets, "context-bar");
  assert.deepEqual(config.widgets, {});
});

// ── setBenched ─────────────────────────────────────────────────────────

test("setBenched toggle is lossless", () => {
  const config = makeConfig();
  const widgets = builtInWidgets(config);
  moveVertical(config, widgets, "branch", -1);
  const before = structuredClone(config.widgets);

  setBenched(config, widgets, "branch", true);
  setBenched(config, widgets, "branch", false);

  assert.deepEqual(config.widgets, before);
});

// ── extension widgets ──────────────────────────────────────────────────

test("extension widget mutations land in extensionWidgets", () => {
  const config = makeConfig();
  const widgets = buildConfigurableWidgets(config, [
    makeExtensionWidget("ext-a", {
      row: 1,
      position: 9,
      align: "left",
      fill: "none",
    }),
  ]);

  moveVertical(config, widgets, "ext-a", -1);

  assert.deepEqual(config.widgets, {});
  assert.equal(config.extensionWidgets["ext-a"]!.row, 0);
  assert.equal(config.extensionWidgets["ext-a"]!.align, "left");
});

test("effectivePlacement reflects overrides and defaults", () => {
  const config = makeConfig();
  const widgets = builtInWidgets(config);
  const branch = widgets.find((widget) => widget.id === "branch")!;

  assert.deepEqual(effectivePlacement(config, branch), {
    row: 1,
    position: 1,
    align: "left",
    fill: "none",
    benched: false,
  });

  config.widgets.branch = { row: 0, align: "right", enabled: false };
  assert.deepEqual(effectivePlacement(config, branch), {
    row: 0,
    position: 1,
    align: "right",
    fill: "none",
    benched: true,
  });
});
