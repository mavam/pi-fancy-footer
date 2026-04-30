---
title: GitHub Actions PR status widget
type: feature
authors:
  - mavam
  - codex
pr: 8
created: 2026-04-30T15:41:48.305985Z
---

The footer can now show an icon-only GitHub Actions status for the current pull
request with the emoji palette: ⏳ for running, ❌ for failed, and ✅ for okay.
The widget links directly to the relevant workflow run and reports a failure as
soon as any workflow fails, even while other workflows are still running.
