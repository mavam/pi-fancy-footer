---
title: Leaner context stats with SI units
type: change
authors:
  - mavam
  - claude
prs:
  - 17
created: 2026-07-11T11:37:20.826359Z
---

The context-capacity widget moved from the top-right corner into the top-left context group next to the context bar, and is now hidden by default: the bar's gauge already conveys usage, so the raw window size starts on the /fancy-footer bench until you enable it. Token counts across the footer now use compact SI-style units, so a one-million-token window reads 1M instead of 1000k, and the total-cost widget stays anchored at the far right of the top row.
