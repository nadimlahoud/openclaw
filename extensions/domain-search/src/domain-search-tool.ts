import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";

const DOMAIN_SEARCH_ACTIONS = [
  "search_domain",
  "bulk_search",
  "suggest_domains_smart",
  "tld_info",
  "check_socials",
] as const;

const DOMAIN_SUGGEST_INDUSTRIES = [
  "tech",
  "startup",
  "finance",
  "health",
  "food",
  "creative",
  "ecommerce",
  "education",
  "gaming",
  "social",
] as const;

const DOMAIN_SUGGEST_STYLES = ["brandable", "descriptive", "short", "creative"] as const;

const SOCIAL_PLATFORMS = [
  "github",
  "twitter",
  "instagram",
  "linkedin",
  "tiktok",
  "reddit",
  "youtube",
  "npm",
  "pypi",
  "producthunt",
] as const;

type DomainSearchAction = (typeof DOMAIN_SEARCH_ACTIONS)[number];

type DomainSearchPluginConfig = {
  qwenMode?: "disabled" | "public" | "custom";
  qwenEndpoint?: string;
  qwenApiKey?: string;
  pricingApiBaseUrl?: string;
  pricingApiToken?: string;
  porkbunApiKey?: string;
  porkbunApiSecret?: string;
  namecheapApiKey?: string;
  namecheapApiUser?: string;
  namecheapClientIp?: string;
  redisUrl?: string;
  logLevel?: string;
};

type DomainSearchImpl = {
  executeSearchDomain: (input: unknown) => Promise<unknown>;
  executeBulkSearch: (input: unknown) => Promise<unknown>;
  executeSuggestDomainsSmart: (input: unknown) => Promise<unknown>;
  executeTldInfo: (input: unknown) => Promise<unknown>;
  executeCheckSocials: (input: unknown) => Promise<unknown>;
};

export type DomainSearchToolLoadImpl = () => Promise<DomainSearchImpl>;

class ToolInputError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}

type AgentToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details?: unknown;
};

function jsonResult(payload: unknown): AgentToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function looksLikeUrl(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim());
}

function extractHostname(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (looksLikeUrl(trimmed)) {
    try {
      return new URL(trimmed).hostname;
    } catch {
      // Fall back to best-effort parsing below.
    }
  }
  // Best-effort: strip path/query/fragment, then strip port.
  const withoutPath = trimmed.split(/[/?#]/, 1)[0] ?? "";
  const withoutPort = withoutPath.split(":", 1)[0] ?? "";
  return withoutPort.replace(/\.$/, "");
}

function normalizeTld(value: string): string {
  return value.trim().toLowerCase().replace(/^\./, "");
}

function parseApexDomainOrName(value: string): { name: string; tld?: string } {
  const host = extractHostname(value).toLowerCase();
  const parts = host.split(".").filter(Boolean);
  if (parts.length >= 2) {
    return {
      // Ignore subdomains; domain-search-mcp expects the SLD label (no dots).
      name: parts[parts.length - 2] ?? "",
      tld: parts[parts.length - 1] ?? "",
    };
  }
  return { name: host };
}

function readString(params: Record<string, unknown>, key: string, opts?: { required?: boolean }) {
  const raw = params[key];
  if (typeof raw !== "string") {
    if (opts?.required) {
      throw new ToolInputError(`${key} required`);
    }
    return undefined;
  }
  const value = raw.trim();
  if (!value) {
    if (opts?.required) {
      throw new ToolInputError(`${key} required`);
    }
    return undefined;
  }
  return value;
}

function readBoolean(params: Record<string, unknown>, key: string) {
  const raw = params[key];
  return typeof raw === "boolean" ? raw : undefined;
}

function readNumber(params: Record<string, unknown>, key: string) {
  const raw = params[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}

function readStringArray(params: Record<string, unknown>, key: string) {
  const raw = params[key];
  if (Array.isArray(raw)) {
    const values = raw
      .filter((entry) => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean);
    return values.length > 0 ? values : undefined;
  }
  if (typeof raw === "string") {
    const value = raw.trim();
    return value ? [value] : undefined;
  }
  return undefined;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  label: string,
): Promise<T> {
  if (!timeoutMs || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise;
  }
  // NOTE: Promise.race doesn't cancel the underlying work. This is an OpenClaw-side
  // guard to keep tool calls bounded; upstream requests may still continue in-flight.
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      const timer = setTimeout(() => {
        clearTimeout(timer);
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }),
  ]);
}

function applyDomainSearchEnv(config: DomainSearchPluginConfig) {
  const setIfNonEmpty = (key: string, value: unknown) => {
    if (typeof value !== "string") {
      return;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    process.env[key] = trimmed;
  };

  const qwenMode = typeof config.qwenMode === "string" ? config.qwenMode : "disabled";
  if (qwenMode === "public") {
    // Upstream default endpoint; kept explicit so operators can see what is enabled.
    process.env.QWEN_INFERENCE_ENDPOINT = "http://95.111.240.197:8000";
  } else if (qwenMode === "custom") {
    const endpoint = typeof config.qwenEndpoint === "string" ? config.qwenEndpoint.trim() : "";
    if (!endpoint) {
      throw new Error(
        "plugins.entries.domain-search.config.qwenEndpoint required when qwenMode=custom",
      );
    }
    process.env.QWEN_INFERENCE_ENDPOINT = endpoint;
    setIfNonEmpty("QWEN_API_KEY", config.qwenApiKey);
  } else {
    // Disable upstream "zero-config" public inference by forcing an invalid (non-empty) URL.
    process.env.QWEN_INFERENCE_ENDPOINT = "disabled";
  }

  setIfNonEmpty("PRICING_API_BASE_URL", config.pricingApiBaseUrl);
  setIfNonEmpty("PRICING_API_TOKEN", config.pricingApiToken);
  setIfNonEmpty("PORKBUN_API_KEY", config.porkbunApiKey);
  setIfNonEmpty("PORKBUN_API_SECRET", config.porkbunApiSecret);
  setIfNonEmpty("NAMECHEAP_API_KEY", config.namecheapApiKey);
  setIfNonEmpty("NAMECHEAP_API_USER", config.namecheapApiUser);
  setIfNonEmpty("NAMECHEAP_CLIENT_IP", config.namecheapClientIp);
  setIfNonEmpty("REDIS_URL", config.redisUrl);
  setIfNonEmpty("LOG_LEVEL", config.logLevel);
}

function createDefaultLoader(config: DomainSearchPluginConfig): DomainSearchToolLoadImpl {
  let promise: Promise<DomainSearchImpl> | null = null;

  return async () => {
    if (!promise) {
      promise = (async () => {
        applyDomainSearchEnv(config);

        const imported = await import("domain-search-mcp/dist/tools/index.js");
        // domain-search-mcp is CJS; prefer the CJS export bag when present.
        // oxlint-disable-next-line typescript/no-explicit-any
        const mod = ((imported as any).default ?? imported) as Record<string, unknown>;

        const pick = (key: keyof DomainSearchImpl) => {
          const fn = mod[key as string];
          if (typeof fn !== "function") {
            throw new Error(`domain-search-mcp missing export: ${String(key)}`);
          }
          return fn as DomainSearchImpl[typeof key];
        };

        return {
          executeSearchDomain: pick("executeSearchDomain"),
          executeBulkSearch: pick("executeBulkSearch"),
          executeSuggestDomainsSmart: pick("executeSuggestDomainsSmart"),
          executeTldInfo: pick("executeTldInfo"),
          executeCheckSocials: pick("executeCheckSocials"),
        };
      })();
    }
    return await promise;
  };
}

const DomainSearchToolSchema = Type.Object({
  action: Type.Unsafe<DomainSearchAction>({
    type: "string",
    enum: [...DOMAIN_SEARCH_ACTIONS],
  }),
  timeoutMs: Type.Optional(
    Type.Number({
      description:
        "Optional OpenClaw-side timeout for this tool call. Note: underlying upstream requests may continue in-flight after a timeout.",
    }),
  ),

  // search_domain
  domain_name: Type.Optional(Type.String()),
  tlds: Type.Optional(Type.Array(Type.String())),
  registrars: Type.Optional(Type.Array(Type.String())),

  // bulk_search
  domains: Type.Optional(Type.Array(Type.String())),
  tld: Type.Optional(Type.String()),
  registrar: Type.Optional(Type.String()),

  // suggest_domains_smart
  query: Type.Optional(Type.String()),
  industry: Type.Optional(
    Type.Unsafe<(typeof DOMAIN_SUGGEST_INDUSTRIES)[number]>({
      type: "string",
      enum: [...DOMAIN_SUGGEST_INDUSTRIES],
    }),
  ),
  style: Type.Optional(
    Type.Unsafe<(typeof DOMAIN_SUGGEST_STYLES)[number]>({
      type: "string",
      enum: [...DOMAIN_SUGGEST_STYLES],
    }),
  ),
  max_suggestions: Type.Optional(Type.Number()),
  include_premium: Type.Optional(Type.Boolean()),
  project_context: Type.Optional(
    Type.Object({
      name: Type.Optional(Type.String()),
      description: Type.Optional(Type.String()),
      keywords: Type.Optional(Type.Array(Type.String())),
      industry: Type.Optional(Type.String()),
      repository_url: Type.Optional(Type.String()),
    }),
  ),

  // tld_info
  detailed: Type.Optional(Type.Boolean()),

  // check_socials
  name: Type.Optional(Type.String()),
  platforms: Type.Optional(
    Type.Array(
      Type.Unsafe<(typeof SOCIAL_PLATFORMS)[number]>({
        type: "string",
        enum: [...SOCIAL_PLATFORMS],
      }),
    ),
  ),
});

export function createDomainSearchTool(
  api: OpenClawPluginApi,
  opts?: { loadImpl?: DomainSearchToolLoadImpl },
) {
  const pluginConfig = (api.pluginConfig ?? {}) as DomainSearchPluginConfig;
  const loadImpl = opts?.loadImpl ?? createDefaultLoader(pluginConfig);

  return {
    name: "domain_search",
    label: "Domain Search",
    description:
      "Domain availability + naming workflows (search, bulk, socials, TLD info, offline-first suggestions). Backed by domain-search-mcp.",
    parameters: DomainSearchToolSchema,
    async execute(_toolCallId: string, args: Record<string, unknown>) {
      const params = args as Record<string, unknown>;
      const action = readString(params, "action", { required: true }) as DomainSearchAction;
      const timeoutMs = readNumber(params, "timeoutMs");

      const impl = await loadImpl();

      switch (action) {
        case "search_domain": {
          const domainInput = readString(params, "domain_name", { required: true });
          if (!domainInput) {
            throw new ToolInputError("domain_name required");
          }
          const parsed = parseApexDomainOrName(domainInput);
          const domain_name = parsed.name;
          // domain-search-mcp expects `domain_name` without the extension. If a full domain is
          // provided (e.g. "example.com"), infer the TLD and override `tlds` accordingly.
          const tldsRaw = parsed.tld ? [parsed.tld] : readStringArray(params, "tlds");
          const tlds = tldsRaw
            ? tldsRaw.map((tld) => normalizeTld(tld)).filter((tld) => Boolean(tld))
            : undefined;
          const registrars = readStringArray(params, "registrars");
          const result = await withTimeout(
            impl.executeSearchDomain({ domain_name, tlds, registrars }),
            timeoutMs,
            "domain_search.search_domain",
          );
          return jsonResult({ action, result });
        }
        case "bulk_search": {
          const rawDomains = readStringArray(params, "domains");
          if (!rawDomains) {
            throw new ToolInputError("domains required");
          }
          const normalizedDomains: string[] = [];
          const inferredTlds = new Set<string>();
          for (const rawDomain of rawDomains) {
            const parsed = parseApexDomainOrName(rawDomain);
            normalizedDomains.push(parsed.name);
            if (parsed.tld) {
              inferredTlds.add(normalizeTld(parsed.tld));
            }
          }
          if (inferredTlds.size > 1) {
            throw new ToolInputError(
              "bulk_search only supports a single TLD. Pass bare names plus tld, or full domains that all share the same TLD.",
            );
          }

          const tldParamRaw = readString(params, "tld");
          const tldParam = tldParamRaw ? normalizeTld(tldParamRaw) : undefined;
          const inferredTld = inferredTlds.size === 1 ? Array.from(inferredTlds)[0] : undefined;
          if (tldParam && inferredTld && tldParam !== inferredTld) {
            throw new ToolInputError(
              `bulk_search tld mismatch: got tld="${tldParamRaw}" but domains imply tld="${inferredTld}".`,
            );
          }
          const tld = inferredTld ?? tldParam;
          const registrar = readString(params, "registrar");
          const result = await withTimeout(
            impl.executeBulkSearch({ domains: normalizedDomains, tld, registrar }),
            timeoutMs,
            "domain_search.bulk_search",
          );
          return jsonResult({ action, result });
        }
        case "suggest_domains_smart": {
          const query = readString(params, "query", { required: true });
          const tldRaw = readString(params, "tld");
          const tld = tldRaw ? normalizeTld(tldRaw) : undefined;
          const industry = readString(params, "industry");
          const style = readString(params, "style");
          const max_suggestions = readNumber(params, "max_suggestions");
          const include_premium = readBoolean(params, "include_premium");
          const project_context =
            params.project_context && typeof params.project_context === "object"
              ? (params.project_context as Record<string, unknown>)
              : undefined;
          const projectContextPayload = project_context
            ? {
                name: typeof project_context.name === "string" ? project_context.name : undefined,
                description:
                  typeof project_context.description === "string"
                    ? project_context.description
                    : undefined,
                keywords: Array.isArray(project_context.keywords)
                  ? project_context.keywords
                      .filter((k) => typeof k === "string")
                      .map((k) => k.trim())
                      .filter(Boolean)
                  : undefined,
                industry:
                  typeof project_context.industry === "string"
                    ? project_context.industry
                    : undefined,
                repository_url:
                  typeof project_context.repository_url === "string"
                    ? project_context.repository_url
                    : undefined,
              }
            : undefined;

          const result = await withTimeout(
            impl.executeSuggestDomainsSmart({
              query,
              tld,
              industry,
              style,
              max_suggestions,
              include_premium,
              project_context: projectContextPayload,
            }),
            timeoutMs,
            "domain_search.suggest_domains_smart",
          );
          return jsonResult({ action, result });
        }
        case "tld_info": {
          const tldRaw = readString(params, "tld", { required: true });
          if (!tldRaw) {
            throw new ToolInputError("tld required");
          }
          const tld = normalizeTld(tldRaw);
          const detailed = readBoolean(params, "detailed");
          const result = await withTimeout(
            impl.executeTldInfo({ tld, detailed }),
            timeoutMs,
            "domain_search.tld_info",
          );
          return jsonResult({ action, result });
        }
        case "check_socials": {
          const name = readString(params, "name", { required: true });
          const platforms = readStringArray(params, "platforms");
          const result = await withTimeout(
            impl.executeCheckSocials({ name, platforms }),
            timeoutMs,
            "domain_search.check_socials",
          );
          return jsonResult({ action, result });
        }
        default: {
          const exhaustive: never = action;
          throw new ToolInputError(`Unsupported action: ${String(exhaustive)}`);
        }
      }
    },
  };
}

export const __testing = {
  applyDomainSearchEnv,
} as const;
