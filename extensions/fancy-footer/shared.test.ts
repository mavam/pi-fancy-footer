import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FOOTER_CONFIG,
  FOOTER_ICON_FAMILIES,
  FOOTER_WIDGET_IDS,
  formatTerminalHyperlink,
  getDefaultWidgetIcon,
  getWidgetSettingIcon,
  isFooterIconFamily,
} from "./shared.ts";

test("icon families provide family-specific widget icons", () => {
  assert.equal(getWidgetSettingIcon("branch", "nerd"), "\uf418");
  assert.equal(getWidgetSettingIcon("branch", "emoji"), "🌿");
  assert.equal(getWidgetSettingIcon("branch", "unicode"), "⎇");
  assert.equal(getWidgetSettingIcon("branch", "ascii"), "*");

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
});

test("formatTerminalHyperlink wraps text in an OSC 8 hyperlink", () => {
  assert.equal(
    formatTerminalHyperlink("https://github.com/org/repo/pull/42", "42"),
    "\x1b]8;;https://github.com/org/repo/pull/42\x0742\x1b]8;;\x07",
  );
  assert.equal(formatTerminalHyperlink("", "42"), "42");
});
