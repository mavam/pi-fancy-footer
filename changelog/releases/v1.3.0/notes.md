The provider status footer now displays Claude usage limits alongside Codex quotas, and hides the Codex status for non-OpenAI models.

## 🚀 Features

### Claude usage limits in provider status

The `provider-status` widget can now show Claude usage limits alongside Codex quotas.

Enable the Anthropic provider adapter with:

```json
{
  "providerStatus": {
    "providers": ["openai-codex", "anthropic"]
  }
}
```

Claude-backed models display the current 5-hour session window and weekly usage window, matching the usage information shown in Claude.ai settings.

*By @mavam and @codex in #11.*

## 🐞 Bug fixes

### Conditional provider status visibility

The `provider-status` widget now stays hidden when the active model is not OpenAI/Codex-backed. Previously, cached Codex quota information could still appear after switching to a non-OpenAI model.

*By @mavam and @codex in #10.*
