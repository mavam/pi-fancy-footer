This release makes git status icons use your configured icon color instead of hardcoded blue and yellow. It also fixes duplicate unknown-key errors in config validation with current TypeBox.

## 🐞 Bug fixes

### Fix duplicate unknown-key config errors

Config validation with current TypeBox releases no longer prints a duplicate "schema is false" line for each unknown key.

*By @mavam.*

### Use default color for git status icons

The git ahead, behind, and diverged status icons now use the configured icon color instead of hardcoded accent and warning colors, matching the other footer icons.

*By @mavam.*
