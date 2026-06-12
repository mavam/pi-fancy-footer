import {
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import {
  DEFAULT_FOOTER_CONFIG,
  EMPTY_GIT_INFO,
  FOOTER_WIDGET_COLORS,
  MAX_FOOTER_REFRESH_MS,
  MAX_PROVIDER_STATUS_REFRESH_MS,
  MAX_WIDGET_MIN_WIDTH,
  MAX_WIDGET_POSITION,
  MAX_WIDGET_ROW,
  MIN_FOOTER_REFRESH_MS,
  MIN_PROVIDER_STATUS_REFRESH_MS,
  clampInt,
  isFooterWidgetColor,
  isFooterWidgetId,
  type FancyFooterWidgetContribution,
  type NormalizedFancyFooterWidgetContribution,
  type FooterConfigSnapshot,
  type ProviderStatusSnapshot,
  type SessionUsageMetrics,
} from "./shared.ts";
import {
  cloneFooterConfig,
  getFooterConfigPath,
  loadFooterConfig,
  writeFooterConfigSnapshot,
} from "./config.ts";
import {
  collectGitInfo,
  collectPullRequestInfo,
  shouldRefreshPullRequest,
} from "./git.ts";
import {
  FANCY_FOOTER_DISCOVER_WIDGETS_EVENT,
  FANCY_FOOTER_REQUEST_WIDGET_DISCOVERY_EVENT,
  FANCY_FOOTER_REQUEST_WIDGET_REFRESH_EVENT,
} from "./api.ts";
import { openFooterConfigEditor } from "./config-editor.ts";
import { collectSessionUsageMetrics, renderFooterLines } from "./render.ts";
import {
  collectProviderStatus,
  updateProviderStatusFromHeaders,
} from "./provider-status.ts";

interface ActiveFooterControls {
  requestRender: () => void;
  reschedule: () => void;
  rescheduleProviderStatus: () => void;
  updateProviderStatus: (status: ProviderStatusSnapshot) => void;
}

const extensionWidgetColorSchema = Type.Union(
  FOOTER_WIDGET_COLORS.map((value) => Type.Literal(value)),
);
const extensionWidgetMetadataSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    label: Type.Optional(Type.String({ minLength: 1 })),
    description: Type.Optional(Type.String({ minLength: 1 })),
    defaults: Type.Optional(
      Type.Object(
        {
          row: Type.Optional(
            Type.Integer({ minimum: 0, maximum: MAX_WIDGET_ROW }),
          ),
          position: Type.Optional(
            Type.Integer({ minimum: 0, maximum: MAX_WIDGET_POSITION }),
          ),
          align: Type.Optional(
            Type.Union([
              Type.Literal("left"),
              Type.Literal("middle"),
              Type.Literal("right"),
            ]),
          ),
          fill: Type.Optional(
            Type.Union([Type.Literal("none"), Type.Literal("grow")]),
          ),
          minWidth: Type.Optional(
            Type.Integer({ minimum: 0, maximum: MAX_WIDGET_MIN_WIDTH }),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    textColor: Type.Optional(extensionWidgetColorSchema),
    styled: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
const validateExtensionWidgetMetadata = Compile(extensionWidgetMetadataSchema);

export default function (pi: ExtensionAPI) {
  let footerConfig: FooterConfigSnapshot = {
    refreshMs: DEFAULT_FOOTER_CONFIG.refreshMs,
    iconFamily: DEFAULT_FOOTER_CONFIG.iconFamily,
    gaugeStyle: DEFAULT_FOOTER_CONFIG.gaugeStyle,
    gaugeWidth: DEFAULT_FOOTER_CONFIG.gaugeWidth,
    gaugeColors: { ...DEFAULT_FOOTER_CONFIG.gaugeColors },
    defaultTextColor: DEFAULT_FOOTER_CONFIG.defaultTextColor,
    defaultIconColor: DEFAULT_FOOTER_CONFIG.defaultIconColor,
    providerStatus: { ...DEFAULT_FOOTER_CONFIG.providerStatus },
    widgets: { ...DEFAULT_FOOTER_CONFIG.widgets },
    extensionWidgets: { ...DEFAULT_FOOTER_CONFIG.extensionWidgets },
  };
  let extensionWidgets: NormalizedFancyFooterWidgetContribution[] = [];

  let activeFooterControls: ActiveFooterControls | undefined;
  let footerInstanceId = 0;

  const invalidateActiveFooter = () => {
    footerInstanceId += 1;
    activeFooterControls = undefined;
  };

  const normalizeExtensionWidget = (
    widget: FancyFooterWidgetContribution,
  ): NormalizedFancyFooterWidgetContribution | undefined => {
    if (!widget || typeof widget !== "object") return undefined;

    const metadata = {
      id: typeof widget.id === "string" ? widget.id.trim() : widget.id,
      label:
        typeof widget.label === "string" ? widget.label.trim() : widget.label,
      description:
        typeof widget.description === "string"
          ? widget.description.trim()
          : widget.description,
      defaults: {
        row: widget.row,
        position: widget.order,
        align: widget.align,
        fill: widget.grow === true ? "grow" : undefined,
        minWidth: widget.minWidth,
      },
      textColor: widget.textColor,
      styled: widget.styled,
    };
    if (metadata.label === "") metadata.label = undefined;

    if (!validateExtensionWidgetMetadata.Check(metadata)) {
      const errors = Array.from(
        validateExtensionWidgetMetadata.Errors(metadata),
      )
        .map(
          (error) =>
            `${(error as { instancePath?: string }).instancePath || "/"}: ${error.message}`,
        )
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
    if (typeof widget.render !== "function") {
      console.warn(
        `Ignoring fancy-footer widget '${metadata.id}' without a render function`,
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
      description: metadata.description ?? metadata.label ?? metadata.id,
      defaults: {
        row: metadata.defaults.row ?? 1,
        position: metadata.defaults.position ?? 0,
        align: metadata.defaults.align ?? "right",
        fill: metadata.defaults.fill ?? "none",
        minWidth: metadata.defaults.minWidth,
      },
      render: widget.render,
      textColor: metadata.textColor,
      styled: metadata.styled,
    };
  };

  const discoverExtensionWidgets = () => {
    const discovered = new Map<
      string,
      NormalizedFancyFooterWidgetContribution
    >();

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

    footerConfig = loadFooterConfig();

    ctx.ui.setFooter((tui, theme, footerData) => {
      const instanceId = ++footerInstanceId;
      const fallbackThinkingLevel = pi.getThinkingLevel();
      let currentGit = { ...EMPTY_GIT_INFO };
      let providerStatuses = new Map<string, ProviderStatusSnapshot>();
      let usageMetrics: SessionUsageMetrics = collectSessionUsageMetrics(ctx);
      let refreshing = false;
      let refreshQueued = false;
      let pullRequestRefreshing = false;
      let pullRequestRefreshQueued = false;
      let providerStatusRefreshing = false;
      let providerStatusRefreshQueued = false;
      let providerStatusRefreshAt = 0;
      let disposed = false;
      let refreshTimer: ReturnType<typeof setTimeout> | undefined;
      let providerStatusTimer: ReturnType<typeof setTimeout> | undefined;

      const isActiveFooter = () => !disposed && instanceId === footerInstanceId;

      const requestRender = () => {
        if (!isActiveFooter()) return;
        tui.requestRender();
      };

      const isPullRequestReviewThreadsWidgetEnabled = () => {
        const widget = footerConfig.widgets["pull-request-review-threads"];
        return widget?.enabled !== false;
      };

      const isPullRequestCiStatusWidgetEnabled = () => {
        const widget = footerConfig.widgets["pull-request-ci-status"];
        return widget?.enabled !== false;
      };

      const isPullRequestBackedWidgetEnabled = () =>
        footerConfig.widgets["pull-request"]?.enabled !== false ||
        isPullRequestReviewThreadsWidgetEnabled() ||
        isPullRequestCiStatusWidgetEnabled();

      const isProviderStatusWidgetEnabled = () =>
        footerConfig.widgets["provider-status"]?.enabled !== false;

      const refreshProviderStatus = async (force = false) => {
        if (!isActiveFooter() || !isProviderStatusWidgetEnabled()) return;
        const now = Date.now();
        const refreshMs = clampInt(
          footerConfig.providerStatus.refreshMs,
          MIN_PROVIDER_STATUS_REFRESH_MS,
          MAX_PROVIDER_STATUS_REFRESH_MS,
        );
        if (!force && providerStatusRefreshAt + refreshMs > now) return;
        if (providerStatusRefreshing) {
          providerStatusRefreshQueued = true;
          return;
        }

        providerStatusRefreshing = true;
        try {
          do {
            providerStatusRefreshQueued = false;
            if (!isActiveFooter() || !isProviderStatusWidgetEnabled()) {
              continue;
            }

            providerStatusRefreshAt = Date.now();
            const next = await collectProviderStatus(
              pi,
              footerConfig.providerStatus,
            );
            if (!isActiveFooter()) return;
            providerStatuses = new Map(
              next.map((snapshot) => [snapshot.provider, snapshot]),
            );
            requestRender();
          } while (isActiveFooter() && providerStatusRefreshQueued);
        } finally {
          providerStatusRefreshing = false;
        }
      };

      // Keep networked PR discovery off the local git refresh path.
      const refreshPullRequest = async () => {
        if (
          !isActiveFooter() ||
          !isPullRequestBackedWidgetEnabled() ||
          !shouldRefreshPullRequest(currentGit)
        ) {
          return;
        }
        if (pullRequestRefreshing) {
          pullRequestRefreshQueued = true;
          return;
        }

        pullRequestRefreshing = true;
        try {
          do {
            pullRequestRefreshQueued = false;

            if (
              !isActiveFooter() ||
              !isPullRequestBackedWidgetEnabled() ||
              !shouldRefreshPullRequest(currentGit)
            ) {
              continue;
            }

            const targetBranch = currentGit.branch;
            const targetRepository = currentGit.repository;
            const targetLookupAt = currentGit.pullRequestLookupAt;
            const pullRequest = await collectPullRequestInfo(
              pi,
              ctx.cwd,
              targetBranch,
              {
                includeReviewThreads: isPullRequestReviewThreadsWidgetEnabled(),
                includeCiStatus: isPullRequestCiStatusWidgetEnabled(),
              },
            );
            if (!isActiveFooter()) return;
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
          } while (isActiveFooter() && pullRequestRefreshQueued);
        } finally {
          pullRequestRefreshing = false;
        }
      };

      const refreshGit = async () => {
        if (!isActiveFooter()) return;
        if (refreshing) {
          refreshQueued = true;
          return;
        }

        refreshing = true;
        try {
          do {
            refreshQueued = false;
            if (!isActiveFooter()) continue;

            footerConfig = loadFooterConfig();
            usageMetrics = collectSessionUsageMetrics(ctx);

            const git = await collectGitInfo(pi, ctx.cwd, currentGit);
            if (!isActiveFooter()) return;
            currentGit = git;
            requestRender();
            void refreshPullRequest();
          } while (isActiveFooter() && refreshQueued);
        } finally {
          refreshing = false;
        }
      };

      const scheduleRefresh = () => {
        if (!isActiveFooter()) return;
        if (refreshTimer) clearTimeout(refreshTimer);

        const refreshMs = clampInt(
          footerConfig.refreshMs,
          MIN_FOOTER_REFRESH_MS,
          MAX_FOOTER_REFRESH_MS,
        );
        refreshTimer = setTimeout(() => {
          if (!isActiveFooter()) return;
          void refreshGit().finally(() => {
            scheduleRefresh();
          });
        }, refreshMs);
      };

      const scheduleProviderStatusRefresh = () => {
        if (!isActiveFooter()) return;
        if (providerStatusTimer) clearTimeout(providerStatusTimer);

        const refreshMs = clampInt(
          footerConfig.providerStatus.refreshMs,
          MIN_PROVIDER_STATUS_REFRESH_MS,
          MAX_PROVIDER_STATUS_REFRESH_MS,
        );
        providerStatusTimer = setTimeout(() => {
          if (!isActiveFooter()) return;
          void refreshProviderStatus().finally(() => {
            scheduleProviderStatusRefresh();
          });
        }, refreshMs);
      };

      const onBranchChange = footerData.onBranchChange(() => {
        if (!isActiveFooter()) return;
        usageMetrics = collectSessionUsageMetrics(ctx);
        requestRender();
        void refreshGit();
      });

      activeFooterControls = {
        requestRender,
        reschedule: scheduleRefresh,
        rescheduleProviderStatus: scheduleProviderStatusRefresh,
        updateProviderStatus: (status) => {
          if (!isActiveFooter()) return;
          providerStatuses.set(status.provider, status);
          requestRender();
        },
      };

      void refreshGit();
      void refreshProviderStatus(true);
      scheduleRefresh();
      scheduleProviderStatusRefresh();

      return {
        invalidate() {},
        dispose() {
          disposed = true;
          onBranchChange();
          if (refreshTimer) clearTimeout(refreshTimer);
          if (providerStatusTimer) clearTimeout(providerStatusTimer);
          if (activeFooterControls?.requestRender === requestRender) {
            activeFooterControls = undefined;
          }
        },
        render(width: number): string[] {
          if (!isActiveFooter()) return ["", ""];

          return renderFooterLines(
            width,
            ctx,
            currentGit,
            fallbackThinkingLevel,
            theme,
            usageMetrics,
            footerConfig,
            extensionWidgets,
            Array.from(providerStatuses.values()).sort((a, b) =>
              a.provider.localeCompare(b.provider),
            ),
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
          activeFooterControls?.rescheduleProviderStatus();
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

  pi.on("after_provider_response", async (event) => {
    if (footerConfig.widgets["provider-status"]?.enabled === false) return;

    const updated = await updateProviderStatusFromHeaders(
      event.headers ?? {},
      footerConfig.providerStatus,
    );
    for (const snapshot of updated) {
      activeFooterControls?.updateProviderStatus(snapshot);
    }
  });

  pi.on("session_shutdown", async () => {
    invalidateActiveFooter();
  });

  pi.on("session_start", async (_event, ctx) => {
    discoverExtensionWidgets();
    installFooter(ctx);
  });
}
