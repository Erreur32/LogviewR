# LogviewR MCP Server

LogviewR ships its own [Model Context Protocol](https://modelcontextprotocol.io) server, letting an MCP-aware AI client (Claude Code, Claude Desktop, opencode, etc.) inspect fail2ban state, search logs, and, with explicit confirmation, ban/unban IPs or start/stop jails, directly against your LogviewR instance.

This is **not** the same thing as the third-party MCP servers referenced in the repo's `.mcp.json` (SQLite, GitHub), those are external tools *used while developing* LogviewR. This document covers LogviewR's **own** MCP server, exposed for end users to control their fail2ban/log data through an AI agent.

Two transports are available, side by side, sharing the same tools, resources, and audit trail:

| Transport | Who it's for | Auth | Enabled by default |
|---|---|---|---|
| **stdio** (`server/mcp/index.ts`) | A local MCP client on the same machine (Claude Code, Claude Desktop) | None (process trust) | No, requires `mcp_enabled` |
| **HTTP** (`server/mcp/httpTransport.ts`, endpoint `/mcp`) | A remote MCP client (opencode, a client on another host) | Bearer API token | No, requires `mcp_enabled` **and** `mcp_http_enabled` |

## Architecture

```
┌─────────────────────┐        stdio         ┌──────────────────────────┐
│ MCP client            │ ───────────────────▶│ LogviewR MCP server        │
│ (Claude Code/Desktop) │◀─────────────────── │ server/mcp/index.ts         │
└─────────────────────┘                       └──────────────┬────────────┘
                                                               │ reads/writes
                                                               ▼
┌─────────────────────┐   HTTP + Bearer token  ┌─────────────────────────┐
│ Remote MCP client     │ ──────────────────▶  │ /mcp (Express, stateless)│
│ (opencode, etc.)      │◀────────────────────  │ server/mcp/httpTransport │
└─────────────────────┘                        └──────────────┬────────────┘
                                                                │ same tools/resources
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

The stdio process is independent of the web app's Express process, so the web app **cannot start or stop** it, that lifecycle belongs entirely to your MCP client. The HTTP transport, by contrast, is mounted **inside** the existing Express app (same process as `npm run dev` / `npm run start`), so it starts and stops with the web app itself, but still requires its own opt-in flag before it accepts any request.

Both transports check the same `mcp_enabled` flag on every call, so disabling MCP from the admin panel instantly cuts off stdio *and* HTTP agents at once, without restarting anything.

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

## Remote HTTP access (opencode, or any client on another host)

The HTTP transport speaks the MCP protocol's own **Streamable HTTP** wire format (stateless mode), on a single endpoint: `POST /mcp` on the same host/port as the rest of the LogviewR web app (e.g. `http://<logviewr-host>:<port>/mcp`). It is a separate opt-in from the stdio integration above, both can be enabled at once with no conflict.

### 1. Enable the HTTP transport and create a token

From **Settings → MCP → Vue d'ensemble**:
1. Turn on **"Transport HTTP distant activé"**. It is off by default, stdio keeps working unmodified while it's off.
2. Add the IP(s) of your remote agent to the **allowlist** field (comma-separated, single IPs or CIDR ranges, e.g. `192.168.1.50, 10.0.0.0/24`). Leaving it empty allows any IP to attempt authentication, an amber warning appears in the panel and in the server logs when that's the case.

From **Settings → MCP → Jetons d'accès**:
1. Enter a name (e.g. `opencode-dev-server`), pick a **scope** (`Lecture seule` for read-only tools, `Lecture/écriture` to also allow banning/unbanning IPs and starting/stopping jails), and an expiry in days (90 by default, 365 maximum, no unlimited tokens).
2. Click **Créer le jeton**. The raw token (`lvr_mcp_...`) is shown **exactly once**, copy it now, LogviewR only ever stores a SHA-256 hash of it afterwards.
3. Revoke a token any time from the same tab, it takes effect on its very next use.

### 2. Connect from Claude Code / Claude Desktop

Claude Code supports remote HTTP MCP servers natively via `type: "http"`. Either the CLI:

```bash
claude mcp add --transport http logviewr-remote http://<logviewr-host>:<port>/mcp \
  --header "Authorization: Bearer lvr_mcp_xxxxxxxxxxxxxxxxxxxx"
```

or a JSON entry in `.mcp.json` / `.claude.json` (prefer an env var over a hardcoded secret so the token never lands in version control):

```jsonc
{
  "mcpServers": {
    "logviewr-remote": {
      "type": "http",
      "url": "http://<logviewr-host>:<port>/mcp",
      "headers": {
        "Authorization": "Bearer ${LOGVIEWR_MCP_TOKEN}"
      }
    }
  }
}
```

Set `LOGVIEWR_MCP_TOKEN` in your shell environment before starting Claude Code/Desktop. Claude Desktop only supports stdio servers as of this writing, use `claude mcp add` from Claude Code, or check Claude Desktop's current MCP settings UI for remote-server support.

> **Known caveat**: some Claude Code versions have shipped with a bug where custom headers (including `Authorization`) aren't sent on the very first request of a new session (see [anthropics/claude-code#29562](https://github.com/anthropics/claude-code/issues/29562)). If the first tool call after adding the server fails with a `401`/`-32003` but a retry succeeds, this is why, it is a client-side issue, not a LogviewR one. Update Claude Code if you hit it.

### 3. Connect from opencode

opencode's config (`opencode.json`, either project-local or `~/.config/opencode/opencode.json`) supports remote MCP servers via `"type": "remote"`:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "logviewr-remote": {
      "type": "remote",
      "url": "http://<logviewr-host>:<port>/mcp",
      "headers": {
        "Authorization": "Bearer {env:LOGVIEWR_MCP_TOKEN}"
      },
      "enabled": true
    }
  }
}
```

Set `LOGVIEWR_MCP_TOKEN` in the environment opencode runs in. `enabled: false` lets you keep the entry around without connecting, useful when switching between multiple LogviewR instances.

### 4. Manual verification with curl

```bash
curl -X POST http://<logviewr-host>:<port>/mcp \
  -H "Authorization: Bearer lvr_mcp_xxxxxxxxxxxxxxxxxxxx" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```

A working setup returns the same tool list as the stdio transport. `GET` and `DELETE` on `/mcp` always return `405`, this endpoint is stateless-only (no session to resume or delete), `POST` is the only verb it accepts.

### Security checklist for remote HTTP access

- **TLS is mandatory beyond localhost.** Express itself never terminates TLS, if `/mcp` is reachable from outside the host it is running on, put a reverse proxy (Nginx/Caddy/Traefik) in front of it and only expose the proxy's HTTPS port. Sending a bearer token over plain HTTP across a network is equivalent to sending it in cleartext.
- **Configure the IP allowlist.** Either from Settings → MCP → Vue d'ensemble, or the `MCP_HTTP_ALLOWED_IPS` environment variable (CSV of IPs/CIDRs, e.g. `MCP_HTTP_ALLOWED_IPS=192.168.1.50,10.0.0.0/24`), an infra-level floor that survives even if someone clears the DB-stored allowlist from the UI. The two are merged, not replaced.
- **If `/mcp` sits behind a reverse proxy, set `MCP_TRUSTED_PROXY_IPS`.** LogviewR's Express app trusts `X-Forwarded-For` app-wide (needed for other routes), which by itself would let a remote caller spoof that header to forge the IP checked against the allowlist above. To prevent this, `/mcp` only honors `X-Forwarded-For` when the direct TCP peer is a known reverse proxy: `127.0.0.1`/`::1` are trusted by default (covers the common case of a proxy on the same host, e.g. `network_mode: host`), and `MCP_TRUSTED_PROXY_IPS` (CSV of IPs/CIDRs) extends that list for a proxy running elsewhere. A caller that isn't behind a trusted proxy has its own real socket address checked instead, so spoofing the header buys it nothing.
- **Use read-only tokens by default.** Only grant `read_write` scope to agents that actually need to ban/unban IPs or start/stop jails, a compromised read-only token cannot touch fail2ban at all, `runGatedAction` rejects write tools for it before execution, even in dry-run mode.
- **Set a realistic expiry.** 90 days is the default, pick something shorter for a token used in a one-off test. There is no way to create a non-expiring token by design.
- **Rotate, don't reuse.** Revoke and recreate a token if you suspect it leaked (committed to a repo, pasted into a shared chat, etc.), the raw value cannot be retrieved again after creation, so a leaked token cannot be "checked" for compromise, only revoked.
- **Watch the audit trail and security notifications.** Every rejected authentication attempt (bad token, expired token, disallowed IP) is logged via LogviewR's security notification service in addition to `mcp_action_audit`, repeated failures from one IP are a brute-force signal worth investigating.

## Admin panel (Settings → MCP)

LogviewR's web UI has an **MCP tab** in Settings (admin only) with four sub-tabs:

### Vue d'ensemble (Overview)
- **Toggle "Serveur MCP activé"** — writes the `mcp_enabled` flag. When off, *every* MCP tool call and resource read returns an explicit error ("MCP is disabled from the LogviewR admin panel") instead of running, nothing bypasses this, including read-only tools, on either transport.
- **Statut** — last-seen heartbeat (updated on every successful call, from stdio or HTTP), so you can tell whether an agent is actually connected and active, not just whether a process is running (the web app has no visibility into the external stdio process itself).
- **Statistiques** — total / success / error / rejected-unconfirmed counts, pulled from the audit trail.
- **Accès distant HTTP** — the `mcp_http_enabled` toggle and IP allowlist field described above.

### Jetons d'accès (Access tokens)
Create, list, and revoke the bearer tokens used by the HTTP transport (see [Remote HTTP access](#remote-http-access-opencode-or-any-client-on-another-host) above). Each token shows its name, scope, a display-only prefix (never the full secret), creation date, expiry, last-used date, and revocation status.

### Audit
Filterable, paginated view of `mcp_action_audit`, every write attempt (and its outcome) is logged here, regardless of whether it was executed, rejected, rate-limited, or run as a dry-run, from stdio or HTTP alike. The `actor` column distinguishes them: stdio actors use whatever `LOGVIEWR_MCP_ACTOR` was set to, HTTP actors are recorded as `http:<token name>`. Filter by tool name, actor, or result.

### Menaces actives (Active threats)
Live view of `attackCorrelationService.getActiveThreats()`, IPs escalating across multiple jails, or multiple IPs sharing an ASN/netname within a configurable trailing window (1h to 48h). Same detection logic the write tools' `f2b_get_active_threats` tool and the `logviewr://mcp/threats/{windowHours}` resource expose to agents.

## Disabling MCP completely

Toggling **"Serveur MCP activé"** off in **Settings → MCP → Vue d'ensemble** is a complete functional kill switch for LogviewR's MCP surface, on both transports:

| Surface | Gated? |
|---|---|
| 4 write tools (`f2b_ban_ip`, `f2b_unban_ip`, `f2b_jail_start`, `f2b_jail_stop`) | via `runGatedAction` |
| 6 read tools (`f2b_list_jails`, `f2b_jail_status`, `f2b_get_metrics`, `f2b_get_ban_history`, `f2b_lookup_ip`, `f2b_get_active_threats`) | via `withMcpGuard` |
| 2 log-search tools (`log_search`, `log_list_sources`) | via `withMcpGuard` |
| 2 MCP resources (`logviewr://mcp/audit/recent`, `logviewr://mcp/threats/{windowHours}`) | via `assertMcpEnabled()` |
| Entire `/mcp` HTTP endpoint | via `requireMcpToken`, rejects before any tool runs |

The only thing this toggle cannot do is stop the stdio *process* from starting or from answering the MCP protocol handshake (`initialize`, `tools/list`, `resources/list`), that process is owned by your MCP client's own config, not by LogviewR. If you want the process itself to never start, remove the `logviewr` entry from your client's MCP config instead.

To disable **only** the HTTP transport while leaving stdio and the local admin panel untouched, turn off "Transport HTTP distant activé" in the same Overview tab, or set `mcp_http_enabled` to false directly, this is the finer-grained switch for "stop remote access, keep my local Claude Code session working."

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
2. **Scope check** — an HTTP token created with `read` scope is rejected here, before anything else runs, even a `dryRun: true` preview (`result: 'rejected_insufficient_scope'`). stdio callers always carry `read_write` scope, since the stdio transport has no per-token concept. See [Remote HTTP access](#remote-http-access-opencode-or-any-client-on-another-host).
3. **`dryRun: true`** — if set, the action is *not* executed. Returns `{ ok: true, dryRun: true, wouldExecute: { tool, params } }` and logs `result: 'dry_run'`. Use this to preview an action before committing to it.
4. **`confirm` check** — without `confirm: true`, the call is refused *before* touching fail2ban, and logged as `result: 'rejected_unconfirmed'`. This is the safety net against an agent acting on a single ambiguous instruction.
5. **Rate limit** — max **5 confirmed write actions per 60 seconds**, shared process-wide across stdio and HTTP alike (configurable via `LOGVIEWR_MCP_WRITE_RATE_LIMIT` env var). Exceeding it rejects the call with `result: 'rejected_rate_limited'`, before execution. This protects against a runaway agent looping bans. This is separate from the HTTP transport's own request-level rate limit (60 requests/minute per IP on `/mcp`, `server/mcp/httpAuth.ts`), which throttles connection attempts rather than confirmed writes.
6. **Execution** — on success, logs `result: 'success'`; on a thrown error (e.g. `fail2ban-client` failure), logs `result: 'error'` with the message, and still reports `ok: false` to the caller rather than throwing.

Every one of these six outcomes is written to `mcp_action_audit` and visible in the Settings → MCP → Audit tab.

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

- Write tools never run without an explicit `confirm: true` on that exact call, there is no "confirm once, act many times" state.
- The audit trail (`mcp_action_audit`) is append-only and captures rejections as well as executions, so a disabled/misconfigured agent's attempts are still visible in Settings → MCP → Audit.
- The confirmed-write rate limit is per Express/MCP *process* (in-memory, not persisted): for stdio, each MCP client session spawns its own process, so it bounds a single session; for HTTP, the entire remote transport shares one process (and therefore one rate-limit window) across every connected agent, since it is mounted inside the main Express app.
- The `/api/mcp/*` HTTP routes used by the admin panel (`GET/POST /api/mcp/config`, `GET/POST /api/mcp/http-config`, `GET /api/mcp/status`, `GET /api/mcp/audit`, `GET /api/mcp/threats`, `GET/POST /api/mcp/tokens`, `DELETE /api/mcp/tokens/:id`) require an authenticated admin session (`requireAuth` + `requireAdmin`) and are rate-limited to 30 requests/minute. This is a different surface from the `/mcp` transport endpoint itself, which uses bearer tokens instead of the browser session.
- HTTP API tokens (`lvr_mcp_...`) are stored only as a SHA-256 hash, verified with `crypto.timingSafeEqual` to avoid timing side-channels, never logged or returned again after creation.
- `/mcp` requests are checked in this order, each layer independent of the others: `mcp_enabled` + `mcp_http_enabled` (both must be true), then IP allowlist, then bearer token validity (unknown/expired/revoked), then, for write tools, the token's `read`/`read_write` scope. A failure at any layer is logged via `securityNotificationService` and never reaches the MCP protocol handler.
- The HTTP transport runs in **stateless** mode (`sessionIdGenerator: undefined`): no session ID is issued or accepted, so there is no session token to steal or replay, every single request re-authenticates from scratch with its own `Authorization` header.
- Express never terminates TLS for `/mcp` (or for anything else in this app), see the [security checklist](#security-checklist-for-remote-http-access) above for the reverse-proxy requirement.

## Troubleshooting

- **Agent reports "MCP is disabled from the LogviewR admin panel"** → check Settings → MCP → Vue d'ensemble, flip the toggle on. Takes effect on the next tool call, no restart needed.
- **"Last seen" never updates** → the MCP client isn't actually calling any tool/resource yet (the heartbeat only updates on real calls), or the client is pointed at a different `data/dashboard.db` than the web app (check `cwd` in the client config).
- **Write tool always returns `rejected_rate_limited`** → more than 5 confirmed writes happened in the last 60s in that process; wait, or raise `LOGVIEWR_MCP_WRITE_RATE_LIMIT` in the client config's `env`.
- **`f2b_*` tools fail with a jail/exec error** → the MCP process needs the same host access to `fail2ban-client` that the LogviewR web app has (same permissions, same Docker mount if running in a container).

### Remote HTTP transport (`/mcp`)

- **`503` / JSON-RPC `-32001` ("MCP is disabled" or "HTTP transport is disabled")** → two independent toggles gate this endpoint: Settings → MCP → Vue d'ensemble → "Serveur MCP activé" AND "Transport HTTP distant activé" must both be on. Either one off is enough to return this error, on purpose.
- **`403` / JSON-RPC `-32002` ("IP not allowed")** → the caller's IP isn't in the allowlist. Either the allowlist field in Settings → MCP → Vue d'ensemble is non-empty and missing that IP, or `MCP_HTTP_ALLOWED_IPS` in the server's environment is set and missing it. Add the IP (or its CIDR range) to one of the two, or clear the allowlist entirely to allow all IPs (not recommended without a reverse-proxy IP restriction of its own).
- **`403` / JSON-RPC `-32002`, but the allowlist clearly contains the client's real IP** → the request is passing through a reverse proxy that isn't in `MCP_TRUSTED_PROXY_IPS`, so LogviewR is checking the proxy's own IP against the allowlist instead of the forwarded client IP (by design, see the security checklist above). Add the proxy's IP to `MCP_TRUSTED_PROXY_IPS`.
- **`401` / JSON-RPC `-32003` ("Missing or invalid token")** → the `Authorization: Bearer <token>` header is absent, malformed, or the token doesn't match any live entry in Settings → MCP → Jetons d'accès. Tokens are shown in full only once, at creation, if it was lost there's no way to recover it: revoke it and create a new one.
- **`401` / JSON-RPC `-32003` but the token used to work** → it likely expired (default 90 days) or was revoked from the admin panel. Check its row in Settings → MCP → Jetons d'accès: expired/revoked tokens stay listed for audit purposes but no longer authenticate.
- **Write tool call returns `rejected_insufficient_scope`** → the token used has `read` scope, which is rejected before the tool even runs (this check happens before `dryRun` is evaluated, so a dry run with a read-only token is also rejected). Create a new token with `read_write` scope for that agent instead of trying to reuse a read-only one.
- **`curl` to `/mcp` hangs or returns HTML instead of JSON-RPC** → confirm the port and path: `/mcp` is mounted at the app root (not under `/api`), same port as the web UI. If a reverse proxy sits in front, make sure it forwards the `Accept: application/json, text/event-stream` header unmodified and doesn't buffer the response.
- **opencode shows the server as configured but no tools appear** → double-check the `type: "remote"` and `url` fields point at `.../mcp` (not `.../api/mcp`), and that the `Authorization` header is actually being sent (e.g. via `curl` from step 4 above with the same token).
- **First tool call after adding the server to Claude Code fails, then works on retry** → see the [known Claude Code caveat](#2-connect-from-claude-code--claude-desktop) about headers sometimes missing on the first request of a session, not a LogviewR-side issue.
