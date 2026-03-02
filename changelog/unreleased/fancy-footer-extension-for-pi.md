---
title: Fancy footer extension for pi
type: feature
authors:
  - mavam
  - claude
created: 2026-03-02T21:03:00.446308Z
---

A compact, two-line status footer for pi that surfaces key session details at a
glance. The footer displays the active model and thinking level, context window
usage with a visual capacity bar, session cost, repository location, branch,
commit, and git diff stats.

All widgets are individually configurable via `~/.pi/agent/fancy-footer.json`,
with options for visibility, positioning, alignment, colors, and icons. An
interactive `/fancy-footer` command lets you tweak the layout directly from
within pi.

Install with:

```
pi install npm:pi-fancy-footer
```
