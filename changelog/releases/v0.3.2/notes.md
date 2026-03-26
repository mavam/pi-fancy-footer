Fixes compatibility with recent pi releases where the extension API changed, restoring the /fancy-footer configuration screen and ensuring custom agent directory setups continue to work.

## 🐞 Bug fixes

### Compatibility with the current pi extension API

The extension now works again with recent pi releases whose extension API changed, including the `/fancy-footer` configuration screen.

It also follows pi's configured agent directory when loading settings and saving `fancy-footer.json`, so custom agent directory setups continue to work.

*By @mavam and @codex in #5.*
