This release accurately displays Codex weekly quota usage when no five-hour quota window is available. It also keeps the footer focused on branch and pull request context by hiding the commit SHA widget by default.

## 🔧 Changes

### Commit SHA widget hidden by default

The commit SHA widget now starts hidden, keeping the default footer focused on branch and pull request context.

Enable it from `/fancy-footer` or in `~/.pi/agent/fancy-footer.json`:

```json
{
  "widgets": {
    "commit": {
      "enabled": true
    }
  }
}
```

*By @mavam and @codex in #19.*

## 🐞 Bug fixes

### Codex weekly-only quota display

The `provider-status` widget now follows Codex's weekly-only quota layout without retaining or mislabeling a removed 5-hour window.

When Codex reports only a 7-day window, the footer shows one accurate `7d` gauge. If Codex reports the 5-hour window again, both gauges appear automatically.

*By @mavam and @codex in #18.*
