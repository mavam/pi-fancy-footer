# pi-fancy-footer

A pi extension that replaces the default footer with a compact, two-line fancy status footer.

## What it shows

- Active model + thinking level
- Context window capacity and approximate usage
- Context usage bar with compaction reserve tail
- Total session cost
- Repo / path, branch, commit
- Git diff stats and ahead/behind status

## Install

### Local path

```bash
pi install /absolute/path/to/pi-fancy-footer
```

Or project-local:

```bash
pi install -l /absolute/path/to/pi-fancy-footer
```

### One-off test

```bash
pi -e /absolute/path/to/pi-fancy-footer
```

## Migration from a local extension file

If you previously used `~/.pi/agent/extensions/statusline.ts`, remove or rename it so only one extension sets the footer.

## Commands

- `/fancy-footer` - open interactive footer config editor (small TUI)
  - all widgets are listed directly (with icon prefixes)
  - select a widget and press Enter for detailed settings
  - in widget settings, adjust row/position/align/fill/min-width, visibility, icon show/hide, and icon color
  - use Enter/Space to cycle values

## Notes

- Uses pi package convention directories (`extensions/`) instead of an explicit `pi.extensions` manifest.
- Uses Nerd Font glyphs for best visuals.
- Reads compaction settings from:
  - `~/.pi/agent/settings.json`
  - `<project>/.pi/settings.json`
- Poll interval and widget overrides are read from:
  - `~/.pi/agent/fancy-footer.json` (global only)

## Configuration

Create `~/.pi/agent/fancy-footer.json`:

```json
{
  "refreshMs": 3000,
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
      "icon": { "text": "", "color": "accent" },
      "textColor": "muted"
    }
  }
}
```

Supported per-widget overrides:
- `enabled` (boolean)
- `row` (number)
- `position` (number, ordering within an aligned row group)
- `align` (`left` | `middle` | `right`)
- `fill` (`none` | `grow`)
- `minWidth` (number)
- `icon` (`null` to hide, or `{ "text": string, "color": ... }`)
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

## License

MIT
