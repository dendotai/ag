# 0002. The usage limits come from Claude Code's own `/usage`

**Status:** Accepted

## Context

The desktop app shows the account's 5-hour limit and weekly limit. Anthropic
documents no usage API. Every tracker in use reads one of four sources: the
`/api/oauth/usage` endpoint with Claude Code's OAuth token from the Keychain,
the claude.ai session cookie, the statusline `rate_limits` field, or the
`/usage` screen scraped through a PTY.

The endpoint looks like the natural choice, and it is the one most trackers
make. It needs Claude Code's token, and Claude Code rewrites its Keychain item
on each token refresh. macOS then blocks the other app until the user grants
access again, which is CodexBar's "Claude Code credentials changed. Click
Refresh to re-grant CodexBar access".

`claude -p "/usage"` makes no model call and costs nothing. With
`--output-format stream-json --verbose` its output carries
`usage_report.rate_limits.limits[]`, each limit with `kind`, `percent`,
`resets_at` and `severity`. Underneath, Claude Code calls the same endpoint,
with its own login, token refresh, a 60-second read shared across processes,
and backoff. ag's runner needs `claude` logged in anyway.

## Decision

`ag usage` runs, from the fixed folder `~/.ag/run/usage/`:

```sh
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 claude -p "/usage" \
  --no-session-persistence --output-format stream-json --verbose \
  --safe-mode --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --setting-sources ''
```

and reads `usage_report.rate_limits.limits[]`. A missing `usage_report` shows
as an error, never as a number.

## Consequences

- **Positive:** ag never reads the Keychain or holds a token, and never calls
  Anthropic itself. A login that works for the runner works for the app.
- **Accepted trade-off:** each read is a process: about 2.4 s and 3.5 s of CPU
  on Claude Code 2.1.302. The flags remove plugins, MCP servers, settings and
  nonessential traffic from that cost; without them a call takes 5.5 s.
- **Accepted trade-off:** `usage_report` in print mode is undocumented; the
  docs describe `/usage` as interactive. A Claude Code release can change it.
- **Platform limit:** each call makes Claude Code create
  `~/.claude/projects/<cwd-slug>/`, even with `--no-session-persistence`. The
  fixed folder keeps that to one folder.

## Rejected

- **The endpoint with the Keychain token:** the re-grant prompt above, and
  ag would hold a credential that belongs to Claude Code.
- **The statusline `rate_limits` field:** it needs a running session, takes
  the user's one `statusLine` command, and makes ag a wrapper around it.
- **The claude.ai session cookie:** another app's cookie store, and the most
  fragile of the four.
- **`--bare`:** it never reads the OAuth login, so `/usage` has no plan limits.
- **The `result` text of `/usage`:** written for people, with reset times
  rounded; `usage_report` holds the same data as fields.
- **`cachedUsageUtilization` in `~/.claude.json`:** the same data, but in a
  file every session writes, so a read can meet a half-written file.
