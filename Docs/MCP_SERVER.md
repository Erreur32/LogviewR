# LogviewR MCP Server

LogviewR ships its own [Model Context Protocol](https://modelcontextprotocol.io) server, letting an MCP-aware AI client (Claude Code, Claude Desktop, etc.) inspect fail2ban state, search logs, and — with explicit confirmation — ban/unban IPs or start/stop jails, directly against your LogviewR instance.

This is **not** the same thing as the third-party MCP servers referenced in the repo's `.mcp.json` (SQLite, GitHub) — those are external tools *used while developing* LogviewR. This document covers LogviewR's **own** MCP server, exposed for end users to control their fail2ban/log data through an AI agent.

## Architecture

The MCP server is a **separate stdio process**, launched by your MCP client's own configuration (Claude Code / Claude Desktop), not by the LogviewR web app (`npm run dev` / `npm run start`). It talks directly to LogviewR's SQLite database and to `fail2ban-client` on the host — it does not go through the Express HTTP API.

```
┌─────────────────────┐        stdio        ┌──────────────────────────┐
│ MCP client           │ ───────────────────▶│ LogviewR MCP server       │
│ (Claude Code/Desktop) │◀─────────────────── │ server/mcp/index.ts       │
└─────────────────────┘                      └──────────────┬────────────┘
                                                              │ reads/writes
                                                              ▼
                                              ┌──────────────────────────┐
                                              │ SQLite (data/dashboard.db)│
                                              │ + fail2ban-client (CLI)   │
                                              └──────────────────────────┘
                                                              ▲
                                                              │ same DB
┌─────────────────────┐        HTTP          ┌──────────────┴────────────┐
│ Browser (Settings →  │ ───────────────────▶│ LogviewR Express app       │
│ MCP admin panel)      │◀─────────────────── │ server/index.ts            │
└─────────────────────┘                      └────────────────────────────┘
```

Because the two processes are independent, the web app **cannot start or stop** the MCP process — that lifecycle belongs entirely to your MCP client. What the web app *can* do is flip a database flag (`mcp_enabled`) that the MCP process checks on **every single tool/resource call**, so enabling/disabling from the UI takes effect immediately, without restarting anything.

## Enabling the server in your MCP client

Add an entry to your client's MCP config pointing at this repo, running the `mcp:stdio` script:

```jsonc
// Claude Desktop: claude_desktop_config.json
// Claude Code: .claude.json (project or user scope)
{
  "mcpServers": {
    "logviewr": {
      "command": "npm",
      "args": ["run", "mcp:stdio"],
      "cwd": "/absolute/path/to/LogviewR",
      "env": {
        "LOGVIEWR_MCP_ACTOR": "your-name-or-agent-id"
      }
    }
  }
}
```

- `cwd` must point at the LogviewR repo root (so it reads `data/dashboard.db` and `config/logviewr.conf`).
- `LOGVIEWR_MCP_ACTOR` is optional — it's the string recorded as `actor` in the audit trail for every write action. Defaults to `unknown-mcp-agent` if unset.
- Restart your MCP client after editing its config so it picks up the new server.

Equivalent direct command (useful for manual testing): `npm run mcp:stdio` from the repo root.

## Admin panel (Settings → MCP)

LogviewR's web UI has an **MCP tab** in Settings (admin only) with three sub-tabs:

### Vue d'ensemble (Overview)
- **Toggle "Serveur MCP activé"** — writes the `mcp_enabled` flag. When off, *every* MCP tool call and resource read returns an explicit error ("MCP is disabled from the LogviewR admin panel") instead of running — nothing bypasses this, including read-only tools.
- **Statut** — last-seen heartbeat (updated on every successful call), so you can tell whether an agent is actually connected and active, not just whether the process is running (the web app has no visibility into the external process itself).
- **Statistiques** — total / success / error / rejected-unconfirmed counts, pulled from the audit trail.

### Audit
Filterable, paginated view of `mcp_action_audit` — every write attempt (and its outcome) is logged here, regardless of whether it was executed, rejected, rate-limited, or run as a dry-run. Filter by tool name, actor, or result.

### Menaces actives (Active threats)
Live view of `attackCorrelationService.getActiveThreats()` — IPs escalating across multiple jails, or multiple IPs sharing an ASN/netname within a configurable trailing window (1h–48h). Same detection logic the write tools' `f2b_get_active_threats` tool and the `logviewr://mcp/threats/{windowHours}` resource expose to agents.

## Disabling MCP completely

Toggling the switch off in **Settings → MCP → Vue d'ensemble** is a complete functional kill switch for LogviewR's MCP surface:

| Surface | Gated? |
|---|---|
| 4 write tools (`f2b_ban_ip`, `f2b_unban_ip`, `f2b_jail_start`, `f2b_jail_stop`) | ✅ via `runGatedAction` |
| 6 read tools (`f2b_list_jails`, `f2b_jail_status`, `f2b_get_metrics`, `f2b_get_ban_history`, `f2b_lookup_ip`, `f2b_get_active_threats`) | ✅ via `withMcpGuard` |
| 2 log-search tools (`log_search`, `log_list_sources`) | ✅ via `withMcpGuard` |
| 2 MCP resources (`logviewr://mcp/audit/recent`, `logviewr://mcp/threats/{windowHours}`) | ✅ via `assertMcpEnabled()` |

The only thing the toggle cannot do is stop the stdio *process* from starting or from answering the MCP protocol handshake (`initialize`, `tools/list`, `resources/list`) — that process is owned by your MCP client's own config, not by LogviewR. If you want the process itself to never start, remove the `logviewr` entry from your client's MCP config instead.

## Tools reference

### Read tools (no confirmation required)

| Tool | Description | Parameters |
|---|---|---|
| `f2b_list_jails` | List all configured fail2ban jails. | — |
| `f2b_jail_status` | Failed/banned counts and banned IPs for one jail. | `jail: string` |
| `f2b_get_metrics` | Aggregated fail2ban metrics (jail counts, ban totals, trends). | — |
| `f2b_get_ban_history` | Durable ban history from LogviewR's own DB (survives fail2ban's DB purge). | `ip?`, `jail?`, `days?`, `limit?` (max 1000) |
| `f2b_lookup_ip` | Geo/whois/reverse-DNS for an IP (cache-first, falls back to a live whois lookup). | `ip: string` |
| `f2b_get_active_threats` | Currently active threat clusters (IP escalation / ASN campaigns). | `windowHours?` (max 168, default 6) |
| `log_list_sources` | List configured log sources (plugin IDs, paths) — use to discover valid `pluginIds` before `log_search`. | — |
| `log_search` | Search across configured log sources — mirrors the web UI's "search all logs". | `query: string`, `pluginIds?`, `caseSensitive?`, `useRegex?`, `maxResults?` (max 500) |

### Write tools (require `confirm: true`)

| Tool | Description | Parameters |
|---|---|---|
| `f2b_ban_ip` | Ban an IP in a jail. | `jail: string`, `ip: string`, `reason?`, `confirm?`, `dryRun?` |
| `f2b_unban_ip` | Unban an IP from a jail. | `jail: string`, `ip: string`, `reason?`, `confirm?`, `dryRun?` |
| `f2b_jail_start` | Start a stopped jail. | `jail: string`, `confirm?`, `dryRun?` |
| `f2b_jail_stop` | Stop a running jail. | `jail: string`, `confirm?`, `dryRun?` |

**Every write tool call goes through the same gate** (`server/mcp/auditGate.ts`), in this order:

1. **`mcp_enabled` check** — rejected immediately if MCP is disabled from the admin panel (`result: 'rejected_disabled'`).
2. **`dryRun: true`** — if set, the action is *not* executed. Returns `{ ok: true, dryRun: true, wouldExecute: { tool, params } }` and logs `result: 'dry_run'`. Use this to preview an action before committing to it.
3. **`confirm` check** — without `confirm: true`, the call is refused *before* touching fail2ban, and logged as `result: 'rejected_unconfirmed'`. This is the safety net against an agent acting on a single ambiguous instruction.
4. **Rate limit** — max **5 confirmed write actions per 60 seconds** (configurable via `LOGVIEWR_MCP_WRITE_RATE_LIMIT` env var on the MCP process). Exceeding it rejects the call with `result: 'rejected_rate_limited'`, before execution. This protects against a runaway agent looping bans.
5. **Execution** — on success, logs `result: 'success'`; on a thrown error (e.g. `fail2ban-client` failure), logs `result: 'error'` with the message, and still reports `ok: false` to the caller rather than throwing.

Every one of these five outcomes is written to `mcp_action_audit` and visible in the Settings → MCP → Audit tab.

### Typical write flow for an agent

```
1. f2b_ban_ip { jail: "sshd", ip: "203.0.113.7", dryRun: true }
   → { ok: true, dryRun: true, wouldExecute: {...} }   // preview, nothing happened

2. f2b_ban_ip { jail: "sshd", ip: "203.0.113.7", confirm: true }
   → { ok: true, data: {...} }                          // actually banned, logged
```

## Resources

Two read-only MCP resources expose the same data as the tools above and the admin panel, for clients that prefer browsing resources over calling tools. Both are gated by `mcp_enabled` exactly like the tools.

| URI | Description |
|---|---|
| `logviewr://mcp/audit/recent` | The 50 most recent `mcp_action_audit` entries (JSON). |
| `logviewr://mcp/threats/{windowHours}` | Active threat clusters within the trailing `{windowHours}` hours (JSON template resource — e.g. `logviewr://mcp/threats/6`). |

## Security notes

- Write tools never run without an explicit `confirm: true` on that exact call — there is no "confirm once, act many times" state.
- The audit trail (`mcp_action_audit`) is append-only and captures rejections as well as executions, so a disabled/misconfigured agent's attempts are still visible in Settings → MCP → Audit.
- The rate limit is per MCP *process* (in-memory, not persisted) — since each MCP client session spawns its own process, this bounds runaway behavior within a single session rather than across all sessions globally.
- The `/api/mcp/*` HTTP routes used by the admin panel (`GET/POST /api/mcp/config`, `GET /api/mcp/status`, `GET /api/mcp/audit`, `GET /api/mcp/threats`) require an authenticated admin session (`requireAuth` + `requireAdmin`) and are rate-limited to 30 requests/minute.

## Troubleshooting

- **Agent reports "MCP is disabled from the LogviewR admin panel"** → check Settings → MCP → Vue d'ensemble, flip the toggle on. Takes effect on the next tool call, no restart needed.
- **"Last seen" never updates** → the MCP client isn't actually calling any tool/resource yet (the heartbeat only updates on real calls), or the client is pointed at a different `data/dashboard.db` than the web app (check `cwd` in the client config).
- **Write tool always returns `rejected_rate_limited`** → more than 5 confirmed writes happened in the last 60s in that process; wait, or raise `LOGVIEWR_MCP_WRITE_RATE_LIMIT` in the client config's `env`.
- **`f2b_*` tools fail with a jail/exec error** → the MCP process needs the same host access to `fail2ban-client` that the LogviewR web app has (same permissions, same Docker mount if running in a container).
