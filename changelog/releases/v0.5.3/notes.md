This release hardens the fancy footer during `/reload` and other session replacement flows. The footer now stays active across reloads and session switches instead of crashing pi with stale extension state.

## 🐞 Bug fixes

### Footer stability after reloads and session switches

The fancy footer no longer crashes pi after `/reload` or other session replacement flows.

Previously, the footer could keep rendering against stale extension state and terminate the session with a stale-instance error. After this fix, reloads and session switches keep the footer active without requiring configuration changes.

*By @mavam and @codex.*
