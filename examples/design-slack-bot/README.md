# Design Slack Bot

A Slack bot that uses the [Shuffle CLI](https://shuffle.dev/design-cli) to create new designs when mentioned in a channel or messaged directly.

The online version of this tool is available at [AI Design](https://shuffle.dev/ai-design) and [AI Website Redesign](https://shuffle.dev/ai-website-redesign).

All the leading AI design models are supported, including Claude Opus, Gemini Pro, GPT, and Kimi.

## Example

![Design Slack Bot](https://static.shuffle.dev/files/1779006626/slack-bot.png)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Authenticate Shuffle on the same user account that will run the bot:

   ```bash
   npx @shuffle-dev/cli auth
   ```

3. Create a Slack app:

   - Start here: https://api.slack.com/apps?new_app=1 
   - Enable Socket Mode (Socket Mode in the menu).
   - Create an App Level Token with `connections:write` (Basic Information → App-Level Tokens).
   - Add bot token scopes (OAuth & Permissions → Bot Token Scopes):
     - `app_mentions:read`
     - `chat:write`
     - `im:history`
   - Subscribe to the `app_mention` bot event (Event Subscriptions → Subscribe to bot events).
   - Subscribe to the `message.im` bot event (Event Subscriptions → Subscribe to bot events).
   - In App Home, enable the Messages tab so users can DM the app.
   - Install the app to your workspace.

4. Create `.env`:

   ```bash
   cp .env.example .env
   ```

   Fill in:

   ```env
   SLACK_BOT_TOKEN=xoxb-... (Bot Token)
   SLACK_APP_TOKEN=xapp-... (App Level Token)
   SLACK_LOG_LEVEL=INFO
   SHUFFLE_MODEL=claude-opus-4-7
   ```

5. Start the bot:

   ```bash
   npm start
   ```

   Or run it in the background:

   ```bash
   npm run start:background
   ```

   Background logs are written to `.runtime/bot.log`.

   Manage the background process:

   ```bash
   npm run status:background
   npm run stop:background
   npm run restart:background
   ```

## Usage

Mention the bot in a channel:

```text
@DesignBot landing page for a B2B support automation platform with dark mode
```

Or send the bot a direct message without the mention:

```text
landing page for a B2B support automation platform with dark mode
```

Start the message with a URL to redesign an existing page:

```text
https://example.com make this feel like a modern analytics dashboard
```

The bot replies in the same channel when Shuffle returns generated edit, preview, and screenshot URLs.

## Shuffle Account 

To use the bot, you must have a Shuffle account and be authenticated on the same user account that runs the bot. The bot uses your Shuffle account via Shuffle CLI to run design models and generate outputs. If you don't have a Shuffle account, you can create one at https://shuffle.dev/.

Design generations consume AI tokens. To verify your token balance, visit https://shuffle.dev/dashboard#/tokens. 

If you run out of tokens, you can purchase more.

## Configuration

- `SLACK_LOG_LEVEL`: Slack SDK logging level. Defaults to `INFO`; use `DEBUG` while diagnosing Socket Mode/event delivery.
- `SHUFFLE_CLI`: CLI command to run. Defaults to npx @shuffle-dev/cli.
- `SHUFFLE_MODEL`: model id to use.
- `SHUFFLE_ALL_MODELS=true`: run all active models instead of one model.
- `SHUFFLE_SCREENSHOT=false`: skip screenshot generation.
- `SHUFFLE_TIMEOUT_MS`: CLI timeout in milliseconds. Defaults to `900000`.

Use either `SHUFFLE_MODEL` or `SHUFFLE_ALL_MODELS=true`. The CLI must run non-interactively for a bot.
