import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FOOTER_CONFIG,
  FOOTER_ICON_FAMILIES,
  FOOTER_WIDGET_IDS,
  closeOpenTerminalHyperlinks,
  formatTerminalHyperlink,
  buildGauge,
  getGaugeStyle,
  getDefaultWidgetIcon,
  getThinkingLevelFromEntries,
  getWidgetSettingIcon,
  isFooterIconFamily,
  resolveFancyFooterWidgetIcon,
  widgetSummary,
  type FooterConfigSnapshot,
} from "./shared.ts";

test("icon families provide family-specific widget icons", () => {
  assert.equal(getWidgetSettingIcon("branch", "nerd"), "\uf418");
  assert.equal(getWidgetSettingIcon("branch", "emoji"), "🌿");
  assert.equal(getWidgetSettingIcon("branch", "unicode"), "⎇");
  assert.equal(getWidgetSettingIcon("branch", "ascii"), "*");
  assert.equal(getWidgetSettingIcon("model", "nerd"), "\u{f06a9}");
  assert.equal(getWidgetSettingIcon("thinking", "nerd"), "\u{f09d1}");
  assert.equal(getWidgetSettingIcon("total-cost", "nerd"), "\u{f01c1}");

  assert.equal(isFooterIconFamily("emoji"), true);
  assert.equal(isFooterIconFamily("bogus"), false);
});

test("default widget icons honor widgets without built-in footer icons", () => {
  assert.deepEqual(getDefaultWidgetIcon("branch", "ascii"), {
    text: "*",
    color: "text",
  });
  assert.equal(getDefaultWidgetIcon("git-status", "emoji"), undefined);
});

test("isFooterIconFamily accepts all valid families and rejects invalid ones", () => {
  for (const family of FOOTER_ICON_FAMILIES) {
    assert.equal(
      isFooterIconFamily(family),
      true,
      `expected '${family}' to be valid`,
    );
  }
  assert.equal(isFooterIconFamily("bogus"), false);
  assert.equal(isFooterIconFamily(""), false);
  assert.equal(isFooterIconFamily(42), false);
  assert.equal(isFooterIconFamily(null), false);
});

test("every widget returns a non-empty icon for every icon family", () => {
  for (const family of FOOTER_ICON_FAMILIES) {
    for (const widgetId of FOOTER_WIDGET_IDS) {
      const icon = getWidgetSettingIcon(widgetId, family);
      assert.ok(
        icon.length > 0,
        `${widgetId}/${family} should have a non-empty icon`,
      );
    }
  }
});

test("DEFAULT_FOOTER_CONFIG uses nerd as the default icon family", () => {
  assert.equal(DEFAULT_FOOTER_CONFIG.iconFamily, "nerd");
  assert.deepEqual(DEFAULT_FOOTER_CONFIG.extensionWidgets, {});
});

test("buildGauge fills cells with the remaining share", () => {
  const style = getGaugeStyle("parallelograms");

  assert.deepEqual(buildGauge(80, style, 5), {
    filledGlyphs: "▰▰▰▰",
    emptyGlyphs: "▱",
    percentText: "80%",
    color: "success",
  });
  assert.deepEqual(buildGauge(10, style, 5), {
    filledGlyphs: "▰",
    emptyGlyphs: "▱▱▱▱",
    percentText: "10%",
    color: "error",
  });
});

test("buildGauge keeps at least one cell visible near the edges", () => {
  const style = getGaugeStyle("parallelograms");

  assert.equal(buildGauge(1, style, 5).filledGlyphs, "▰");
  assert.equal(buildGauge(99, style, 5).emptyGlyphs, "▱");
  assert.equal(buildGauge(0, style, 5).filledGlyphs, "");
  assert.equal(buildGauge(100, style, 5).emptyGlyphs, "");
});

test("resolveFancyFooterWidgetIcon resolves icon strings and family maps", () => {
  assert.deepEqual(resolveFancyFooterWidgetIcon("X", "ascii"), {
    text: "X",
    color: "text",
  });
  assert.deepEqual(
    resolveFancyFooterWidgetIcon({ ascii: ">", unicode: "→" }, "unicode"),
    { text: "→", color: "text" },
  );
  assert.equal(resolveFancyFooterWidgetIcon(false, "emoji"), undefined);
});

test("formatTerminalHyperlink wraps text in an OSC 8 hyperlink", () => {
  assert.equal(
    formatTerminalHyperlink("https://github.com/org/repo/pull/42", "42"),
    "\x1b]8;;https://github.com/org/repo/pull/42\x0742\x1b]8;;\x07",
  );
  assert.equal(formatTerminalHyperlink("", "42"), "42");
});

test("closeOpenTerminalHyperlinks closes truncated OSC 8 links before the suffix", () => {
  assert.equal(
    closeOpenTerminalHyperlinks(
      "\x1b]8;;https://github.com/org/repo/pull/42\x0742\x1b[0m...",
      "\x1b[0m...",
    ),
    "\x1b]8;;https://github.com/org/repo/pull/42\x0742\x1b]8;;\x07\x1b[0m...",
  );
  assert.equal(
    closeOpenTerminalHyperlinks(
      "\x1b]8;;https://github.com/org/repo/pull/42\x0742\x1b]8;;\x07",
    ),
    "\x1b]8;;https://github.com/org/repo/pull/42\x0742\x1b]8;;\x07",
  );
});

test("getThinkingLevelFromEntries prefers the latest thinking change", () => {
  assert.equal(
    getThinkingLevelFromEntries(
      [
        { type: "thinking_level_change", thinkingLevel: "low" },
        { type: "message" },
        { type: "thinking_level_change", thinkingLevel: "high" },
      ],
      "off",
    ),
    "high",
  );
});

test("getThinkingLevelFromEntries falls back when the session has no change", () => {
  assert.equal(getThinkingLevelFromEntries([], "high"), "high");
  assert.equal(
    getThinkingLevelFromEntries([{ type: "message" }], "off"),
    "off",
  );
});

// ── widgetSummary ──────────────────────────────────────────────────────

function withWidgets(
  widgets: FooterConfigSnapshot["widgets"],
): FooterConfigSnapshot {
  return { ...DEFAULT_FOOTER_CONFIG, widgets };
}

test("widgetSummary returns 'default' when no override exists", () => {
  assert.equal(widgetSummary(DEFAULT_FOOTER_CONFIG, "model"), "default");
  assert.equal(widgetSummary(DEFAULT_FOOTER_CONFIG, "context-bar"), "default");
});

test("widgetSummary returns 'default' when override matches built-in defaults", () => {
  // context-bar defaults: row 0, position 0, align left, fill none
  const config = withWidgets({
    "context-bar": { row: 0, position: 0, align: "left", fill: "none" },
  });
  assert.equal(widgetSummary(config, "context-bar"), "default");
});

test("widgetSummary shows only deltas from defaults", () => {
  // context-bar default: row 0, position 0, left, none
  // Only icon hidden is a real change.
  assert.equal(
    widgetSummary(
      withWidgets({ "context-bar": { icon: "hide" } }),
      "context-bar",
    ),
    "icon:hidden",
  );

  // Move context-bar to a non-default location.
  assert.equal(
    widgetSummary(
      withWidgets({
        "context-bar": {
          row: 1,
          position: 3,
          align: "middle",
          icon: "hide",
        },
      }),
      "context-bar",
    ),
    "row:1 pos:3 align:middle icon:hidden",
  );
});

test("widgetSummary shows enabled/disabled state", () => {
  assert.equal(
    widgetSummary(
      withWidgets({ "total-cost": { enabled: false } }),
      "total-cost",
    ),
    "off",
  );
  assert.equal(
    widgetSummary(withWidgets({ model: { enabled: true } }), "model"),
    "on",
  );
});

test("widgetSummary shows color overrides", () => {
  assert.equal(
    widgetSummary(
      withWidgets({ branch: { iconColor: "muted", textColor: "muted" } }),
      "branch",
    ),
    "icon:muted text:muted",
  );
});

test("widgetSummary hides color overrides that match effective defaults", () => {
  assert.equal(
    widgetSummary(
      withWidgets({ branch: { iconColor: "text", textColor: "dim" } }),
      "branch",
    ),
    "default",
  );

  const config: FooterConfigSnapshot = {
    ...DEFAULT_FOOTER_CONFIG,
    defaultIconColor: "muted",
    defaultTextColor: "warning",
    widgets: { branch: { iconColor: "muted", textColor: "warning" } },
  };
  assert.equal(widgetSummary(config, "branch"), "default");
});

test("widgetSummary hides icon-only overrides for iconless widgets", () => {
  assert.equal(
    widgetSummary(
      withWidgets({ "git-status": { icon: "hide", iconColor: "muted" } }),
      "git-status",
    ),
    "default",
  );
  assert.equal(
    widgetSummary(
      withWidgets({ "git-status": { icon: "hide", textColor: "warning" } }),
      "git-status",
    ),
    "text:warning",
  );
});

test("widgetSummary shows icon color overrides for the PR CI status widget", () => {
  assert.equal(
    widgetSummary(
      withWidgets({ "pull-request-ci-status": { iconColor: "accent" } }),
      "pull-request-ci-status",
    ),
    "icon:accent",
  );
});

test("widgetSummary shows fill only when it differs from the widget default", () => {
  // context-bar defaults to fill:none, so fill:none is not a delta.
  assert.equal(
    widgetSummary(
      withWidgets({ "context-bar": { fill: "none" } }),
      "context-bar",
    ),
    "default",
  );
  // fill:grow on context-bar IS a delta.
  assert.equal(
    widgetSummary(
      withWidgets({ "context-bar": { fill: "grow" } }),
      "context-bar",
    ),
    "fill:grow",
  );
  // model defaults to fill:none, so fill:grow IS a delta.
  assert.equal(
    widgetSummary(withWidgets({ model: { fill: "grow" } }), "model"),
    "fill:grow",
  );
});

test("widgetSummary shows minWidth override", () => {
  assert.equal(
    widgetSummary(
      withWidgets({ "context-bar": { minWidth: 12 } }),
      "context-bar",
    ),
    "width:12",
  );
});

test("buildGauge used mode fills with consumption", () => {
  const style = getGaugeStyle("parallelograms");

  assert.deepEqual(buildGauge(80, style, 5, "used"), {
    filledGlyphs: "▰",
    emptyGlyphs: "▱▱▱▱",
    percentText: "20%",
    color: "success",
  });
  assert.deepEqual(buildGauge(10, style, 5, "used"), {
    filledGlyphs: "▰▰▰▰",
    emptyGlyphs: "▱",
    percentText: "90%",
    color: "error",
  });
  assert.equal(buildGauge(100, style, 5, "used").filledGlyphs, "");
});
