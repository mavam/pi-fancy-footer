import assert from "node:assert/strict";
import test from "node:test";
import { FANCY_FOOTER_WIDGET_CHANNEL } from "./api.ts";
import fancyFooter from "./index.ts";

test("the data widget listener is removed during session shutdown", async () => {
  let stopCalls = 0;
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
      if (event === "session_shutdown") shutdown = handler;
    },
  };

  fancyFooter(pi as never);
  assert.ok(shutdown);
  assert.equal(stopCalls, 0);

  await shutdown();
  assert.equal(stopCalls, 1);
});
