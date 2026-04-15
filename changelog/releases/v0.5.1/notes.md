This release fixes the context bar layout on wide terminals by letting the bar expand across the full width of its row. The footer now uses the available horizontal space instead of capping the bar at 200 cells and leaving large empty gaps.

## 🐞 Bug fixes

### Context bar expansion on wide terminals

The `context-bar` widget now expands across the full width available to its row on wide terminals. Previously, the bar stopped at 200 cells and could leave a large empty gap around the centered bar even when more horizontal space was available.

This fixes the layout without requiring any configuration changes.

*By @mavam and @codex.*
