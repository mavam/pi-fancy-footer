This initial release introduces pi-fancy-footer, a compact two-line status footer that surfaces model, context usage, cost, and git info at a glance. The extension also ships with an optional rainbow pi-digit launch banner to give sessions a recognizable visual identity.

## 🚀 Features

### Configurable rainbow pi launch banner

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

*By @mavam and @codex.*

### Fancy footer extension for pi

A compact, two-line status footer for pi that surfaces key session details at a glance. The footer displays the active model and thinking level, context window usage with a visual capacity bar, session cost, repository location, branch, commit, and git diff stats.

All widgets are individually configurable via `~/.pi/agent/fancy-footer.json`, with options for visibility, positioning, alignment, colors, and icons. An interactive `/fancy-footer` command lets you tweak the layout directly from within pi.

Install with:

```
pi install npm:pi-fancy-footer
```

*By @mavam and @claude.*
