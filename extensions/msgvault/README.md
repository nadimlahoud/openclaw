# msgvault (plugin)

Integrates [msgvault](https://github.com/wesm/msgvault) with OpenClaw via typed tools and a companion skill.

## Tools

- `msgvault_search`
- `msgvault_get_message`
- `msgvault_list_accounts`
- `msgvault_stats`
- `msgvault_sync_account` (policy-gated; disabled by default)

## Configure

```json5
{
  plugins: {
    entries: {
      msgvault: {
        enabled: true,
        config: {
          baseUrl: "http://127.0.0.1:8080",
          apiKeyEnv: "MSGVAULT_API_KEY",
          timeoutMs: 10000,
          allowSync: false,
          defaultAccount: "archive@example.com",
        },
      },
    },
  },
}
```

Then set the API key in the gateway environment:

```bash
export MSGVAULT_API_KEY="your-msgvault-api-key"
```

## Notes

- Keep msgvault bound to loopback whenever possible.
- Keep `allowSync: false` unless you explicitly want write actions from the agent.
