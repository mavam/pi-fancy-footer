---
title: Compatibility with the current pi extension API
type: bugfix
authors:
  - mavam
  - codex
pr: 5
created: 2026-03-26T21:26:42.535715Z
---

The extension now works again with recent pi releases whose extension API changed, including the `/fancy-footer` configuration screen.

It also follows pi's configured agent directory when loading settings and saving `fancy-footer.json`, so custom agent directory setups continue to work.
