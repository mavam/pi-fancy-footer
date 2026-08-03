---
title: Current GitHub Actions status
type: bugfix
authors:
  - mavam
  - codex
prs:
  - 30
created: 2026-08-03T05:12:58.147376Z
---

The pull request CI widget now ignores superseded GitHub Actions runs. A newer successful or running workflow no longer remains red because an older run for the same head commit failed, and the icon links to the current run.
