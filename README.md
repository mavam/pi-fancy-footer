# ✨ pi-fancy-footer

A [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)
extension that replaces the default footer with a compact, two-line fancy status
footer.

<!-- markdownlint-disable MD033 -->
<p align="center">
  <img src="screenshot.png" alt="screenshot" />
</p>
<!-- markdownlint-enable MD033 -->

## 📊 What it shows

- Active model + thinking level
- Context window capacity and approximate usage
- Context usage bar with compaction reserve tail
- Total session cost
- Repo / path, branch, commit, and open PR number
- Git diff stats and ahead/behind status

## 📦 Install

Install as a pi package:

```bash
pi install npm:pi-fancy-footer
```

## 🎮 Commands

- `/fancy-footer` - open interactive footer config editor (small TUI)
  - all widgets are listed directly (with icon prefixes)
  - select a widget and press Enter for detailed settings
  - in widget settings, adjust row/position/align/fill/min-width, visibility,
    icon hide, icon color, and text color
  - use Enter/Space to cycle values

## ⚙️ Configuration

Create `~/.pi/agent/fancy-footer.json`:

```json
{
  "refreshMs": 3000,
  "showPiBanner": true,
  "iconFamily": "unicode",
  "defaultTextColor": "dim",
  "defaultIconColor": "text",
  "widgets": {
    "context-bar": {
      "align": "middle",
      "row": 0,
      "position": 0,
      "fill": "grow",
      "minWidth": 12
    },
    "total-cost": {
      "enabled": false
    },
    "branch": {
      "icon": "hide",
      "textColor": "muted"
    }
  }
}
```

Top-level settings:

- `refreshMs` (number)
- `showPiBanner` (boolean)
- `iconFamily`
  (`nerd` | `emoji` | `unicode` | `ascii`)
- `defaultTextColor`
  (`text` | `accent` | `muted` | `dim` | `success` | `error` | `warning`)
- `defaultIconColor`
  (`text` | `accent` | `muted` | `dim` | `success` | `error` | `warning`)

Supported per-widget overrides:

- `enabled` (boolean)
- `row` (number)
- `position` (number, ordering within an aligned row group)
- `align` (`left` | `middle` | `right`)
- `fill` (`none` | `grow`)
- `minWidth` (number)
- `icon` (`default` | `hide`)
- `iconColor`
  (`text` | `accent` | `muted` | `dim` | `success` | `error` | `warning`)
- `textColor`
  (`text` | `accent` | `muted` | `dim` | `success` | `error` | `warning`)

Widget IDs:

- `model`
- `thinking`
- `context-capacity`
- `context-bar`
- `context-usage`
- `total-cost`
- `location`
- `branch`
- `commit`
- `pull-request`
- `diff-added`
- `diff-removed`
- `git-status`

## 🔣 Icon families

The following table shows the symbol used by each widget for each icon family.
For `context-bar` and `git-status`, the table shows the rendered bar/status
symbols rather than a leading widget icon.

> [!NOTE]
> Some glyphs, especially in the `nerd` family, may not render in your browser.
> If a cell looks blank or shows a replacement box, check the table in a
> terminal with the relevant font installed.

<!-- markdownlint-disable MD013 MD060 -->
| Widget             | nerd      | emoji      | unicode  | ascii    |
| ------------------ | --------- | ---------  | -------  | -------- |
| `model`            | `󰧑`       | `🤖`       | `◉`      | `M`      |
| `thinking`         | `󰭻`       | `🧠`       | `✦`      | `T`      |
| `context-capacity` | ``       | `💾`       | `◫`      | `[]`     |
| `context-bar`      | `■/□/▣`   | `■/□/▣`    | `■/□/▣`  | `#/-/:`  |
| `context-usage`    | ``       | `📈`       | `↺`      | `~`      |
| `total-cost`       | `$`       | `💲`       | `$`      | `$`      |
| `location`         | ``       | `📁`       | `⌂`      | `/`      |
| `branch`           | ``       | `🌿`       | `⎇`      | `*`      |
| `commit`           | ``       | `🔖`       | `#`      | `@`      |
| `pull-request`     | ``       | `🔀`       | `⇄`      | `#`      |
| `diff-added`       | `↗`       | `➕`       | `+`      | `+`      |
| `diff-removed`     | `↘`       | `➖`       | `−`      | `-`      |
| `git-status`       | `//`   | `🔼/🔽/🔀` | `↑/↓/↕`  | `^/v/<>` |
<!-- markdownlint-enable MD013 MD060 -->

Notes:

- Most widgets use a leading icon.
- `context-bar` uses symbols for used / free / reserved cells.
- `git-status` uses symbols for ahead / behind / diverged status.
- `iconFamily` lets you choose between `nerd`, `emoji`, `unicode`, and
  `ascii` palettes.
- `nerd` keeps the original Nerd Font look. `emoji`, `unicode`, and `ascii`
  work better in terminals that don't use a Nerd Font.
- Per-widget icon overrides only let you hide the icon. The selected
  `iconFamily` controls which icon each widget uses.
- The PR widget appears only for open GitHub pull requests and relies on the
  GitHub CLI (`gh`) being available and authenticated.
- Reads compaction settings from:
  - `~/.pi/agent/settings.json`
  - `<project>/.pi/settings.json`

## 📄 License

[MIT](LICENSE)
