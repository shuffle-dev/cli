# Shuffle CLI

Command-line tool for working with [Shuffle Editor](https://shuffle.dev) projects, design sessions, and redesign sessions from your terminal.

Use it to sign in to Shuffle, list and download projects, sync project files, generate new designs, redesign existing pages, and save generated projects for later use.

## Quick demo

[`examples/design-slack-bot`](./examples/design-slack-bot) contains a Slack bot that uses this CLI to create designs from Slack mentions or direct messages. See the example README for Slack app setup instructions.

## Usage of the Shuffle CLI

Run the CLI with `npx`:

```bash
npx @shuffle-dev/cli --help
```

Or install it globally:

```bash
npm install -g @shuffle-dev/cli
shuffle --help
```

All examples below use `npx @shuffle-dev/cli`. If you installed the CLI globally, replace it with `shuffle`.

## Authentication

Sign in to your Shuffle account:

```bash
npx @shuffle-dev/cli auth
```

Your browser opens automatically so you can complete sign-in.

Sign out:

```bash
npx @shuffle-dev/cli logout
```

## Projects

List your Shuffle projects:

```bash
npx @shuffle-dev/cli projects
```

List projects already downloaded with the CLI:

```bash
npx @shuffle-dev/cli list
```

Download a project:

```bash
npx @shuffle-dev/cli get PROJECT_ID
```

Download a project to a specific folder:

```bash
npx @shuffle-dev/cli get PROJECT_ID ./my-project
```

Sync the latest Shuffle project files to your downloaded copy:

```bash
npx @shuffle-dev/cli sync PROJECT_ID
```

Choose a project interactively and sync it:

```bash
npx @shuffle-dev/cli sync
```

Check project status from a downloaded project folder:

```bash
npx @shuffle-dev/cli status
```

Clean up saved references to folders that no longer exist:

```bash
npx @shuffle-dev/cli cleanup
```

## Design
This command creates new projects based on a text description using top generative AI models. You can choose from available models, generate screenshots, and download generated files. The online version of this feature is available at [AI Design Arena](https://shuffle.dev/ai-design).

List available Design models:

```bash
npx @shuffle-dev/cli design models
```

Create a Design session:

```bash
npx @shuffle-dev/cli design create "Landing page for a B2B support automation platform"
```

Create a Design session and run every active model without opening the model picker:

```bash
npx @shuffle-dev/cli design create "Landing page for a B2B support automation platform" --all
```

Create a Design session with a specific model:

```bash
npx @shuffle-dev/cli design create "Landing page for a B2B support automation platform" --model claude-opus-4-6
```

Generate screenshots for created projects:

```bash
npx @shuffle-dev/cli design create "Landing page for a B2B support automation platform" --screenshot
```

Save the generated edit, preview, and screenshot URLs to a file for later use with AI agents or manual review:

```bash
npx @shuffle-dev/cli design create "Landing page for a B2B support automation platform" --screenshot --save-output ./shuffle-output.txt
```

Download generated project files after each successful run:

```bash
npx @shuffle-dev/cli design create "Landing page for a B2B support automation platform" --download ./generated
```

Download only source files:

```bash
npx @shuffle-dev/cli design create "Landing page for a B2B support automation platform" --download ./generated --source-only
```

List and inspect Design and Redesign sessions:

```bash
npx @shuffle-dev/cli design sessions
npx @shuffle-dev/cli design show SESSION_HASH
```

Generate or refresh a screenshot for a generated project:

```bash
npx @shuffle-dev/cli design screenshot PROJECT_SESSION_ID
```

## Redesign
This command redesigns an existing web page based on a text description using top generative AI models. You can choose from available models, generate screenshots of new projects, and download generated files. The online version of this feature is available at [AI Website Redesign](https://shuffle.dev/ai-website-redesign).

Create a Redesign session from an existing URL:

```bash
npx @shuffle-dev/cli redesign create https://example.com "Keep the content, make it modern"
```

Run every active Redesign-capable model:

```bash
npx @shuffle-dev/cli redesign create https://example.com "Keep the content, make it modern" --all
```

Create a Redesign session with screenshots and saved output:

```bash
npx @shuffle-dev/cli redesign create https://example.com "Keep the content, make it modern" --screenshot --save-output ./redesign-output.txt
```

## Design and Redesign Options

The `design create` and `redesign create` commands support these options:

- `--model <id>`: Run one model. You can repeat the option or pass comma-separated model IDs.
- `--all`: Run all active models without opening the model picker.
- `--download [directory]`: Download generated project files after each successful run.
- `--source-only`: When used with `--download`, download only source files.
- `--screenshot`: Generate a screenshot for each project after it is created.
- `--save-output <file>`: Save generated project URLs to a file. When used with `--screenshot`, screenshot URLs are included too.

## Typical Workflow

1. Sign in: `npx @shuffle-dev/cli auth`
2. List projects: `npx @shuffle-dev/cli projects`
3. Download a project: `npx @shuffle-dev/cli get PROJECT_ID`
4. Edit the project in Shuffle
5. Sync the latest files: `npx @shuffle-dev/cli sync PROJECT_ID`

## Troubleshooting

### `shuffle: command not found`

Use the full `npx` command:

```bash
npx @shuffle-dev/cli COMMAND
```

Or install the CLI globally:

```bash
npm install -g @shuffle-dev/cli
shuffle COMMAND
```

### Authentication Issues

- Make sure your browser allows the sign-in page to open.
- Make sure ports 8080-8085 on localhost are available for the sign-in callback.

### Connection Issues

- Check your internet connection.
- Check firewall or proxy settings if your network blocks outbound requests.

### File Issues

- Make sure you have write permissions in the target folder.
- Check that the target disk has enough free space.

## Help

Need help? Contact the Shuffle team at [support@shuffle.dev](mailto:support@shuffle.dev) or report an issue in the project repository.
