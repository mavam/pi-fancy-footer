This release adds an icon-only GitHub Actions status widget for pull requests and improves settings menu alignment. The footer now makes pull request CI state easier to scan while keeping widget values neatly aligned.

## 🚀 Features

### GitHub Actions PR status widget

The footer can now show an icon-only GitHub Actions status for the current pull request with the emoji palette: ⏳ for running, ❌ for failed, and ✅ for okay. The widget links directly to the relevant workflow run and reports a failure as soon as any workflow fails, even while other workflows are still running.

*By @mavam and @codex in #8.*

## 🐞 Bug fixes

### Aligned settings menu widget values

The `/fancy-footer` settings menu now keeps widget values aligned, including entries with wide Nerd Font icons or long widget names.

Previously, the built-in widget list could show uneven indentation or push values out of alignment, making the selected row look visually offset.

*By @mavam and @codex.*
