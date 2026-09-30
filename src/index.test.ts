import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
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

async function usageFooter(t: TestContext) {
  const agentDir = mkdtempSync(join(tmpdir(), "fancy-footer-usage-"));
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  t.after(() => {
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(agentDir, { recursive: true, force: true });
  });
  writeFileSync(
    join(agentDir, "fancy-footer.json"),
    JSON.stringify({
      iconFamily: "ascii",
      widgets: { "provider-status": { enabled: false } },
    }),
  );
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const entries: unknown[] = [];
  let branch = entries;
  let contextUsage: {
    contextWindow: number;
    tokens: number | null;
    percent: number | null;
  } = { contextWindow: 200_000, tokens: 10_000, percent: 5 };
  const handlers = new Map<string, (...args: never[]) => unknown>();
  let footer: { render(width: number): string[]; dispose(): void } | undefined;
  let renderRequests = 0;
  let output = "";
  let gitRequests = 0;
  const pi = {
    events: { emit() {}, on: () => () => {} },
    registerCommand() {},
    on(event: string, handler: (...args: never[]) => unknown) {
      handlers.set(event, handler);
    },
    getThinkingLevel: () => "off",
    exec() {
      gitRequests += 1;
      // Keep the initial Git refresh pending: usage must update independently.
      return new Promise(() => {});
    },
  };

  fancyFooter(pi as never);
  await handlers.get("session_start")?.(
    {} as never,
    {
      hasUI: true,
      cwd: "/repo",
      getContextUsage: () => contextUsage,
      sessionManager: {
        getSessionId: () => "session",
        getLeafId: () => (branch.at(-1) as { id?: string } | undefined)?.id ?? null,
        getEntryCount: () => entries.length,
        getEntries: () => entries,
        getBranch: () => branch,
      },
      ui: {
        setFooter(factory: (...args: never[]) => typeof footer) {
          footer = factory(
            {
              requestRender() {
                renderRequests += 1;
                output = footer!.render(120).join("\n");
              },
            } as never,
            { fg: (_color: string, text: string) => text } as never,
            { onBranchChange: () => () => {} } as never,
          );
        },
      },
    } as never,
  );
  assert.ok(footer);
  const installedFooter = footer;
  t.after(() => installedFooter.dispose());

  return {
    entries,
    emit: (event: string, data = {}) =>
      handlers.get(event)?.(data as never, {} as never),
    append(message: unknown) {
      entries.push({ type: "message", id: String(entries.length), message });
    },
    navigate(next: unknown[]) {
      branch = next;
    },
    compact() {
      contextUsage = { contextWindow: 200_000, tokens: null, percent: null };
    },
    render: () => installedFooter.render(120).join("\n"),
    dispose: () => installedFooter.dispose(),
    get output() {
      return output;
    },
    get renderRequests() {
      return renderRequests;
    },
    get gitRequests() {
      return gitRequests;
    },
  };
}

const mainUsage = {
  input: 1000,
  cacheRead: 8000,
  cacheWrite: 1000,
  cost: { total: 1 },
};

test("completed assistant and tool messages refresh after persistence, without Git", async (t) => {
  const ui = await usageFooter(t);
  const assistant = { role: "assistant", usage: mainUsage };
  ui.emit("message_end", { message: assistant });
  assert.equal(ui.renderRequests, 0);
  ui.append(assistant);
  t.mock.timers.tick(0);
  assert.equal(ui.renderRequests, 1);
  assert.match(ui.output, /R8k/);
  assert.match(ui.output, /H80\.0%/);
  assert.match(ui.output, /\$1\.00/);

  const tool = {
    role: "toolResult",
    usage: { input: 0, cacheRead: 36_000, cacheWrite: 4500, cost: { total: 2 } },
  };
  for (let index = 0; index < 2; index += 1) {
    ui.emit("message_end", { message: tool });
    ui.append(tool);
  }
  assert.equal(ui.renderRequests, 1);
  t.mock.timers.tick(0);
  assert.equal(ui.renderRequests, 2);
  assert.equal(ui.gitRequests, 1);
  assert.match(ui.output, /R80k/);
  assert.match(ui.output, /W10k/);
  assert.match(ui.output, /\$5\.00/);
  assert.match(ui.output, /H80\.0%/);
  assert.match(ui.output, /5%/);
});

test("rendering picks up cache warming without changing the main prompt metrics", async (t) => {
  const ui = await usageFooter(t);
  ui.append({ role: "assistant", usage: mainUsage });
  assert.match(ui.render(), /R8k/);

  ui.entries.push({
    type: "usage",
    id: "warm",
    kind: "cache_warm",
    usage: { input: 0, cacheRead: 12_000, cacheWrite: 2000, cost: { total: 2 } },
  });
  const output = ui.render();
  assert.match(output, /R20k/);
  assert.match(output, /W3k/);
  assert.match(output, /\$3\.00/);
  assert.match(output, /H80\.0%/);
  assert.match(output, /5%/);
});

test("tree navigation and compaction refresh totals and branch-local prompt metrics", async (t) => {
  const ui = await usageFooter(t);
  ui.append({ role: "assistant", usage: mainUsage });
  const originalBranch = [...ui.entries];
  ui.append({
    role: "assistant",
    usage: { input: 5000, cacheRead: 4000, cacheWrite: 1000, cost: { total: 2 } },
  });
  assert.match(ui.render(), /H40\.0%/);

  ui.navigate(originalBranch);
  ui.emit("session_tree");
  assert.equal(ui.renderRequests, 1);
  assert.match(ui.output, /H80\.0%/);
  assert.match(ui.output, /R12k/);
  assert.match(ui.output, /\$3\.00/);

  const compaction = {
    type: "compaction",
    id: "compact",
    usage: { cacheRead: 3000, cacheWrite: 0, cost: { total: 4 } },
  };
  ui.entries.push(compaction);
  ui.navigate([...originalBranch, compaction]);
  ui.compact();
  ui.emit("session_compact");
  assert.equal(ui.renderRequests, 2);
  assert.match(ui.output, /R15k/);
  assert.match(ui.output, /\$7\.00/);
  assert.match(ui.output, /H80\.0%/);
  assert.match(ui.output, /0%/);
});

test("usage render requests ignore unrelated messages and stop after disposal", async (t) => {
  const ui = await usageFooter(t);
  ui.emit("message_end", { message: { role: "user" } });
  t.mock.timers.tick(0);
  assert.equal(ui.renderRequests, 0);

  ui.emit("message_end", { message: { role: "assistant", usage: mainUsage } });
  ui.dispose();
  t.mock.timers.tick(0);
  assert.equal(ui.renderRequests, 0);

  ui.emit("message_end", { message: { role: "toolResult" } });
  ui.emit("session_tree");
  t.mock.timers.tick(0);
  assert.equal(ui.renderRequests, 0);
});

test("usage notifications remain safe without an interactive footer", async () => {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  fancyFooter({
    events: { emit() {}, on: () => () => {} },
    registerCommand() {},
    on: (event: string, handler: (...args: never[]) => unknown) =>
      handlers.set(event, handler),
  } as never);

  await handlers.get("session_start")?.({} as never, { hasUI: false } as never);
  handlers.get("message_end")?.({ message: { role: "assistant" } } as never);
  handlers.get("message_end")?.({ message: { role: "toolResult" } } as never);
  handlers.get("session_tree")?.({} as never);
});
