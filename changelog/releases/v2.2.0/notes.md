The footer now shows the Claude quota window that applies to the active model, so model-specific caps are visible before they interrupt a session. It continues to prioritize whichever weekly limit has the least headroom.

## 🚀 Features

### Show model-scoped Claude quota limits in the footer

The `provider-status` widget now shows the Claude quota window that applies to the model you are actually using. Anthropic reports model-scoped caps, such as the weekly Fable limit, separately from the account-wide weekly window, so a Fable session that had nearly exhausted its own weekly cap could still show a comfortable all-models percentage in the footer.

The weekly slot now carries the scoped value for the active model — 96% instead of 57% when the Fable cap is nearly gone — and colors it accordingly. The footer keeps the same two gauges and does not grow wider, the value switches as soon as you change models with `/model`, and no extra usage request is made. When the account-wide window is the tighter of the two, it stays on screen, since whichever quota runs out first is the one that ends the session.

*By @mavam.*
