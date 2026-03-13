import { getSettingsListTheme, type ExtensionAPI, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Container, SettingsList, Text } from "@mariozechner/pi-tui";
import {
  DEFAULT_COMPACTION_SETTINGS,
  DEFAULT_FOOTER_CONFIG,
  EMPTY_GIT_INFO,
  FOOTER_WIDGET_IDS,
  MAX_FOOTER_REFRESH_MS,
  MIN_FOOTER_REFRESH_MS,
  clampInt,
  type CompactionSettingsSnapshot,
  type FooterConfigSnapshot,
  type SessionUsageMetrics,
} from "./fancy-footer/shared.ts";
import {
  cloneFooterConfig,
  coerceCompactionSettings,
  coerceRefreshMs,
  coerceWidgetColor,
  getFooterConfigPath,
  loadCompactionSettings,
  loadFooterConfig,
  rootFooterSettingsItems,
  widgetSummary,
  writeFooterConfigSnapshot,
} from "./fancy-footer/config.ts";
import { collectGitInfo, collectPullRequestInfo, shouldRefreshPullRequest } from "./fancy-footer/git.ts";
import { collectSessionUsageMetrics, renderFooterLines } from "./fancy-footer/render.ts";
import { renderBannerLines } from "./fancy-footer/banner.ts";

interface ActiveFooterControls {
  requestRender: () => void;
  reschedule: () => void;
  applyHeader: () => void;
}

export default function (pi: ExtensionAPI) {
  let compactionSettings: CompactionSettingsSnapshot = { ...DEFAULT_COMPACTION_SETTINGS };
  let footerConfig: FooterConfigSnapshot = {
    refreshMs: DEFAULT_FOOTER_CONFIG.refreshMs,
    showPiBanner: DEFAULT_FOOTER_CONFIG.showPiBanner,
    defaultTextColor: DEFAULT_FOOTER_CONFIG.defaultTextColor,
    defaultIconColor: DEFAULT_FOOTER_CONFIG.defaultIconColor,
    widgets: { ...DEFAULT_FOOTER_CONFIG.widgets },
  };

  let activeFooterControls: ActiveFooterControls | undefined;

  const installFooter = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;

    compactionSettings = loadCompactionSettings(ctx.cwd);
    footerConfig = loadFooterConfig();

    const applyHeader = () => {
      if (!footerConfig.showPiBanner) {
        ctx.ui.setHeader(undefined);
        return;
      }

      ctx.ui.setHeader((_tui, theme) => ({
        render(width: number): string[] {
          return renderBannerLines(theme, width);
        },
        invalidate() {},
      }));
    };

    applyHeader();

    ctx.ui.setFooter((tui, theme, footerData) => {
      let currentGit = { ...EMPTY_GIT_INFO };
      let usageMetrics: SessionUsageMetrics = collectSessionUsageMetrics(ctx);
      let refreshing = false;
      let refreshQueued = false;
      let pullRequestRefreshing = false;
      let pullRequestRefreshQueued = false;
      let disposed = false;
      let refreshTimer: ReturnType<typeof setTimeout> | undefined;

      const requestRender = () => {
        if (disposed) return;
        tui.requestRender();
      };

      // Keep networked PR discovery off the local git refresh path.
      const refreshPullRequest = async () => {
        if (disposed || !shouldRefreshPullRequest(currentGit)) return;
        if (pullRequestRefreshing) {
          pullRequestRefreshQueued = true;
          return;
        }

        pullRequestRefreshing = true;
        try {
          do {
            pullRequestRefreshQueued = false;

            if (!shouldRefreshPullRequest(currentGit)) continue;

            const targetBranch = currentGit.branch;
            const targetRepository = currentGit.repository;
            const targetLookupAt = currentGit.pullRequestLookupAt;
            const pullRequest = await collectPullRequestInfo(pi, ctx.cwd, targetBranch);
            if (disposed) return;
            if (currentGit.branch !== targetBranch || currentGit.repository !== targetRepository || currentGit.pullRequestLookupAt !== targetLookupAt) {
              continue;
            }

            currentGit = {
              ...currentGit,
              ...pullRequest,
            };
            requestRender();
          } while (!disposed && pullRequestRefreshQueued);
        } finally {
          pullRequestRefreshing = false;
        }
      };

      const refreshGit = async () => {
        if (disposed) return;
        if (refreshing) {
          refreshQueued = true;
          return;
        }

        refreshing = true;
        try {
          do {
            refreshQueued = false;
            compactionSettings = loadCompactionSettings(ctx.cwd);
            footerConfig = loadFooterConfig();
            usageMetrics = collectSessionUsageMetrics(ctx);

            const git = await collectGitInfo(pi, ctx.cwd, currentGit);
            if (disposed) return;
            currentGit = git;
            requestRender();
            void refreshPullRequest();
          } while (!disposed && refreshQueued);
        } finally {
          refreshing = false;
        }
      };

      const scheduleRefresh = () => {
        if (disposed) return;
        if (refreshTimer) clearTimeout(refreshTimer);

        const refreshMs = clampInt(footerConfig.refreshMs, MIN_FOOTER_REFRESH_MS, MAX_FOOTER_REFRESH_MS);
        refreshTimer = setTimeout(() => {
          void refreshGit().finally(() => {
            scheduleRefresh();
          });
        }, refreshMs);
      };

      const onBranchChange = footerData.onBranchChange(() => {
        usageMetrics = collectSessionUsageMetrics(ctx);
        requestRender();
        void refreshGit();
      });

      activeFooterControls = {
        requestRender,
        reschedule: scheduleRefresh,
        applyHeader,
      };

      void refreshGit();
      scheduleRefresh();

      return {
        invalidate() {},
        dispose() {
          disposed = true;
          onBranchChange();
          if (refreshTimer) clearTimeout(refreshTimer);
          if (activeFooterControls?.requestRender === requestRender) {
            activeFooterControls = undefined;
          }
        },
        render(width: number): string[] {
          return renderFooterLines(
            width,
            ctx,
            currentGit,
            pi.getThinkingLevel(),
            theme,
            usageMetrics,
            compactionSettings,
            footerConfig,
          );
        },
      };
    });
  };

  pi.registerCommand("fancy-footer", {
    description: "Edit fancy footer config",
    handler: async (_args, ctx) => {
      const configPath = getFooterConfigPath();

      if (!ctx.hasUI) {
        ctx.ui.notify("/fancy-footer requires interactive UI mode", "warning");
        return;
      }

      const draft = cloneFooterConfig(loadFooterConfig());

      await ctx.ui.custom((tui, theme, _kb, done) => {
        const applyDraft = () => {
          try {
            writeFooterConfigSnapshot(draft);
            footerConfig = loadFooterConfig();
            activeFooterControls?.applyHeader();
            activeFooterControls?.reschedule();
            activeFooterControls?.requestRender();
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(`Failed to save config: ${msg}`, "error");
          }
        };

        const container = new Container();
        container.addChild(new Text(theme.fg("accent", theme.bold("Fancy Footer Configuration")), 1, 0));
        container.addChild(new Text(theme.fg("dim", configPath), 1, 0));

        let settingsList: SettingsList;
        const syncRootValues = () => {
          settingsList.updateValue("refreshMs", String(draft.refreshMs));
          settingsList.updateValue("showPiBanner", draft.showPiBanner ? "on" : "off");
          settingsList.updateValue("defaultTextColor", draft.defaultTextColor);
          settingsList.updateValue("defaultIconColor", draft.defaultIconColor);
          for (const widgetId of FOOTER_WIDGET_IDS) {
            settingsList.updateValue(`widget:${widgetId}`, widgetSummary(draft, widgetId));
          }
        };

        const items = rootFooterSettingsItems(draft, theme, () => {
          applyDraft();
          syncRootValues();
          tui.requestRender();
        });

        settingsList = new SettingsList(
          items,
          Math.min(items.length + 2, 18),
          getSettingsListTheme(),
          (id, newValue) => {
            if (id === "refreshMs") {
              const refreshMs = coerceRefreshMs(newValue);
              if (refreshMs !== undefined) {
                draft.refreshMs = refreshMs;
                applyDraft();
                syncRootValues();
              }
            } else if (id === "showPiBanner") {
              if (newValue === "on" || newValue === "off") {
                draft.showPiBanner = newValue === "on";
                applyDraft();
                syncRootValues();
              }
            } else if (id === "defaultTextColor") {
              const color = coerceWidgetColor(newValue);
              if (color) {
                draft.defaultTextColor = color;
                applyDraft();
                syncRootValues();
              }
            } else if (id === "defaultIconColor") {
              const color = coerceWidgetColor(newValue);
              if (color) {
                draft.defaultIconColor = color;
                applyDraft();
                syncRootValues();
              }
            }
            tui.requestRender();
          },
          () => {
            done(undefined);
          },
        );

        container.addChild(settingsList);
        container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter configure widget • enter/space change values • esc close"), 1, 0));

        return {
          render(width: number) {
            return container.render(width);
          },
          invalidate() {
            container.invalidate();
          },
          handleInput(data: string) {
            settingsList.handleInput?.(data);
            tui.requestRender();
          },
        };
      });
    },
  });

  pi.on("session_before_compact", async (event) => {
    compactionSettings = coerceCompactionSettings(event.preparation.settings, compactionSettings);
    activeFooterControls?.requestRender();
  });

  pi.on("session_start", async (_event, ctx) => {
    installFooter(ctx);
  });

  pi.on("session_switch", async (_event, ctx) => {
    installFooter(ctx);
  });
}
