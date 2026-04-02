---
title: Clearer widget summaries in the settings screen
type: change
authors:
  - mavam
  - claude
created: 2026-04-02T18:42:02.247002Z
---

The widget summary in the `/fancy-footer` settings screen now shows only what
you actually changed, instead of echoing every property including defaults.
Labels are also more readable:

Before:

```
󰾆 context-bar       r0 p0 middle icon:off
```

After:

```
󰾆 context-bar       icon:hidden
```

Properties that match the widget's built-in defaults are omitted. If nothing is
customized, the summary reads `default`. Renamed labels use clearer names like
`row:`, `pos:`, `align:`, `icon:hidden`, and `width:` instead of the old
`r`/`p`/`w:` shorthand.
