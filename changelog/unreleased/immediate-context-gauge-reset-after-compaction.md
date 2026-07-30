---
title: Immediate context gauge reset after compaction
type: bugfix
authors:
  - mavam
  - codex
prs:
  - 29
created: 2026-07-30T05:47:01.644501Z
---

The context gauge now resets as soon as Pi compacts a session. Previously, it kept showing the pre-compaction fill until the next prompt completed, even though the older context had already been summarized.

While Pi waits for the next model response to report post-compaction usage, the gauge now displays an empty `0%` state instead of stale usage.
