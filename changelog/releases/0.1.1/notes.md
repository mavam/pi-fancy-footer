Fixes color overrides for styled footer widgets. Widget configuration for `iconColor` and `textColor` now correctly propagates into styled widgets' render functions, and git status icons use semantic colors automatically.

## 🐞 Bug fixes

### Color overrides for styled footer widgets

Widget configuration overrides for `iconColor` and `textColor` were not propagated into styled widgets' render functions. This caused widgets like `git-status` to ignore user-configured colors. The git status icon now also uses semantic colors automatically—warning for behind, accent for ahead or diverged—when the icon color is set to `text`.

*By @mavam and @claude.*
