---
title: Let the context bar grow across the row
type: bugfix
authors:
  - edxeth
  - mavam
prs:
  - 15
created: 2026-07-11T06:14:49.576554Z
---

Setting fill to grow on the context-bar widget now works as documented: the bar expands across the available row width, prefixed with the used context tokens (e.g. 246k) and flanked by the context-capacity widget. Previously the grow setting allocated the width but the bar still drew a fixed gaugeWidth-cell gauge. The default footer is unchanged and keeps the compact mini gauge.
