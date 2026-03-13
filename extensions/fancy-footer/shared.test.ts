import assert from "node:assert/strict";
import test from "node:test";
import { getDefaultWidgetIcon, getWidgetSettingIcon, isFooterIconFamily } from "./shared.ts";

test("icon families provide family-specific widget icons", () => {
  assert.equal(getWidgetSettingIcon("branch", "nerd"), "");
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
