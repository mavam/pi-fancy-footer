import assert from "node:assert/strict";
import test from "node:test";
import { FANCY_FOOTER_WIDGET_CHANNEL } from "./api.ts";
import fancyFooter from "./index.ts";

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
