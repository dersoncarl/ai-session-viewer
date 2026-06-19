# AI Session Viewer

> Status: This project has currently only been tested with Codex JSONL session data. Additional AI session formats may be supported later.

A local web UI for listing, previewing, opening, and deleting AI session logs.

The app runs only on your machine and reads local session data from `SESSION_HOME`.

## Features

- List local session logs from `SESSION_HOME/sessions/**/*.jsonl`
- Group sessions by their recorded working directory
- Search by title, prompt, folder, or session ID
- Preview the latest user prompt and AI response
- Open a fullscreen read-only chat transcript
- Move sessions to a local trash folder instead of deleting them permanently
- Optional macOS autostart via LaunchAgent

## Requirements

- Node.js 20 or newer
- A local session data folder

## Quick Start

```bash
npm install
cp .env.example .env
npm start
```

The app prefers `http://127.0.0.1:8787`. If that port is already in use, it automatically picks the next available port.

The active URL is written to:

```bash
.url
```

## Configuration

Edit `.env` after copying `.env.example`:

```bash
SESSION_HOME=$HOME/.ai-sessions
PORT=8787
SESSION_CACHE_TTL_MS=5000
DELETE_MODE=archive
```

Options:

- `SESSION_HOME`: Local session data folder.
- `PORT`: Preferred local port.
- `SESSION_CACHE_TTL_MS`: Session scan cache duration in milliseconds.
- `DELETE_MODE`: Delete behavior. Use `archive` or `hard`. Defaults to `archive`.

Folder labels in the sidebar are generated automatically from each session's `cwd`.

## Alternative Config File

You can use `config.json` instead of `.env`:

```bash
cp config.example.json config.json
```

Example:

```json
{
  "sessionHome": "$HOME/.ai-sessions",
  "port": 8787,
  "cacheTtlMs": 5000,
  "deleteMode": "archive"
}
```

Config priority:

1. Environment variables passed in the shell
2. `.env`
3. `config.json`
4. Built-in defaults

Example one-off override:

```bash
SESSION_HOME="$HOME/.ai-sessions" PORT=8787 npm start
```

## macOS Autostart

Install the LaunchAgent:

```bash
npm run autostart:install
```

Uninstall it:

```bash
npm run autostart:uninstall
```

Autostart reads `.env` or `config.json` from the app directory.

## Delete Behavior

The default delete mode is `archive`.

### Archive Mode

Set this in `.env`:

```bash
DELETE_MODE=archive
```

In archive mode, deleting a session:

1. Moves matching session JSONL files to `SESSION_HOME/session-trash/<timestamp>-<session-id>/`
2. Removes matching rows from `session_index.jsonl`
3. Removes matching rows from `history.jsonl`
4. Creates `.bak.<timestamp>` backups before rewriting index/history files

This is the safest mode because the original session JSONL files can be recovered from `session-trash`.

### Hard Delete Mode

Set this in `.env`:

```bash
DELETE_MODE=hard
```

In hard delete mode, deleting a session:

1. Permanently removes matching session JSONL files
2. Removes matching rows from `session_index.jsonl`
3. Removes matching rows from `history.jsonl`
4. Creates `.bak.<timestamp>` backups before rewriting index/history files

Use hard delete only if you are sure you do not need to recover the original session JSONL files.
