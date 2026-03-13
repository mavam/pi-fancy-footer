Fixes a visual glitch in the pull-request widget where the ascii icon family caused a duplicate # to appear before the PR number, rendering as # #4 instead of # 4.

## 🐞 Bug fixes

### Duplicate # in pull-request widget with ascii icon family

The pull-request widget no longer shows a duplicate `#` when using the `ascii` icon family. Previously the widget rendered `# #4` instead of `# 4` because the ASCII icon already supplies `#` as its pull-request symbol and the number text was also prefixed with `#`.

*By @mavam and @claude in #3.*
