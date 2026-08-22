This release keeps opt-in extension widgets out of the footer while they have no text to display. It reduces clutter from inactive workflow and agent indicators while preserving default-enabled status icons.

## 🐞 Bug fixes

### Inactive opt-in extension widgets

Opt-in extension widgets now stay out of the footer while their text is empty. This hides the `pi-agents` workflow and agent icons when no workflow is running, while default-enabled icon-only widgets such as pull request CI status remain visible.

*By @mavam in #35.*
