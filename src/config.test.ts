import assert from "node:assert/strict";
import test from "node:test";
import {
  footerConfigValidationErrors,
  plainSettingValue,
} from "./config.ts";

test("footerConfigValidationErrors accepts a valid config", () => {
  assert.deepEqual(
    footerConfigValidationErrors({
      gaugeStyle: "bars",
      gaugeWidth: 8,
      widgets: { "context-bar": { row: 0 } },
    }),
    [],
  );
});

test("footerConfigValidationErrors names unknown keys with rename hints", () => {
  const errors = footerConfigValidationErrors({ contextBarStyle: "blocks" });
  assert.deepEqual(errors, [
    '  - /: unknown key "contextBarStyle" (it was renamed to "gaugeStyle")',
  ]);
});

test("footerConfigValidationErrors suggests close matches for typos", () => {
  assert.deepEqual(footerConfigValidationErrors({ guageWidth: 5 }), [
    '  - /: unknown key "guageWidth" (did you mean "gaugeWidth"?)',
  ]);
  assert.deepEqual(
    footerConfigValidationErrors({
      providerStatus: { displai: "gauge" },
    }),
    ['  - /providerStatus: unknown key "displai" (did you mean "display"?)'],
  );
  assert.deepEqual(
    footerConfigValidationErrors({
      widgets: { "context-barr": {} },
    }),
    ['  - /widgets: unknown key "context-barr" (did you mean "context-bar"?)'],
  );
  assert.deepEqual(
    footerConfigValidationErrors({
      widgets: { "context-bar": { minWdth: 3 } },
    }),
    [
      '  - /widgets/context-bar: unknown key "minWdth" (did you mean "minWidth"?)',
    ],
  );
});

test("footerConfigValidationErrors reports plain value errors with their path", () => {
  const errors = footerConfigValidationErrors({ gaugeWidth: 1000 });
  assert.equal(errors.length, 1);
  assert.match(errors[0] ?? "", /^ {2}- \/gaugeWidth: /);
});

test("footerConfigValidationErrors accepts partial gaugeColors", () => {
  assert.deepEqual(
    footerConfigValidationErrors({ gaugeColors: { ok: "dim" } }),
    [],
  );
  assert.deepEqual(footerConfigValidationErrors({ gaugeColors: { okay: "dim" } }), [
    '  - /gaugeColors: unknown key "okay" (did you mean "ok"?)',
  ]);
});

test("plainSettingValue strips preview decoration back to the option name", () => {
  assert.equal(plainSettingValue("\x1b[32m██\x1b[0m success"), "success");
  assert.equal(plainSettingValue("default"), "default");
  assert.equal(plainSettingValue("accent"), "accent");
  assert.equal(plainSettingValue("▰▰▰▱▱ parallelograms"), "parallelograms");
});
