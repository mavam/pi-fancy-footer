---
title: Configurable rainbow pi launch banner
type: feature
authors:
  - mavam
  - codex
created: 2026-03-02T21:13:42.568044Z
---

The extension now shows a rainbow pi-digit banner in the header when pi starts, so sessions open with a recognizable visual identity:

```txt
       3.141592653589793238462643383279
      5028841971693993751058209749445923
     07816406286208998628034825342117067
     9821    48086         5132
    823      06647        09384
   46        09550        58223
             1725         3594
            08128        48111
           74502         84102
          70193          85211        05
        5596446           22948954930381
       9644288             10975665933
```

You can turn the banner off with the `showPiBanner` setting in `~/.pi/agent/fancy-footer.json`, or toggle it from the `/fancy-footer` configuration UI. This makes the banner optional for users who prefer a minimal header while keeping the feature available by default.

Example:

```json
{
  "showPiBanner": false
}
```
