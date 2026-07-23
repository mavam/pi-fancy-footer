import assert from "node:assert/strict";
import test from "node:test";
import {
  createMicrotaskCoalescer,
  FancyFooterDataWidgetStore,
  MAX_DATA_WIDGET_TEXT_CODE_POINTS,
  resolveDataWidgetIcon,
  sanitizeDataWidgetText,
} from "./data-widgets.ts";

function upsert(
  id: string,
  text: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    protocol: 1,
    type: "upsert",
    widget: {
      id,
      content: { type: "text", text },
      ...extra,
    },
  };
}

test("data widget upserts are complete last-writer-wins snapshots", () => {
  const store = new FancyFooterDataWidgetStore();
  assert.equal(
    store.apply(
      upsert("acme.status", "first", {
        label: "First label",
        layout: { row: 0, position: 7, align: "middle", fill: "grow" },
      }),
    ),
    true,
  );
  assert.equal(
    store.apply(
      upsert("acme.status", "second", {
        label: "Second label",
        layout: { enabled: false },
      }),
    ),
    true,
  );

  const [widget] = store.values();
  assert.equal(widget?.label, "Second label");
  assert.equal(widget?.content.text, "second");
  assert.deepEqual(widget?.defaults, {
    enabled: false,
    row: 1,
    position: 0,
    align: "right",
    fill: "none",
    minWidth: undefined,
  });
});

test("empty content retains a configurable widget and remove drops it", () => {
  const store = new FancyFooterDataWidgetStore();
  assert.equal(store.apply(upsert("acme.status", "")), true);
  assert.equal(store.values().length, 1);
  assert.equal(store.values()[0]?.content.text, "");
  assert.equal(
    store.apply({ protocol: 1, type: "remove", id: "acme.status" }),
    true,
  );
  assert.deepEqual(store.values(), []);
  assert.equal(
    store.apply({ protocol: 1, type: "remove", id: "acme.status" }),
    false,
  );
});

test("data widgets sanitize terminal controls and clamp text", () => {
  assert.equal(sanitizeDataWidgetText("  hello\n\x1b[31mworld\t  "), "hello [31mworld");
  assert.equal(
    Array.from(sanitizeDataWidgetText("😀".repeat(600))).length,
    MAX_DATA_WIDGET_TEXT_CODE_POINTS,
  );

  const store = new FancyFooterDataWidgetStore();
  assert.equal(
    store.apply(
      upsert("acme.status", "ok", {
        label: " Status\nwidget ",
        icon: {
          glyphs: { unicode: "✓\n", ascii: "+" },
          color: "success",
        },
        style: { textColor: "warning" },
      }),
    ),
    true,
  );
  const [widget] = store.values();
  assert.equal(widget?.id, "acme.status");
  assert.equal(widget?.label, "Status widget");
  assert.equal(widget?.preferredTextColor, "warning");
  assert.deepEqual(resolveDataWidgetIcon(widget?.icon, "unicode"), {
    text: "✓",
    color: "success",
  });
});

test("data widgets reject invalid, conflicting, and unsupported messages", () => {
  const store = new FancyFooterDataWidgetStore();
  assert.equal(store.apply(upsert("model", "collision")), false);
  for (const id of [
    "constructor",
    "toString",
    "__proto__",
    "acme",
    "acme..status",
    " acme.status ",
  ]) {
    assert.equal(store.apply(upsert(id, "invalid ID")), false);
    assert.equal(store.apply({ protocol: 1, type: "remove", id }), false);
  }
  assert.equal(
    store.apply({ ...upsert("acme.status", "ok"), protocol: 2 }),
    false,
  );
  assert.equal(
    store.apply(upsert("acme.status", "ok", { unknown: true })),
    false,
  );
  assert.equal(
    store.apply(upsert("acme.status", "ok", { style: { textColor: "pink" } })),
    false,
  );
  assert.equal(
    store.apply(
      upsert("acme.status", "ok", {
        icon: { glyphs: { unsupported: "?" } },
      }),
    ),
    false,
  );
  assert.equal(
    store.apply(upsert("acme.status", "ok", { layout: { unknown: true } })),
    false,
  );
  assert.deepEqual(store.values(), []);
});

test("data widgets sort by their normalized labels", () => {
  const store = new FancyFooterDataWidgetStore();
  store.apply(upsert("acme.z", "z", { label: "Zulu" }));
  store.apply(upsert("acme.a", "a", { label: "Alpha" }));
  assert.deepEqual(
    store.values().map((widget) => widget.id),
    ["acme.a", "acme.z"],
  );
});

test("microtask coalescing emits once per turn", async () => {
  let calls = 0;
  const request = createMicrotaskCoalescer(() => {
    calls += 1;
  });
  request();
  request();
  request();
  assert.equal(calls, 0);
  await Promise.resolve();
  assert.equal(calls, 1);
  request();
  await Promise.resolve();
  assert.equal(calls, 2);
});
