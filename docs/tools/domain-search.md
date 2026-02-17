---
summary: "Domain availability checks, bulk search, TLD info, socials, and offline-first name suggestions"
read_when:
  - You want the domain_search tool
  - You want offline-first domain name suggestions
  - You want a CLI backend to use MCP tools
title: "Domain Search Tool"
---

# Domain search tool

OpenClaw can expose a `domain_search` agent tool via the `domain-search` plugin extension. It is backed by the npm package `domain-search-mcp`.

To enable plugin tools, see [Plugins and tools](/tools/plugin).

## Enabling the plugin

```json5
{
  plugins: {
    entries: {
      "domain-search": {
        enabled: true,
        config: {
          // Optional. Default: "disabled" (offline-first).
          qwenMode: "disabled",
        },
      },
    },
  },
}
```

## Tool: domain_search

All actions return a JSON envelope:

```json
{ "action": "<action>", "result": { "...": "..." } }
```

All actions also support:

- `timeoutMs` (optional): OpenClaw-side timeout guard. Note: upstream requests may still continue in-flight after the timeout.

### action=search_domain

Parameters:

- `domain_name` (required): domain prefix or name to search
  - You can pass a bare name like `vibecoding` (recommended).
  - You can also pass a full domain like `vibecoding.com` and OpenClaw will infer the TLD.
- `tlds` (optional): array of TLDs (for example `["com", "io"]`)
- `registrars` (optional): registrar allowlist

Example:

```js
await domain_search({
  action: "search_domain",
  domain_name: "vibecoding",
  tlds: ["com", "io"],
});
```

### action=bulk_search

Parameters:

- `domains` (required): array of domain prefixes or names
- `tld` (optional): default TLD
- `registrar` (optional): default registrar

### action=suggest_domains_smart

Parameters:

- `query` (required): what you are naming
- `tld` (optional)
- `industry` (optional): one of `tech|startup|finance|health|food|creative|ecommerce|education|gaming|social`
- `style` (optional): one of `brandable|descriptive|short|creative`
- `max_suggestions` (optional)
- `include_premium` (optional)
- `project_context` (optional): `{ name, description, keywords, industry, repository_url }`

### action=tld_info

Parameters:

- `tld` (required)
- `detailed` (optional)

### action=check_socials

Parameters:

- `name` (required)
- `platforms` (optional): array of platforms (for example `["github", "npm"]`)

## Offline first suggestions (default)

By default, the plugin forces `QWEN_INFERENCE_ENDPOINT=disabled` before loading `domain-search-mcp`. This disables upstream public inference and makes `suggest_domains_smart` use the local suggestion engine.

To keep this behavior explicitly:

```json5
{
  plugins: {
    entries: {
      "domain-search": { enabled: true, config: { qwenMode: "disabled" } },
    },
  },
}
```

## Enabling Qwen inference (opt-in)

### Public endpoint

```json5
{
  plugins: {
    entries: {
      "domain-search": { enabled: true, config: { qwenMode: "public" } },
    },
  },
}
```

This enables the upstream default endpoint: `http://95.111.240.197:8000`.

### Custom endpoint

```json5
{
  plugins: {
    entries: {
      "domain-search": {
        enabled: true,
        config: {
          qwenMode: "custom",
          qwenEndpoint: "https://your-inference.example.com",
          qwenApiKey: "YOUR_API_KEY",
        },
      },
    },
  },
}
```

## Pricing backend and registrar keys (optional)

The plugin maps config keys to `domain-search-mcp` environment variables:

- Pricing backend: `pricingApiBaseUrl`, `pricingApiToken`
  - Note: `domain-search-mcp` blocks localhost and private network ranges for pricing base URLs.
- Porkbun: `porkbunApiKey`, `porkbunApiSecret`
- Namecheap: `namecheapApiKey`, `namecheapApiUser`, `namecheapClientIp`
- Redis: `redisUrl`
- Logging: `logLevel`

## CLI backend MCP tools (opt-in)

OpenClaw CLI backends (for example `claude-cli` or `codex-cli`) normally get an extra system prompt line:

`Tools are disabled in this session. Do not call tools.`

To allow the CLI backend native tool system (including MCP servers), set:

- `agents.defaults.cliBackends.<id>.nativeTools: true`

Example:

```json5
{
  agents: {
    defaults: {
      cliBackends: {
        "claude-cli": {
          command: "claude",
          nativeTools: true,
        },
      },
    },
  },
}
```

Then add an `.mcp.json` file in your agent workspace directory:

```json
{
  "mcpServers": {
    "domain-search": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "domain-search-mcp@latest"]
    }
  }
}
```

Security note: when `nativeTools=true`, OpenClaw tool policy and sandbox controls do not apply to whatever tools the external CLI chooses to run.
