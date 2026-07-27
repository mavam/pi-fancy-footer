import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  footerConfigValidationErrors,
  getFooterConfigPath,
  plainSettingValue,
  writeFooterConfigSnapshot,
} from "./config.ts";
import { DEFAULT_FOOTER_CONFIG } from "./shared.ts";

test("footerConfigValidationErrors accepts a valid config", () => {
  assert.deepEqual(
    footerConfigValidationErrors({
      gaugeStyle: "bars",
      gaugeWidth: 8,
      providerStatus: { providers: ["openai-codex", "anthropic"] },
      widgets: { "context-bar": { row: 0 } },
    }),
    [],
  );
});

test("footerConfigValidationErrors accepts reset countdown modes", () => {
  for (const showReset of ["off", "primary", "all"]) {
    assert.deepEqual(
      footerConfigValidationErrors({ providerStatus: { showReset } }),
      [],
    );
  }
});

test("footerConfigValidationErrors rejects old and unknown reset modes", () => {
  for (const showReset of [true, false, "unknown"]) {
    const errors = footerConfigValidationErrors({
      providerStatus: { showReset },
    });
    assert.ok(errors.length > 0);
    assert.ok(
      errors.every((error) =>
        error.startsWith("  - /providerStatus/showReset: "),
      ),
    );
  }
});

test("the default provider status shows the primary reset countdown", () => {
  assert.equal(DEFAULT_FOOTER_CONFIG.providerStatus.showReset, "primary");
});

test("writeFooterConfigSnapshot preserves a non-default reset mode", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "pi-fancy-footer-config-test-"));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  });

  const config = structuredClone(DEFAULT_FOOTER_CONFIG);
  config.providerStatus.showReset = "off";
  writeFooterConfigSnapshot(config);

  const saved = JSON.parse(await readFile(getFooterConfigPath(), "utf8"));
  assert.equal(saved.providerStatus.showReset, "off");
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
