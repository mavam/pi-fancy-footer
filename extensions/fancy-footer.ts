import {
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
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
  isFooterWidgetId,
  type FooterWidgetColor,
  type CompactionSettingsSnapshot,
  type FancyFooterWidgetContribution,
  type FooterConfigSnapshot,
  type SessionUsageMetrics,
} from "./fancy-footer/shared.ts";
import {
  cloneFooterConfig,
  coerceCompactionSettings,
  coerceContextBarStyleValue,
  coerceIconFamily,
  coerceRefreshMs,
  coerceWidgetColor,
  extensionWidgetFooterSettingsItems,
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
  FANCY_FOOTER_DISCOVER_WIDGETS_EVENT,
  FANCY_FOOTER_REQUEST_WIDGET_DISCOVERY_EVENT,
  FANCY_FOOTER_REQUEST_WIDGET_REFRESH_EVENT,
} from "./fancy-footer/api.ts";
import {
  collectSessionUsageMetrics,
  renderFooterLines,
} from "./fancy-footer/render.ts";

interface ActiveFooterControls {
  requestRender: () => void;
  reschedule: () => void;
}

const extensionWidgetColorSchema = Type.Union([
  Type.Literal("text"),
  Type.Literal("accent"),
  Type.Literal("muted"),
  Type.Literal("dim"),
  Type.Literal("success"),
  Type.Literal("error"),
  Type.Literal("warning"),
]);
const extensionWidgetMetadataSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    label: Type.Optional(Type.String({ minLength: 1 })),
    description: Type.String({ minLength: 1 }),
    defaults: Type.Object(
      {
        row: Type.Integer({ minimum: 0, maximum: 12 }),
        position: Type.Integer({ minimum: 0, maximum: 64 }),
        align: Type.Union([
          Type.Literal("left"),
          Type.Literal("middle"),
          Type.Literal("right"),
        ]),
        fill: Type.Union([Type.Literal("none"), Type.Literal("grow")]),
        minWidth: Type.Optional(Type.Integer({ minimum: 0, maximum: 120 })),
      },
      { additionalProperties: false },
    ),
    textColor: Type.Optional(extensionWidgetColorSchema),
    styled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
const validateExtensionWidgetMetadata = TypeCompiler.Compile(
  extensionWidgetMetadataSchema,
);

function isFooterWidgetColorValue(value: unknown): value is FooterWidgetColor {
  return (
    value === "text" ||
    value === "accent" ||
    value === "muted" ||
    value === "dim" ||
    value === "success" ||
    value === "error" ||
    value === "warning"
  );
}

export default function (pi: ExtensionAPI) {
  let compactionSettings: CompactionSettingsSnapshot = {
    ...DEFAULT_COMPACTION_SETTINGS,
  };
  let footerConfig: FooterConfigSnapshot = {
    refreshMs: DEFAULT_FOOTER_CONFIG.refreshMs,
    iconFamily: DEFAULT_FOOTER_CONFIG.iconFamily,
    contextBarStyle: DEFAULT_FOOTER_CONFIG.contextBarStyle,
    defaultTextColor: DEFAULT_FOOTER_CONFIG.defaultTextColor,
    defaultIconColor: DEFAULT_FOOTER_CONFIG.defaultIconColor,
    widgets: { ...DEFAULT_FOOTER_CONFIG.widgets },
    extensionWidgets: { ...DEFAULT_FOOTER_CONFIG.extensionWidgets },
  };
  let extensionWidgets: FancyFooterWidgetContribution[] = [];

  let activeFooterControls: ActiveFooterControls | undefined;

  const normalizeExtensionWidget = (
    widget: FancyFooterWidgetContribution,
  ): FancyFooterWidgetContribution | undefined => {
    if (!widget || typeof widget !== "object") return undefined;

    const metadata = {
      id: typeof widget.id === "string" ? widget.id.trim() : widget.id,
      label:
        typeof widget.label === "string" ? widget.label.trim() : widget.label,
      description:
        typeof widget.description === "string"
          ? widget.description.trim()
          : widget.description,
      defaults: widget.defaults,
      textColor: widget.textColor,
      styled: widget.styled,
    };
    if (metadata.label === "") metadata.label = undefined;

    if (!validateExtensionWidgetMetadata.Check(metadata)) {
      const errors = Array.from(
        validateExtensionWidgetMetadata.Errors(metadata),
      )
        .map((error) => `${error.path || "/"}: ${error.message}`)
        .join(", ");
      console.warn(
        `Ignoring fancy-footer widget '${String(widget.id ?? "<unknown>")}' with invalid metadata: ${errors}`,
      );
      return undefined;
    }

    if (isFooterWidgetId(metadata.id)) {
      console.warn(
        `Ignoring fancy-footer widget '${metadata.id}' because it conflicts with a built-in widget id`,
      );
      return undefined;
    }
    if (typeof widget.renderText !== "function") {
      console.warn(
        `Ignoring fancy-footer widget '${metadata.id}' without a renderText function`,
      );
      return undefined;
    }
    if (widget.visible !== undefined && typeof widget.visible !== "function") {
      console.warn(
        `Ignoring fancy-footer widget '${metadata.id}' with an invalid visible handler`,
      );
      return undefined;
    }
    if (
      widget.textColor !== undefined &&
      !isFooterWidgetColorValue(widget.textColor)
    ) {
      console.warn(
        `Ignoring fancy-footer widget '${metadata.id}' with an invalid textColor`,
      );
      return undefined;
    }

    return {
      ...widget,
      id: metadata.id,
      label: metadata.label ?? metadata.id,
      description: metadata.description,
      defaults: metadata.defaults,
      textColor: metadata.textColor,
      styled: metadata.styled,
    };
  };

  const discoverExtensionWidgets = () => {
    const discovered = new Map<string, FancyFooterWidgetContribution>();

    pi.events.emit(FANCY_FOOTER_DISCOVER_WIDGETS_EVENT, {
      registerWidget: (widget: FancyFooterWidgetContribution) => {
        const normalized = normalizeExtensionWidget(widget);
        if (!normalized) return;
        discovered.set(normalized.id, normalized);
      },
    });

    extensionWidgets = Array.from(discovered.values()).sort((a, b) =>
      a.label!.localeCompare(b.label!),
    );
    activeFooterControls?.requestRender();
  };

  const installFooter = (ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;

    compactionSettings = loadCompactionSettings(ctx.cwd);
    footerConfig = loadFooterConfig();

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
            extensionWidgets,
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
            activeFooterControls?.reschedule();
            activeFooterControls?.requestRender();
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(`Failed to save config: ${msg}`, "error");
          }
        };

        type ConfigSection = "generic" | "widgets" | "extension-widgets";

        let activeSection: ConfigSection = "generic";
        const selection: Record<ConfigSection, number> = {
          generic: 0,
          widgets: 0,
          "extension-widgets": 0,
        };
        let submenu: Component | undefined;

        const getSectionItems = (section: ConfigSection): SettingItem[] => {
          if (section === "generic") {
            return genericFooterSettingsItems(draft);
          }
          if (section === "widgets") {
            return widgetFooterSettingsItems(draft, theme, () => {
              applyDraft();
              tui.requestRender();
            });
          }
          return extensionWidgetFooterSettingsItems(
            draft,
            theme,
            () => {
              applyDraft();
              tui.requestRender();
            },
            extensionWidgets,
          );
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
          "generic",
          "widgets",
          "extension-widgets",
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
              ...renderSection(width, "General", "generic"),
              "",
              ...renderSection(width, "Built-in widgets", "widgets"),
            ];

            if (extensionWidgets.length > 0) {
              lines.push("");
              lines.push(
                ...renderSection(
                  width,
                  "Extension widgets",
                  "extension-widgets",
                ),
              );
            }

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

  pi.events.on(FANCY_FOOTER_REQUEST_WIDGET_DISCOVERY_EVENT, () => {
    discoverExtensionWidgets();
  });

  pi.events.on(FANCY_FOOTER_REQUEST_WIDGET_REFRESH_EVENT, () => {
    activeFooterControls?.requestRender();
  });

  pi.on("session_before_compact", async (event) => {
    compactionSettings = coerceCompactionSettings(
      event.preparation.settings,
      compactionSettings,
    );
    activeFooterControls?.requestRender();
  });

  pi.on("session_start", async (_event, ctx) => {
    discoverExtensionWidgets();
    installFooter(ctx);
  });
}
