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

function unwrapCjsModule(imported: unknown): Record<string, unknown> | null {
  if (!imported || typeof imported !== "object") {
    return null;
  }
  if ("default" in imported) {
    const def = (imported as { default: unknown }).default;
    if (def && typeof def === "object") {
      return def as Record<string, unknown>;
    }
  }
  return imported as Record<string, unknown>;
}

function parseMoney(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

type PorkbunCheckDomainPayload = {
  status: "SUCCESS" | "ERROR";
  message?: string;
  response?: {
    avail?: string;
    premium?: string;
    price?: string;
    regularPrice?: string;
    additional?: {
      renewal?: { price?: string; regularPrice?: string };
      transfer?: { price?: string; regularPrice?: string };
    };
  };
};

function parsePorkbunCheckDomainResponse(payload: unknown): {
  available: boolean;
  premium: boolean;
  priceFirstYear: number | null;
  priceRenewal: number | null;
  priceTransfer: number | null;
  retailPrice: number | null;
} {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid Porkbun checkDomain response: expected object");
  }
  const record = payload as PorkbunCheckDomainPayload;
  if (record.status !== "SUCCESS") {
    throw new Error(record.message || "Porkbun checkDomain failed");
  }
  const response = record.response;
  if (!response || typeof response !== "object") {
    throw new Error("Invalid Porkbun checkDomain response: missing response");
  }
  const availRaw = typeof response.avail === "string" ? response.avail.toLowerCase() : "";
  const premiumRaw = typeof response.premium === "string" ? response.premium.toLowerCase() : "";
  const available = availRaw === "yes";
  const premium = premiumRaw === "yes";
  const priceFirstYear = parseMoney(response.price);
  const retailPrice = parseMoney(response.regularPrice);
  const renewal = parseMoney(response.additional?.renewal?.price);
  const transfer = parseMoney(response.additional?.transfer?.price);

  return {
    available,
    premium,
    priceFirstYear,
    priceRenewal: renewal,
    priceTransfer: transfer,
    retailPrice,
  };
}

async function patchDomainSearchMcpPorkbun(): Promise<void> {
  // domain-search-mcp 1.10.1 uses the legacy Porkbun endpoint `/domain/check` which currently returns 404.
  // Porkbun's v3 API now exposes domain availability + pricing via:
  //   POST /domain/checkDomain/<fqdn> with JSON body { apikey, secretapikey }.
  //
  // Patch at runtime to keep OpenClaw's `domain_search` tool functional without vendoring/patching deps.
  try {
    const imported = await import("domain-search-mcp/dist/registrars/index.js");
    const mod = unwrapCjsModule(imported);
    if (!mod) {
      return;
    }

    const adapter = mod.porkbunAdapter;
    if (!adapter || typeof adapter !== "object") {
      return;
    }

    const marker = "__openclaw_patched_checkdomain";
    if (marker in adapter) {
      return;
    }
    Object.defineProperty(adapter, marker, { value: true });

    const loggerImported = await import("domain-search-mcp/dist/utils/logger.js");
    const loggerMod = unwrapCjsModule(loggerImported) ?? {};
    // oxlint-disable-next-line typescript/no-explicit-any
    const logger = (loggerMod as any).logger ?? console;

    const errorsImported = await import("domain-search-mcp/dist/utils/errors.js");
    const errorsMod = unwrapCjsModule(errorsImported) ?? {};
    // oxlint-disable-next-line typescript/no-explicit-any
    const AuthenticationError = (errorsMod as any).AuthenticationError as
      | (new (registrar: string, reason?: string) => Error)
      | undefined;

    // oxlint-disable-next-line typescript/no-explicit-any
    const porkbunAdapter = adapter as any;

    // Reduce flakiness for large responses (pricing/get) by increasing default request timeout.
    const timeoutMs = 30_000;
    if (typeof porkbunAdapter.timeoutMs === "number") {
      porkbunAdapter.timeoutMs = timeoutMs;
    }
    if (porkbunAdapter.client?.defaults) {
      porkbunAdapter.client.defaults.timeout = timeoutMs;
    }

    logger.debug("OpenClaw patched domain-search-mcp Porkbun adapter", {
      check_endpoint: "/domain/checkDomain/<fqdn>",
      timeout_ms: timeoutMs,
    });

    const originalGetPricing =
      typeof porkbunAdapter.getPricing === "function"
        ? porkbunAdapter.getPricing.bind(porkbunAdapter)
        : null;

    porkbunAdapter.checkAvailability = async function checkAvailability(
      domain: string,
      tld: string,
    ) {
      const fqdn = `${domain}.${tld}`;
      const result = await this.retryWithBackoff(async () => {
        const path = `/domain/checkDomain/${encodeURIComponent(fqdn)}`;
        const baseURL =
          typeof this.client?.defaults?.baseURL === "string"
            ? this.client.defaults.baseURL
            : undefined;
        logger.debug("Porkbun checkDomain", { method: "POST", base_url: baseURL, path });
        const response = await this.client.post(path, {
          apikey: this.apiKey,
          secretapikey: this.apiSecret,
        });
        logger.debug("Porkbun checkDomain result", {
          method: "POST",
          base_url: baseURL,
          path,
          status: response?.status,
        });
        const parsed = parsePorkbunCheckDomainResponse(response.data);
        return parsed;
      }, `checkDomain ${fqdn}`);

      return {
        available: result.available,
        premium: result.premium,
        // Back-compat for existing adapter behavior.
        price: result.priceFirstYear ?? undefined,
        renewal: result.priceRenewal ?? undefined,
        transfer: result.priceTransfer ?? undefined,
        retailPrice: result.retailPrice ?? undefined,
      };
    };

    porkbunAdapter.search = async function search(domain: string, tld: string) {
      if (!this.isEnabled()) {
        // domain-search-mcp expects an AuthenticationError here.
        if (typeof AuthenticationError === "function") {
          throw new AuthenticationError("porkbun", "API credentials not configured");
        }
        throw new Error("Porkbun API credentials not configured");
      }

      const fullDomain = `${domain}.${tld}`;
      logger.debug("Porkbun search", { domain: fullDomain });

      try {
        const availability = await this.checkAvailability(domain, tld);

        // Only fall back to `/pricing/get` if the per-domain check didn't return a field.
        const pricing =
          (availability?.renewal === undefined ||
            availability?.transfer === undefined ||
            availability?.price === undefined) &&
          originalGetPricing
            ? await originalGetPricing(tld)
            : null;

        return this.createResult(domain, tld, {
          available: availability.available,
          premium: availability.premium,
          price_first_year: availability.price ?? (pricing ? pricing.registration : null) ?? null,
          price_renewal: availability.renewal ?? (pricing ? pricing.renewal : null) ?? null,
          transfer_price: availability.transfer ?? (pricing ? pricing.transfer : null) ?? null,
          privacy_included: true, // Porkbun includes WHOIS privacy
          source: "porkbun_api",
          premium_reason: availability.premium ? "Premium domain" : undefined,
        });
      } catch (error) {
        // Preserve domain-search-mcp's existing error mapping and retry semantics.
        this.handleApiError(error, fullDomain);
        throw error;
      }
    };
  } catch {
    // Best-effort: if domain-search-mcp changes its internals, keep OpenClaw loading.
  }
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
        const mod =
          // oxlint-disable-next-line typescript/no-explicit-any
          unwrapCjsModule(imported) ??
          (((imported as any).default ?? imported) as Record<string, unknown>);

        await patchDomainSearchMcpPorkbun();

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
