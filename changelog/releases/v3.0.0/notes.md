This release delegates pull request status widgets to pi-prs, keeping GitHub polling in its dedicated extension. It also improves data widgets with clickable links, icon-only rendering, and reliable location paths.

## 💥 Breaking changes

### Delegate pull request widgets to pi-prs

The footer no longer talks to GitHub. Pull request number, unresolved review threads, and CI status now come from [pi-prs](https://github.com/mavam/pi-prs), which owns all GitHub polling and publishes the widgets through the data-widget protocol. Data widgets can now provide an HTTP or HTTPS link for their complete rendered content, so the moved pull request widgets remain clickable.

Install pi-prs to show these widgets:

```sh
pi install npm:pi-prs
```

Data widgets can now render an icon without placeholder text. Invalid links are omitted without rejecting the widget update. Merged pull requests use the footer's standard colors, and the `location` widget always shows the path.

*By @mavam.*
