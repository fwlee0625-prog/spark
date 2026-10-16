# Spark

[简体中文](README.zh-CN.md)

A local dashboard for the projects you run every day: **create, start, stop, restart, live logs, port checks, and start/stop a whole group**. Node.js service (Express + SSE) plus a Vue 3 UI, managed as a pnpm monorepo. Cursor / Claude and other MCP clients can drive the same API.

Requires **macOS** first; Linux is unproven; Windows is not supported (depends on `zsh` / `lsof` / `pgrep`).

## Features

- **Projects**: pick a folder or type a path, auto-detect, fill in commands; start / stop / restart
- **Multiple terminals per project**: frontend + backend (or more), each with its own cwd, command, port, and env
- **Detection**: lockfile → pnpm / yarn / npm; `package.json` scripts; Python venv and entry files (suggestions only)
- **Live logs**: SSE with buffer replay, ANSI colors, per-terminal tabs
- **Process trees**: detached process groups, SIGTERM then SIGKILL, port + cwd fallback so vite/webpack children do not linger
- **Ports**: conflict check before start (which project, or which external PID), scan page, `?force=1` to start anyway
- **Groups**: start a group (conflicts are skipped and reported) / stop a group
- **Crash restart**: per-project switch, exponential backoff, cap in Settings
- **Survive Spark exit**: projects keep running by default; the next launch resumes management. See [docs/process-recovery.md](docs/process-recovery.md)
- **Loopback only**: bind `127.0.0.1`, Host/Origin checks, CSRF token

## Quick start

Needs Node.js 20+ and pnpm.

```bash
pnpm install

# Dev: UI at http://127.0.0.1:5173 (Vite, API proxied to 7789)
pnpm dev

# Daily use: build the UI and serve it from the API process (port 7788)
pnpm start
# open http://127.0.0.1:7788
# skip the build: pnpm start:only
```

| Mode | UI | API |
| --- | --- | --- |
| Dev (`pnpm dev`) | http://127.0.0.1:5173 | 7789 |
| Prod (`pnpm start`) | http://127.0.0.1:7788 | 7788 |

Both instances can run at the same time. `pnpm dev` keeps data in `apps/server/data`. `pnpm start` uses `~/.spark` and copies the project `data` folder there on first launch if that directory is still empty. After that they do not share writes. Override the API port with `SPARK_PORT`.

A second `pnpm start` prints a friendly message if the port is taken (Spark is probably already running). Starting without a frontend build also warns instead of failing silently.

More: [docs/configuration.md](docs/configuration.md).

## MCP (let AI manage projects)

Embedded Streamable HTTP endpoint: `http://127.0.0.1:7788/mcp`. Clients share this one entry; Spark does **not** spawn a process per session.

Spark must already be running (`pnpm start`). This repo ships `.cursor/mcp.json` — in Cursor, enable `spark` under Settings → MCP. Other HTTP clients:

```json
{
  "mcpServers": {
    "spark": { "url": "http://127.0.0.1:7788/mcp" }
  }
}
```

Use port `7789` against the dev instance. stdio-only clients can bridge with `npx mcp-remote http://127.0.0.1:7788/mcp`.

Tool list, client notes, and security: [docs/mcp.md](docs/mcp.md).

## Repo layout

```
apps/server      Express: processes, log SSE, detectors, ports, config, /mcp
apps/mcp         MCP tool definitions (library mounted by the server)
apps/web         Vue 3 + Vite + Tailwind v4
packages/shared  Shared types and constants
docs/            Guides
```

## Data

`pnpm dev` stores data in `apps/server/data`. `pnpm start` stores it in `~/.spark` (`SPARK_DATA_DIR` overrides either). Both contain `projects.json`, `settings.json`, app logs, and `runtime/` process records. Copy the folder to back it up. The first `pnpm start` copies `apps/server/data` into `~/.spark` when the home directory has no config yet.

Details: [docs/configuration.md](docs/configuration.md).

## Tests

```bash
pnpm test        # vitest across packages
pnpm typecheck
pnpm lint        # Biome
```

## Roadmap

- Group start order and delay
- Launch at login / tray (optional Tauri shell)
- Linux verification; Windows later if ever
- Health check: treat a reachable port as ready

## License

[MIT](LICENSE) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md) · [Changelog](CHANGELOG.md)
