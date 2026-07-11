---
title: WYSIWYG footer configuration
type: feature
authors:
  - mavam
  - claude
prs:
  - 16
created: 2026-07-11T09:31:32.790446Z
---

The /fancy-footer config screen is now a WYSIWYG micro-view: widgets appear as chips in the same rows, alignment groups, and order as the real footer, which updates live below on every change. Arrow keys select a widget (shown inverted); l/r move it within and across alignment groups, u/d move it between rows, a cycles alignment, f toggles fill, and x hides it into a bench strip. Enter opens the per-widget settings (visibility, icon, colors, min width), and the general settings sit inline below the preview. Crowded rows automatically degrade from full widget names to short names to icons so every widget stays visible and selectable, with a status line always naming the current selection. Previously every widget had to be positioned through identical row/position/align/fill submenus, which made arranging the footer a guessing game.
