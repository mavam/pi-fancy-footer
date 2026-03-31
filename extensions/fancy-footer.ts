import {
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
  Key,
  getKeybindings,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
  type Component,
  type SettingItem,
} from "@mariozechner/pi-tui";
import {
  DEFAULT_COMPACTION_SETTINGS,
  DEFAULT_FOOTER_CONFIG,
  EMPTY_GIT_INFO,
  MAX_FOOTER_REFRESH_MS,
  MIN_FOOTER_REFRESH_MS,
  clampInt,
  type CompactionSettingsSnapshot,
  type FooterConfigSnapshot,
  type SessionUsageMetrics,
} from "./fancy-footer/shared.ts";
import {
  bannerFooterSettingsItems,
  cloneFooterConfig,
  coerceCompactionSettings,
  coerceContextBarStyleValue,
  coerceIconFamily,
  coerceRefreshMs,
  coerceWidgetColor,
  genericFooterSettingsItems,
  getFooterConfigPath,
  loadCompactionSettings,
  loadFooterConfig,
  widgetFooterSettingsItems,
  writeFooterConfigSnapshot,
} from "./fancy-footer/config.ts";
import {
  collectGitInfo,
  collectPullRequestInfo,
  shouldRefreshPullRequest,
} from "./fancy-footer/git.ts";
import {
  collectSessionUsageMetrics,
  renderFooterLines,
} from "./fancy-footer/render.ts";
import { renderBannerLines } from "./fancy-footer/banner.ts";

interface ActiveFooterControls {
  requestRender: () => void;
  reschedule: () => void;
  applyHeader: () => void;
}

export default function (pi: ExtensionAPI) {
  let compactionSettings: CompactionSettingsSnapshot = {
    ...DEFAULT_COMPACTION_SETTINGS,
  };
  let footerConfig: FooterConfigSnapshot = {
    refreshMs: DEFAULT_FOOTER_CONFIG.refreshMs,
    showPiBanner: DEFAULT_FOOTER_CONFIG.showPiBanner,
    iconFamily: DEFAULT_FOOTER_CONFIG.iconFamily,
    contextBarStyle: DEFAULT_FOOTER_CONFIG.contextBarStyle,
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

      const isPullRequestWidgetEnabled = () =>
        footerConfig.widgets["pull-request"]?.enabled !== false;

      // Keep networked PR discovery off the local git refresh path.
      const refreshPullRequest = async () => {
        if (
          disposed ||
          !isPullRequestWidgetEnabled() ||
          !shouldRefreshPullRequest(currentGit)
        )
          return;
        if (pullRequestRefreshing) {
          pullRequestRefreshQueued = true;
          return;
        }

        pullRequestRefreshing = true;
        try {
          do {
            pullRequestRefreshQueued = false;

            if (
              !isPullRequestWidgetEnabled() ||
              !shouldRefreshPullRequest(currentGit)
            )
              continue;

            const targetBranch = currentGit.branch;
            const targetRepository = currentGit.repository;
            const targetLookupAt = currentGit.pullRequestLookupAt;
            const pullRequest = await collectPullRequestInfo(
              pi,
              ctx.cwd,
              targetBranch,
            );
            if (disposed) return;
            if (
              currentGit.branch !== targetBranch ||
              currentGit.repository !== targetRepository ||
              currentGit.pullRequestLookupAt !== targetLookupAt
            ) {
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

        const refreshMs = clampInt(
          footerConfig.refreshMs,
          MIN_FOOTER_REFRESH_MS,
          MAX_FOOTER_REFRESH_MS,
        );
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
    description: "Configure the fancy footer.",
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

        type ConfigSection = "banner" | "generic" | "widgets";

        let activeSection: ConfigSection = "banner";
        const selection: Record<ConfigSection, number> = {
          banner: 0,
          generic: 0,
          widgets: 0,
        };
        let submenu: Component | undefined;

        const getSectionItems = (section: ConfigSection): SettingItem[] => {
          if (section === "banner") {
            return bannerFooterSettingsItems(draft);
          }
          if (section === "generic") {
            return genericFooterSettingsItems(draft);
          }
          return widgetFooterSettingsItems(draft, theme, () => {
            applyDraft();
            tui.requestRender();
          });
        };

        const clampSectionSelection = (section: ConfigSection) => {
          const items = getSectionItems(section);
          if (items.length === 0) {
            selection[section] = 0;
            return;
          }
          selection[section] = clampInt(
            selection[section],
            0,
            items.length - 1,
          );
        };

        const getActiveSectionItems = () => {
          clampSectionSelection(activeSection);
          return getSectionItems(activeSection);
        };

        const getSelectedItem = () => {
          const items = getActiveSectionItems();
          return items[selection[activeSection]];
        };

        const orderedSections: ConfigSection[] = [
          "banner",
          "generic",
          "widgets",
        ];

        const getFlatSelections = () => {
          return orderedSections.flatMap((section) => {
            const items = getSectionItems(section);
            return items.map((_, index) => ({ section, index }));
          });
        };

        const handleRootChange = (id: string, newValue: string) => {
          if (id === "refreshMs") {
            const refreshMs = coerceRefreshMs(newValue);
            if (refreshMs !== undefined) {
              draft.refreshMs = refreshMs;
              applyDraft();
            }
          } else if (id === "showPiBanner") {
            if (newValue === "on" || newValue === "off") {
              draft.showPiBanner = newValue === "on";
              applyDraft();
            }
          } else if (id === "iconFamily") {
            const iconFamily = coerceIconFamily(newValue);
            if (iconFamily) {
              draft.iconFamily = iconFamily;
              applyDraft();
            }
          } else if (id === "contextBarStyle") {
            const contextBarStyle = coerceContextBarStyleValue(newValue);
            if (contextBarStyle) {
              draft.contextBarStyle = contextBarStyle;
              applyDraft();
            }
          } else if (id === "defaultTextColor") {
            const color = coerceWidgetColor(newValue);
            if (color) {
              draft.defaultTextColor = color;
              applyDraft();
            }
          } else if (id === "defaultIconColor") {
            const color = coerceWidgetColor(newValue);
            if (color) {
              draft.defaultIconColor = color;
              applyDraft();
            }
          }
        };

        const moveSection = (direction: 1 | -1) => {
          const index = orderedSections.indexOf(activeSection);
          for (let offset = 1; offset <= orderedSections.length; offset++) {
            const next =
              orderedSections[
                (index + offset * direction + orderedSections.length) %
                  orderedSections.length
              ]!;
            if (getSectionItems(next).length > 0) {
              activeSection = next;
              clampSectionSelection(activeSection);
              return;
            }
          }
        };

        const moveSelection = (direction: 1 | -1) => {
          const entries = getFlatSelections();
          if (entries.length === 0) return;

          clampSectionSelection(activeSection);
          const currentFlatIndex = entries.findIndex(
            (entry) =>
              entry.section === activeSection &&
              entry.index === selection[activeSection],
          );
          const safeCurrentIndex = currentFlatIndex >= 0 ? currentFlatIndex : 0;
          const next =
            entries[
              (safeCurrentIndex + direction + entries.length) % entries.length
            ];
          if (!next) return;

          activeSection = next.section;
          selection[next.section] = next.index;
        };

        const activateCurrentItem = () => {
          const item = getSelectedItem();
          if (!item) return;

          if (item.submenu) {
            submenu = item.submenu(item.currentValue, () => {
              submenu = undefined;
              tui.requestRender();
            });
            return;
          }

          if (item.values && item.values.length > 0) {
            const currentIndex = item.values.indexOf(item.currentValue);
            const nextValue =
              item.values[
                (currentIndex + 1 + item.values.length) % item.values.length
              ];
            if (nextValue !== undefined) {
              handleRootChange(item.id, nextValue);
            }
          }
        };

        const renderSection = (
          width: number,
          title: string,
          section: ConfigSection,
        ): string[] => {
          const items = getSectionItems(section);
          clampSectionSelection(section);

          const lines = [
            truncateToWidth(
              activeSection === section
                ? theme.fg("accent", theme.bold(title))
                : theme.bold(title),
              width,
            ),
          ];

          if (items.length === 0) {
            lines.push(
              truncateToWidth(
                theme.fg("dim", "  No settings available"),
                width,
              ),
            );
            return lines;
          }

          const labelWidth = Math.min(
            28,
            Math.max(...items.map((item) => visibleWidth(item.label)), 0),
          );
          for (const [index, item] of items.entries()) {
            const selected =
              activeSection === section && selection[section] === index;
            const prefix = selected ? theme.fg("accent", "→ ") : "  ";
            const paddedLabel =
              item.label +
              " ".repeat(Math.max(0, labelWidth - visibleWidth(item.label)));
            const label = selected
              ? theme.fg("accent", paddedLabel)
              : paddedLabel;
            const usedWidth = visibleWidth(prefix) + labelWidth + 2;
            const valueMaxWidth = Math.max(4, width - usedWidth - 2);
            const value = selected
              ? theme.fg(
                  "accent",
                  truncateToWidth(item.currentValue, valueMaxWidth, ""),
                )
              : theme.fg(
                  "dim",
                  truncateToWidth(item.currentValue, valueMaxWidth, ""),
                );
            lines.push(truncateToWidth(`${prefix}${label}  ${value}`, width));
          }

          return lines;
        };

        return {
          render(width: number) {
            if (submenu) {
              return submenu.render(width);
            }

            const lines = [
              truncateToWidth(
                theme.fg("accent", theme.bold("Fancy Footer Configuration")),
                width,
              ),
              truncateToWidth(theme.fg("dim", configPath), width),
              "",
              ...renderSection(width, "Banner", "banner"),
              "",
              ...renderSection(width, "General", "generic"),
              "",
              ...renderSection(width, "Widgets", "widgets"),
            ];

            const selected = getSelectedItem();
            if (selected?.description) {
              lines.push("");
              for (const line of wrapTextWithAnsi(
                selected.description,
                Math.max(10, width - 2),
              )) {
                lines.push(truncateToWidth(theme.fg("dim", line), width));
              }
            }

            lines.push("");
            lines.push(
              truncateToWidth(
                theme.fg(
                  "dim",
                  "↑↓ navigate • Tab/Shift+Tab switch section • Enter configure widget/change values • Esc close",
                ),
                width,
              ),
            );

            return lines;
          },
          invalidate() {
            submenu?.invalidate?.();
          },
          handleInput(data: string) {
            if (submenu) {
              submenu.handleInput?.(data);
              tui.requestRender();
              return;
            }

            const kb = getKeybindings();

            if (kb.matches(data, "tui.select.up")) {
              if (getActiveSectionItems().length > 0) moveSelection(-1);
            } else if (kb.matches(data, "tui.select.down")) {
              if (getActiveSectionItems().length > 0) moveSelection(1);
            } else if (matchesKey(data, Key.tab)) {
              moveSection(1);
            } else if (matchesKey(data, Key.shift("tab"))) {
              moveSection(-1);
            } else if (kb.matches(data, "tui.select.confirm") || data === " ") {
              activateCurrentItem();
            } else if (kb.matches(data, "tui.select.cancel")) {
              done(undefined);
              return;
            }

            tui.requestRender();
          },
        };
      });
    },
  });

  pi.on("session_before_compact", async (event) => {
    compactionSettings = coerceCompactionSettings(
      event.preparation.settings,
      compactionSettings,
    );
    activeFooterControls?.requestRender();
  });

  pi.on("session_start", async (_event, ctx) => {
    installFooter(ctx);
  });
}
