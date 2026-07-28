---
title: Conditional provider reset countdowns
type: feature
authors:
  - mavam
  - codex
created: 2026-07-28T10:00:10.097541Z
---

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
