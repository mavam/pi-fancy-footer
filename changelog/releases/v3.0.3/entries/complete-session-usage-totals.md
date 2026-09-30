---
title: Complete session usage totals
type: bugfix
authors:
  - mavam
prs:
  - 37
created: 2026-09-30T07:35:38.736227Z
---

The footer's cost and cumulative cache statistics now include model usage reported by tools such as codemode, as well as cache warming, compaction, and branch summaries. Totals cover the whole session, including other conversation branches, without counting nested tool usage twice.

Completed assistant and tool messages now update these statistics without waiting for the background Git refresh. The context gauge and cache hit rate continue to describe the active conversation rather than nested model calls.
