---
title: Compatibility with pi 0.69
type: bugfix
authors:
  - mavam
  - codex
created: 2026-04-23T06:43:46.340336Z
---

The extension now loads correctly with pi 0.69 and later.

Previously, upgrading pi could prevent the installed package from loading with a TypeBox module-resolution error. This fix restores startup compatibility without requiring configuration changes.
