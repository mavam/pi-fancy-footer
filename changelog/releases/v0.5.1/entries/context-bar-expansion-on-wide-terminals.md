---
title: Context bar expansion on wide terminals
type: bugfix
authors:
  - mavam
  - codex
created: 2026-04-15T10:01:15.709513Z
---

The `context-bar` widget now expands across the full width available to its row on wide terminals. Previously, the bar stopped at 200 cells and could leave a large empty gap around the centered bar even when more horizontal space was available.

This fixes the layout without requiring any configuration changes.
