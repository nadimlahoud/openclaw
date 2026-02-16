---
name: msgvault
description: Search and retrieve archived email from msgvault using msgvault_search, msgvault_get_message, msgvault_list_accounts, and msgvault_stats tools.
metadata:
  { "openclaw": { "emoji": "📬", "requires": { "config": ["plugins.entries.msgvault.enabled"] } } }
---

# msgvault

Use msgvault tools when the user asks about archived email search, message lookup, account stats, or account sync status.

## When to use

- Search historical email by people, topics, or date ranges.
- Open a specific archived message id to inspect full contents.
- Check what accounts are connected to msgvault.
- Check aggregate archive stats.

## Tool flow

1. Start with `msgvault_search` for discovery.
2. Use `msgvault_get_message` only for messages the user wants to inspect deeply.
3. Use `msgvault_list_accounts` when account scope is unclear.
4. Use `msgvault_stats` for high-level totals and health checks.

## Account routing

- If the user asks for one account explicitly, pass `account` in `msgvault_search`.
- If account is ambiguous, ask whether they mean work or personal archive.
- Default account routing:
  - Work archive queries route to `nadim.lahoud@redsift.io`.
  - Personal or iCloud-history queries route to `nadimlahoud@gmail.com`.
- Prefer explicit account filters for high-confidence retrieval.

## Sync safety

- Do not call `msgvault_sync_account` unless the user explicitly asks to run sync.
- If the tool is policy-disabled, explain that sync is disabled in plugin config.
