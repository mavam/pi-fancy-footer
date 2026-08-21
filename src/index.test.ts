import assert from "node:assert/strict";
import test from "node:test";
import { FANCY_FOOTER_WIDGET_CHANNEL } from "./api.ts";
import fancyFooter from "./index.ts";

test("model and thinking changes request an immediate render", async () => {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  let createFooter: ((tui: unknown, theme: unknown, footerData: unknown) => {
    dispose(): void;
  }) | undefined;
  let renderRequests = 0;

  const pi = {
    events: {
      emit() {},
      on() {
        return () => {};
      },
    },
    registerCommand() {},
    on(event: string, handler: (...args: never[]) => unknown) {
      handlers.set(event, handler);
    },
    getThinkingLevel() {
      return "medium";
    },
    async exec() {
      return { code: 1, stdout: "", stderr: "" };
    },
  };

  fancyFooter(pi as never);

  await handlers.get("session_start")?.(
    {} as never,
    {
      hasUI: true,
      cwd: "/tmp",
      sessionManager: { getBranch: () => [] },
      ui: {
        setFooter(factory: typeof createFooter) {
          createFooter = factory;
        },
      },
    } as never,
  );

  assert.ok(createFooter);
  const footer = createFooter(
    {
      requestRender() {
        renderRequests += 1;
      },
    },
    {},
    { onBranchChange: () => () => {} },
  );

  handlers.get("model_select")?.({} as never, {} as never);
  assert.equal(renderRequests, 1);

  handlers.get("thinking_level_select")?.({} as never, {} as never);
  assert.equal(renderRequests, 2);

  footer.dispose();
});

test("compaction handling coexists with data widget listener cleanup", async () => {
  let stopCalls = 0;
  let compact: (() => Promise<void>) | undefined;
  let shutdown: (() => Promise<void>) | undefined;
  const pi = {
    events: {
      emit() {},
      on(channel: string) {
        assert.equal(channel, FANCY_FOOTER_WIDGET_CHANNEL);
        return () => {
          stopCalls += 1;
        };
      },
    },
    registerCommand() {},
    on(event: string, handler: () => Promise<void>) {
      if (event === "session_compact") compact = handler;
      if (event === "session_shutdown") shutdown = handler;
    },
  };

  fancyFooter(pi as never);
  assert.ok(compact);
  assert.ok(shutdown);
  assert.equal(stopCalls, 0);

  await compact();
  assert.equal(stopCalls, 0);

  await shutdown();
  assert.equal(stopCalls, 1);
});
