The startup banner has been extracted into its own pi-banner package, keeping pi-fancy-footer focused on the footer. Users who relied on the banner must install pi-banner separately.

## 🔧 Changes

### Startup banner moved to pi-banner package

The startup banner has been removed from this package. It is now available as a standalone package.

To continue using the banner, install `pi-banner` separately:

```sh
pi install npm:pi-banner
```

*By @mavam and @claude.*
