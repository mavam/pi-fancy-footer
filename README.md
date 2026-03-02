# ✨ pi-fancy-footer

A [pi](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent)
extension that replaces the default footer with a compact, two-line fancy status
footer.

<p align="center">
  <img src="screenshot.png" alt="screenshot" />
</p>

## 📊 What it shows

- Active model + thinking level
- Context window capacity and approximate usage
- Context usage bar with compaction reserve tail
- Total session cost
- Repo / path, branch, commit
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
    icon show/hide, icon color, and text color
  - use Enter/Space to cycle values

## ⚙️ Configuration

Create `~/.pi/agent/fancy-footer.json`:

```json
{
  "refreshMs": 3000,
  "showPiBanner": true,
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
      "icon": "show",
      "iconColor": "text",
      "textColor": "muted"
    }
  }
}
```

Top-level settings:

- `refreshMs` (number)
- `showPiBanner` (boolean)
- `defaultTextColor` (`text` | `accent` | `muted` | `dim` | `success` | `error` | `warning`)
- `defaultIconColor` (`text` | `accent` | `muted` | `dim` | `success` | `error` | `warning`)

Supported per-widget overrides:

- `enabled` (boolean)
- `row` (number)
- `position` (number, ordering within an aligned row group)
- `align` (`left` | `middle` | `right`)
- `fill` (`none` | `grow`)
- `minWidth` (number)
- `icon` (`default` | `show` | `hide`)
- `iconColor` (`text` | `accent` | `muted` | `dim` | `success` | `error` | `warning`)
- `textColor` (`text` | `accent` | `muted` | `dim` | `success` | `error` | `warning`)

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
- `diff-added`
- `diff-removed`
- `git-status`

Notes:

- Uses Nerd Font glyphs for best visuals.
- Reads compaction settings from:
  - `~/.pi/agent/settings.json`
  - `<project>/.pi/settings.json`

## 📄 License

[MIT](LICENSE)
