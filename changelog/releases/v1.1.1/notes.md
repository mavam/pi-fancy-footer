This release keeps pi-fancy-footer compatible with current Pi package scopes and makes extension widget rendering more robust. Users can build against the latest Pi packages and safely display widgets that intentionally omit icons.

## 🐞 Bug fixes

### Iconless extension widgets

Extension widgets without an icon now render safely. Third-party widgets may omit the `icon` field or set it to `false` when they should appear without a leading icon.

*By @aldoborrero in #6.*

### Pi package scope migration compatibility

The extension now works with Pi's new `@earendil-works/*` package scope after the upstream repository migration. Users can install or build the package against current Pi releases without resolving stale `@mariozechner/*` internal package references.

*By @mavam.*
