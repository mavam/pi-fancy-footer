This release keeps the footer focused by showing provider reset countdowns only near quota limits and visually distinguishing draft pull requests.

## 🔧 Changes

### Conditional provider reset countdowns

Provider quota reset countdowns now appear only when a window reaches 75% usage by default, keeping low-usage windows compact.

Set the threshold in the **Provider Status** widget settings or in `fancy-footer.json`:

```json
{
  "providerStatus": {
    "resetMinUsedPercent": 80
  }
}
```

Set `resetMinUsedPercent` to `0` to restore the previous behavior and show every eligible countdown.

*By @mavam and @codex in #26.*

### Dimmed draft pull request icons

Draft pull request icons now use the theme's dim color, making work-in-progress pull requests visually distinct from ready pull requests in the footer.

*By @mavam and @codex in #27.*
