Pi Fancy Footer now shows the time remaining until each reported Claude and Codex provider quota window resets. The countdown is enabled by default, and you can choose whether to show it for the primary window or every window.

## 🔧 Changes

### Show time left until provider quota resets

Provider quota windows now show how long remains until they reset, directly next to the window they describe. Countdown display is enabled by default for every reported Claude and Codex window.

The `providerStatus.showReset` setting now accepts `"off"`, `"primary"`, or `"all"`. Replace `true` with `"primary"` and `false` with `"off"` before upgrading.

*By @mavam and @codex in #25.*
