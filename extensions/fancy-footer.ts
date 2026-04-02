import {
  type ExtensionAPI,
  type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { TypeCompiler } from "@sinclair/typebox/compiler";
import {
  DEFAULT_COMPACTION_SETTINGS,
  DEFAULT_FOOTER_CONFIG,
  EMPTY_GIT_INFO,
  FOOTER_WIDGET_COLORS,
  MAX_FOOTER_REFRESH_MS,
  MAX_WIDGET_MIN_WIDTH,
  MAX_WIDGET_POSITION,
  MAX_WIDGET_ROW,
  MIN_FOOTER_REFRESH_MS,
  clampInt,
  isFooterWidgetColor,
  isFooterWidgetId,
  type CompactionSettingsSnapshot,
  type FancyFooterWidgetContribution,
  type FooterConfigSnapshot,
  type SessionUsageMetrics,
} from "./fancy-footer/shared.ts";
import {
  cloneFooterConfig,
  coerceCompactionSettings,
  getFooterConfigPath,
  loadCompactionSettings,
  loadFooterConfig,
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
import { openFooterConfigEditor } from "./fancy-footer/config-editor.ts";
import {
  collectSessionUsageMetrics,
  renderFooterLines,
} from "./fancy-footer/render.ts";

interface ActiveFooterControls {
  requestRender: () => void;
  reschedule: () => void;
}

const extensionWidgetColorSchema = Type.Union(
  FOOTER_WIDGET_COLORS.map((value) => Type.Literal(value)),
);
const extensionWidgetMetadataSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    label: Type.Optional(Type.String({ minLength: 1 })),
    description: Type.String({ minLength: 1 }),
    defaults: Type.Object(
      {
        row: Type.Integer({ minimum: 0, maximum: MAX_WIDGET_ROW }),
        position: Type.Integer({ minimum: 0, maximum: MAX_WIDGET_POSITION }),
        align: Type.Union([
          Type.Literal("left"),
          Type.Literal("middle"),
          Type.Literal("right"),
        ]),
        fill: Type.Union([Type.Literal("none"), Type.Literal("grow")]),
        minWidth: Type.Optional(
          Type.Integer({ minimum: 0, maximum: MAX_WIDGET_MIN_WIDTH }),
        ),
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
      !isFooterWidgetColor(widget.textColor)
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

      await openFooterConfigEditor({
        ctx,
        configPath,
        draft,
        extensionWidgets,
        applyDraft,
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
