---
title: Stop showing 0% for unreported provider quota
type: bugfix
authors:
  - mavam
created: 2026-09-21T15:13:54.218568Z
---

Provider quota gauges no longer flash 0% before settling on the real number.
When a provider named a quota window without reporting its percentage — an
OpenAI response carrying a reset time but no usage, for instance — the footer
filled in 0% and drew a full, empty-looking gauge until the next refresh
happened to include the number. Unreported usage is now shown as unknown, and a
cached percentage that still describes the current period is kept instead of
being overwritten.
