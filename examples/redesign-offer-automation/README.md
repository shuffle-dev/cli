# Redesign Offer Automation

This tool automates personalized web design outreach using the [Shuffle CLI](https://shuffle.dev/design-cli) redesign engine. The tool generates redesigns of prospect websites, lets you preview them locally before delivery, and sends polished outreach emails with redesign links via Resend.

1. `npm run redesigns` generates redesigns for prospect websites and updates the prospect objects with the output file paths in the `redesign` column.
2. `npm run preview` starts a local preview server for all generated redesigns.
3. `npm run send-emails` reads the redesign output files, sends them to prospects via Resend, and stores the sent datetime in `email_sent`.

## Setup

Install dependencies:

```bash
npm install
```

Authenticate Shuffle on the same user account that will run the automation:

```bash
npx @shuffle-dev/cli auth
```

Create `.env`:

```bash
cp .env.example .env
```

Set either:

```env
SHUFFLE_MODEL=claude-opus-4-7
```

or:

```env
SHUFFLE_ALL_MODELS=true
```

For email sending, also set:

```env
RESEND_API_KEY=re_...
EMAIL_FROM=Offers <offers@example.com>
EMAIL_SUBJECT=Redesign proposal for your website
```

Customize the generated outreach before running the automation:

- Edit `email-template.html` in this directory to change the HTML email content and styling.
- Edit `REDESIGN_PROMPT` in `src/shuffle.js` to change the default redesign prompt used by `npm run redesigns`.
- For a one-off prompt override, run `npm run redesigns -- --prompt "Your redesign instructions here"`.

## Prospects

`prospects.json` contains an array of prospect objects:

```json
[
  {
    "email": "name@example.com",
    "url": "https://example.com",
    "redesign": "",
    "email_sent": ""
  }
]
```

Leave `redesign` empty when the prospect needs a new redesign. Leave `email_sent` empty when the email still needs to be sent. After a successful send, `email_sent` is stored as `YYYY-MM-DD HH:mm`.

## Commands

Create missing redesigns:

```bash
npm run redesigns
```

Override the default redesign prompt for one run:

```bash
npm run redesigns -- --prompt "Keep the content, make the page feel more premium and conversion-focused"
```

Send emails for prospects with a redesign file and empty `email_sent`:

```bash
npm run send-emails
```

The email command uses `EMAIL_SUBJECT` as the subject exactly as written. It renders `email-template.html` from the example root and passes these parameters into it:

- `subject`: escaped email subject.
- `email`: escaped recipient email.
- `websiteUrl`: escaped prospect website URL.
- `modelsHtml`: generated HTML for all model responses found in the Shuffle output, with screenshot images linked to preview URLs.

Preview generated redesigns:

```bash
npm run preview
```

The preview server lists only prospects where `redesign` points to an output file. Each prospect shows the email, website URL, and model previews in columns.

Use the prospect `DELETE` button to clear that prospect's `redesign` value in `prospects.json`. Use a model `DELETE` button to remove that model response from the saved output file (it won't be included in the email).

## Shuffle Account 

To use the tool, you must have a Shuffle account and be authenticated on the same user account that runs it. The tool uses your Shuffle account via Shuffle CLI to create redesign. If you don't have a Shuffle account, you can create one at https://shuffle.dev/.

Design generations consume AI tokens. To verify your token balance, visit https://shuffle.dev/dashboard#/tokens. 

If you run out of tokens, you can purchase more.

## Configuration

- `SHUFFLE_CLI`: CLI command to run. Defaults to `npx @shuffle-dev/cli`.
- `SHUFFLE_MODEL`: model id to use.
- `SHUFFLE_ALL_MODELS=true`: run all active redesign-capable models.
- `SHUFFLE_SCREENSHOT=false`: skip screenshot generation.
- `SHUFFLE_TIMEOUT_MS`: CLI timeout in milliseconds. Defaults to `900000`.
- `RESEND_API_KEY`: Resend API key.
- `EMAIL_FROM`: verified sender used by Resend.
- `EMAIL_SUBJECT`: email subject line. This is not templated.
- `EMAIL_REPLY_TO`: optional reply-to address.
- `PREVIEW_HOST`: local preview server host. Defaults to `127.0.0.1`.
- `PREVIEW_PORT`: local preview server port. Defaults to `3333`.
