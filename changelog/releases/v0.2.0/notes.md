Adds four icon families (nerd, emoji, unicode, and ascii) so the footer renders correctly in any terminal regardless of installed fonts, with live preview in the settings UI. Also introduces a new pull request widget that shows the open GitHub PR number for the current branch after the commit SHA.

## 🚀 Features

### Configurable icon families for the footer

The footer now supports four icon palettes—`nerd`, `emoji`, `unicode`, and `ascii`—controlled by the new `iconFamily` setting. Terminals that don't ship with a Nerd Font can switch to one of the fallback families for full glyph coverage. The configuration UI updates icons live when you cycle through families.

The per-widget `icon` override has been simplified: it now only allows `default` or `hide` (the previous `show` value is removed). The selected `iconFamily` determines which glyph each widget displays.

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

Some glyphs, especially in the `nerd` family, may not render in a browser. If a cell looks blank or shows a replacement box, check the table in a terminal with the relevant font installed.

*By @mavam and @codex in #2.*

### GitHub pull request widget in the footer

The footer can now show the open GitHub pull request for the current branch directly after the commit SHA. When a branch has an open PR, the widget displays the PR number with a GitHub icon; if no PR exists, nothing is shown.

This makes it easier to see at a glance whether the current branch is already out for review.

*By @mavam.*
