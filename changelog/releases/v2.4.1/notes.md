This release keeps context and provider quota gauges accurate across compaction and quota-window resets. The footer now clears stale context usage immediately and preserves quota gauges until providers report the new period.

## 🐞 Bug fixes

### Immediate context gauge reset after compaction

The context gauge now resets as soon as Pi compacts a session. Previously, it kept showing the pre-compaction fill until the next prompt completed, even though the older context had already been summarized.

While Pi waits for the next model response to report post-compaction usage, the gauge now displays an empty `0%` state instead of stale usage.

*By @mavam and @codex in #29.*

### Missing quota gauges after a limit reset

The provider quota widget no longer disappears when a quota window resets. Previously, a reset that happened while you were away — such as the weekly limit rolling over overnight — hid the `5h` and `7d` gauges entirely until your next agent turn.

A window past its reset time now stays visible with unknown usage (`—`) until the provider reports the new period. A reset that falls inside the status cache lifetime no longer leaves the previous period's percentage on screen or claims unconfirmed headroom.

*By @mavam and @claude in #28.*
