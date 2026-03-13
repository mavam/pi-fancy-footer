---
title: Configurable icon families for the footer
type: feature
authors:
  - mavam
  - codex
created: 2026-03-13T16:33:40.757224Z
pr: 2
---

The footer now supports four icon palettes—`nerd`, `emoji`, `unicode`, and
`ascii`—controlled by the new `iconFamily` setting. Terminals that don't ship
with a Nerd Font can switch to one of the fallback families for full glyph
coverage. The configuration UI updates icons live when you cycle through
families.

The per-widget `icon` override has been simplified: it now only allows `default`
or `hide` (the previous `show` value is removed). The selected `iconFamily`
determines which glyph each widget displays.

The following table shows the symbols used by each widget in every icon family:

<!-- markdownlint-disable MD013 MD060 -->

| Widget             | nerd    | emoji      | unicode | ascii    |
| ------------------ | ------- | ---------- | ------- | -------- |
| `model`            | `󰧑`     | `🤖`       | `◉`     | `M`      |
| `thinking`         | `󰭻`     | `🧠`       | `✦`     | `T`      |
| `context-capacity` | ``     | `💾`       | `◫`     | `[]`     |
| `context-bar`      | `■/□/▣` | `■/□/▣`    | `■/□/▣` | `#/-/:`  |
| `context-usage`    | ``     | `📈`       | `↺`     | `~`      |
| `total-cost`       | `$`     | `💲`       | `$`     | `$`      |
| `location`         | ``     | `📁`       | `⌂`     | `/`      |
| `branch`           | ``     | `🌿`       | `⎇`     | `*`      |
| `commit`           | ``     | `🔖`       | `#`     | `@`      |
| `pull-request`     | ``     | `🔀`       | `⇄`     | `#`      |
| `diff-added`       | `↗`     | `➕`       | `+`     | `+`      |
| `diff-removed`     | `↘`     | `➖`       | `−`     | `-`      |
| `git-status`       | `//` | `🔼/🔽/🔀` | `↑/↓/↕` | `^/v/<>` |

<!-- markdownlint-enable MD013 MD060 -->

Some glyphs, especially in the `nerd` family, may not render in a browser. If
a cell looks blank or shows a replacement box, check the table in a terminal
with the relevant font installed.
