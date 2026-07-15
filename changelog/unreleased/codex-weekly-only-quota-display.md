---
title: Codex weekly-only quota display
type: bugfix
authors:
  - mavam
  - codex
prs:
  - 18
created: 2026-07-15T20:43:28.527103Z
---

The `provider-status` widget now follows Codex's weekly-only quota layout without retaining or mislabeling a removed 5-hour window.

When Codex reports only a 7-day window, the footer shows one accurate `7d` gauge. If Codex reports the 5-hour window again, both gauges appear automatically.
