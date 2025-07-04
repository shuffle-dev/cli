# Shuffle CLI

**Command-line tool for managing projects in Shuffle Editor**

Shuffle CLI is a simple tool that lets you download, edit, and sync projects from [Shuffle Editor](https://shuffle.dev) directly from your terminal. No manual installation is required - everything works through `npx`!

## 🚀 Getting Started

**Option 1: Run from npm (recommended):**

```bash
npx @shuffle-dev/cli --help
```

**Option 2: Run directly from GitHub:**

```bash
npx https://github.com/shuffle-dev/cli --help
```

**Option 3: Install globally:**

```bash
npm install -g @shuffle-dev/cli
shuffle --help
```

> **💡** The CLI automatically detects how it was installed and shows appropriate usage instructions:
>
> - When using `npx`, it shows "Usage: npx @shuffle-dev/cli [command]"
> - When installed globally, it shows "Usage: shuffle [command]"

## 📋 Available Commands

> **Note:** In all examples below, you can replace `npx @shuffle-dev/cli` with:
>
> - `npx @shuffle-dev/cli` (if running from npx)
> - `shuffle` (if installed globally)

### Authentication

**Sign in to your Shuffle account:**

```bash
npx @shuffle-dev/cli auth
```

After running this command, your browser will open automatically, allowing you to complete the login process.

**Sign out:**

```bash
npx @shuffle-dev/cli logout
```

### Project Management

**List all your Shuffle projects:**

```bash
npx @shuffle-dev/cli projects
```

**List projects downloaded locally:**

```bash
npx @shuffle-dev/cli list
```

**Download a project:**

```bash
npx @shuffle-dev/cli get PROJECT_ID
```

**Download to a specific location:**

```bash
npx @shuffle-dev/cli get PROJECT_ID ./my-project
```

**Sync changes from Shuffle to your local copy:**

```bash
npx @shuffle-dev/cli sync PROJECT_ID
```

**Interactive sync (choose a project from the list):**

```bash
npx @shuffle-dev/cli sync
```

### Project Status & Maintenance

**Check current directory project status:**

```bash
npx @shuffle-dev/cli status
```

**Clean up invalid project locations:**

```bash
npx @shuffle-dev/cli cleanup
```

## ⭐ Typical Workflow

1. **Sign in**: `npx @shuffle-dev/cli auth`
2. **Check your projects**: `npx @shuffle-dev/cli projects`
3. **Download a project**: `npx @shuffle-dev/cli get PROJECT_ID`
4. **Check project status**: `npx @shuffle-dev/cli status`
5. **Edit project in Shuffle**
6. **Sync changes to your local copy**: `npx @shuffle-dev/cli sync PROJECT_ID`

## 💡 Pro Tips

- Use `npx @shuffle-dev/cli sync` without PROJECT_ID for interactive project selection
- Use `npx @shuffle-dev/cli list` to see what projects you have downloaded locally
- Use `npx @shuffle-dev/cli status` to check if you're in a Shuffle project directory
- Use `npx @shuffle-dev/cli cleanup` to remove references to deleted project folders

## 💻 Requirements

- **Node.js** version 14.0.0 or higher
- **Web browser** for authentication

## 🔧 Troubleshooting

### "shuffle: command not found" error

If you see this error, be sure to:

- You're using `npx` - always use the full command: `npx @shuffle-dev/cli COMMAND`
- Or install globally: `npm install -g @shuffle-dev/cli` then use `shuffle COMMAND`

### Authentication Issues

- Check if your browser is blocking popup windows
- Make sure ports 8080-8085 on localhost are available

### Connection Issues

- Check your internet connection
- Check firewall settings

### File Issues

- Make sure you have write permissions in the target folder
- Check if you have enough disk space

## Help

Have questions or problems? Contact the Shuffle team ([support@shuffle.dev](mailto:support@shuffle.dev)) or report an issue in the project repository.
