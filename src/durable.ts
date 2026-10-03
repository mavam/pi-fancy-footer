import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import type { AgentState, ConversationView, UsageState } from "@earendil-works/pi-durable";
import type { Component } from "@earendil-works/pi-tui";
import { loadFooterConfig } from "./config.ts";
import { collectGitInfo } from "./git.ts";
import { collectProviderStatus } from "./provider-status.ts";
import { renderFooterLines } from "./render.ts";
import { EMPTY_GIT_INFO, type FooterRenderContext, type GitInfo, type ProviderStatusSnapshot, type SessionUsageMetrics } from "./shared.ts";

export interface DurableFooterOptions {
  view(): ConversationView;
  model(): Model<Api> | undefined;
  providerName?(id: string): string | undefined;
  theme: Theme;
  exec: ExtensionAPI["exec"];
  requestRender(): void;
  /** Disable network quota polling when the host supplies snapshots itself. */
  providerStatus?: boolean;
}

/** Unknown after a reset/compaction until a successful response measures the new context. */
export function durableContextTokens(view: ConversationView): number | null {
  const boundary = Math.max(0, ...view.entries.filter((entry) =>
    entry.kind === "pi.compaction" || entry.kind === "pi.reset").map((entry) => entry.id));
  for (const entry of [...view.entries].reverse()) {
    const message = entry.model?.[0];
    if (entry.id < boundary || entry.kind !== "pi.assistant" || message?.role !== "assistant" ||
        message.stopReason === "aborted" || message.stopReason === "error") continue;
    return message.usage.totalTokens || message.usage.input + message.usage.output +
      message.usage.cacheRead + message.usage.cacheWrite;
  }
  return null;
}

/** Totals come from the durable usage document, including compacted history and tool spend. */
export function durableUsageMetrics(view: ConversationView): SessionUsageMetrics {
  const usage = view.docs["pi.usage"] as unknown as UsageState | undefined;
  const totals = [...Object.values(usage?.models ?? {}), ...Object.values(usage?.tools ?? {})];
  let latest: SessionUsageMetrics["latest"];
  for (const entry of [...view.entries].reverse()) {
    const message = entry.model?.[0];
    if (entry.kind !== "pi.assistant" || message?.role !== "assistant" ||
        message.stopReason === "aborted" || message.stopReason === "error") continue;
    latest = { input: message.usage.input, cacheRead: message.usage.cacheRead,
      cacheWrite: message.usage.cacheWrite, cost: message.usage.cost.total };
    break;
  }
  return {
    latest,
    totalCost: totals.reduce((sum, item) => sum + item.cost.total, 0),
    totalCacheRead: totals.reduce((sum, item) => sum + item.cacheRead, 0),
    totalCacheWrite: totals.reduce((sum, item) => sum + item.cacheWrite, 0),
  };
}

/** Mount this component in the host's existing TUI; it never creates a terminal renderer. */
export function createDurableFooter(options: DurableFooterOptions): Component & { dispose(): void; refresh(): Promise<void> } {
  let git: GitInfo = { ...EMPTY_GIT_INFO };
  let gitCwd: string | undefined;
  let statuses: ProviderStatusSnapshot[] = [];
  let config = loadFooterConfig();
  let disposed = false;
  let refreshing = false;
  let quotaRefreshed = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cwd = () => (options.view().docs["pi.agent"] as unknown as AgentState | undefined)?.cwd ?? process.cwd();
  const refresh = async () => {
    if (disposed || refreshing) return;
    refreshing = true;
    try {
      config = loadFooterConfig();
      const directory = cwd();
      const nextGit = await collectGitInfo({ exec: options.exec }, directory);
      if (disposed) return;
      git = nextGit;
      gitCwd = directory;
      if (options.providerStatus !== false && config.widgets["provider-status"]?.enabled !== false &&
          Date.now() - quotaRefreshed >= config.providerStatus.refreshMs) {
        quotaRefreshed = Date.now();
        const next = await collectProviderStatus({ exec: options.exec }, config.providerStatus);
        if (disposed) return;
        statuses = next;
      }
      options.requestRender();
    } finally {
      refreshing = false;
    }
  };
  const schedule = () => {
    if (disposed) return;
    timer = setTimeout(() => {
      void refresh().catch(() => {}).finally(schedule);
    }, config.refreshMs);
  };
  void refresh().catch(() => {}).finally(schedule);
  return {
    invalidate() {},
    refresh,
    dispose() {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
    },
    render(width) {
      if (disposed) return [];
      const view = options.view();
      const agent = view.docs["pi.agent"] as unknown as AgentState | undefined;
      const model = options.model();
      const tokens = durableContextTokens(view);
      const contextWindow = model?.contextWindow ?? 0;
      const ctx: FooterRenderContext = {
        cwd: agent?.cwd ?? process.cwd(), model, thinkingLevel: agent?.thinkingLevel ?? "off",
        getContextUsage: () => model ? {
          tokens, contextWindow, percent: tokens === null ? null : (tokens / contextWindow) * 100,
        } : undefined,
        modelRegistry: { getProviderDisplayName: (id) => options.providerName?.(id) ?? id },
      };
      return renderFooterLines(width, ctx, gitCwd === ctx.cwd ? git : { ...EMPTY_GIT_INFO },
        agent?.thinkingLevel ?? "off", options.theme, durableUsageMetrics(view), config, [], statuses);
    },
  };
}
