import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { jsonResult } from "openclaw/plugin-sdk";

type MsgvaultPluginConfig = {
  baseUrl?: string;
  apiKeyEnv?: string;
  timeoutMs?: number;
  allowSync?: boolean;
  defaultAccount?: string;
};

type RequestOptions = {
  method?: "GET" | "POST";
  query?: Record<string, string | number>;
  body?: unknown;
  requireAuth?: boolean;
};

const DEFAULT_BASE_URL = "http://127.0.0.1:8080";
const DEFAULT_API_KEY_ENV = "MSGVAULT_API_KEY";
const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 120_000;
const MAX_REQUEST_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 200;
const MAX_RETRY_DELAY_MS = 2_000;

function clampTimeoutMs(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(value)));
}

function normalizeBaseUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return DEFAULT_BASE_URL;
  }
  return value.trim().replace(/\/+$/, "");
}

function normalizeAccount(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizePositiveInt(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  const rounded = Math.floor(value);
  if (rounded < 1) {
    return fallback;
  }
  return Math.min(max, rounded);
}

function extractErrorMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const record = payload as Record<string, unknown>;
  const msg = record.message;
  if (typeof msg === "string" && msg.trim()) {
    return msg.trim();
  }
  const err = record.error;
  if (typeof err === "string" && err.trim()) {
    return err.trim();
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }

  const seconds = Number.parseInt(trimmed, 10);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }

  const absoluteMs = Date.parse(trimmed);
  if (!Number.isNaN(absoluteMs)) {
    return Math.max(0, absoluteMs - Date.now());
  }
  return undefined;
}

function computeRetryDelayMs(retryAfter: string | null | undefined, attempt: number): number {
  const fromHeader = parseRetryAfterMs(retryAfter);
  if (fromHeader !== undefined) {
    return Math.min(MAX_RETRY_DELAY_MS, fromHeader);
  }
  const backoff = BASE_RETRY_DELAY_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(MAX_RETRY_DELAY_MS, backoff);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableTransportError(err: unknown): boolean {
  if (!(err instanceof Error)) {
    return false;
  }
  const msg = err.message.toLowerCase();
  return (
    msg.includes("timeout") ||
    msg.includes("aborted") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("socket") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset")
  );
}

function buildToolError(
  status: number,
  payload: unknown,
  context: {
    apiKeyEnv: string;
    retryAfter?: string | null;
  },
): Error {
  const detail = extractErrorMessage(payload);
  if (status === 401) {
    const suffix = detail ? ` (${detail})` : "";
    return new Error(
      `msgvault authentication failed (401). Set ${context.apiKeyEnv} to a valid msgvault API key.${suffix}`,
    );
  }
  if (status === 404) {
    return new Error(detail || "msgvault resource not found (404).");
  }
  if (status === 409) {
    return new Error(detail || "msgvault conflict (409): sync likely already in progress.");
  }
  if (status === 429) {
    const retryMsg = context.retryAfter ? ` Retry-After: ${context.retryAfter}s.` : "";
    return new Error(detail || `msgvault rate limited request (429). Retry shortly.${retryMsg}`);
  }
  if (status >= 500) {
    return new Error(detail || `msgvault server error (${status}). Retry in a moment.`);
  }
  return new Error(detail || `msgvault request failed with status ${status}.`);
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function getApiKey(config: { apiKeyEnv: string }): string | undefined {
  const envName = config.apiKeyEnv || DEFAULT_API_KEY_ENV;
  const fromNamed = process.env[envName];
  if (fromNamed && fromNamed.trim()) {
    return fromNamed.trim();
  }
  if (envName !== DEFAULT_API_KEY_ENV) {
    const fallback = process.env[DEFAULT_API_KEY_ENV];
    if (fallback && fallback.trim()) {
      return fallback.trim();
    }
  }
  return undefined;
}

function resolveConfig(raw: unknown): {
  baseUrl: string;
  apiKeyEnv: string;
  timeoutMs: number;
  allowSync: boolean;
  defaultAccount?: string;
} {
  const cfg =
    raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as MsgvaultPluginConfig) : {};
  const apiKeyEnv =
    typeof cfg.apiKeyEnv === "string" && cfg.apiKeyEnv.trim()
      ? cfg.apiKeyEnv.trim()
      : DEFAULT_API_KEY_ENV;
  const defaultAccount = normalizeAccount(cfg.defaultAccount);
  return {
    baseUrl: normalizeBaseUrl(cfg.baseUrl),
    apiKeyEnv,
    timeoutMs: clampTimeoutMs(cfg.timeoutMs),
    allowSync: cfg.allowSync === true,
    ...(defaultAccount ? { defaultAccount } : {}),
  };
}

async function requestJson(
  cfg: {
    baseUrl: string;
    apiKeyEnv: string;
    timeoutMs: number;
  },
  path: string,
  opts: RequestOptions = {},
): Promise<unknown> {
  const method = opts.method ?? "GET";
  const requireAuth = opts.requireAuth ?? true;
  const url = new URL(path.startsWith("/") ? path : `/${path}`, `${cfg.baseUrl}/`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {};
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
  }

  if (requireAuth) {
    const apiKey = getApiKey(cfg);
    if (!apiKey) {
      throw new Error(`Missing msgvault API key. Set ${cfg.apiKeyEnv} in the gateway environment.`);
    }
    headers.authorization = `Bearer ${apiKey}`;
  }

  for (let attempt = 1; attempt <= MAX_REQUEST_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(cfg.timeoutMs),
      });
    } catch (err) {
      if (attempt < MAX_REQUEST_ATTEMPTS && isRetryableTransportError(err)) {
        await sleep(computeRetryDelayMs(null, attempt));
        continue;
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `msgvault request failed (${method} ${url.pathname}): ${msg}. Ensure msgvault serve is running.`,
      );
    }

    const payload = await readPayload(response);
    if (response.ok) {
      return payload;
    }

    if (attempt < MAX_REQUEST_ATTEMPTS && isRetryableStatus(response.status)) {
      await sleep(computeRetryDelayMs(response.headers.get("retry-after"), attempt));
      continue;
    }

    throw buildToolError(response.status, payload, {
      apiKeyEnv: cfg.apiKeyEnv,
      retryAfter: response.headers.get("retry-after"),
    });
  }

  throw new Error(`msgvault request failed (${method} ${url.pathname}) after retry attempts.`);
}

const SearchToolSchema = Type.Object({
  query: Type.String({ description: "Search query string (same as msgvault API q)." }),
  page: Type.Optional(Type.Integer({ minimum: 1, description: "Page number (default: 1)." })),
  page_size: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 100, description: "Page size (default: 20)." }),
  ),
  account: Type.Optional(
    Type.String({ description: "Optional account email filter for multi-account archives." }),
  ),
});

const GetMessageToolSchema = Type.Object({
  id: Type.Integer({ minimum: 1, description: "msgvault internal message id." }),
});

const SyncToolSchema = Type.Object({
  account: Type.String({ description: "Account email to sync (incremental)." }),
});

const EmptySchema = Type.Object({});

const msgvaultPlugin = {
  id: "msgvault",
  name: "msgvault",
  description: "Search and retrieve local msgvault archives.",
  register(api: OpenClawPluginApi) {
    const cfg = resolveConfig(api.pluginConfig);

    api.registerTool({
      name: "msgvault_search",
      label: "msgvault Search",
      description: "Search messages in msgvault archive.",
      parameters: SearchToolSchema,
      async execute(_id: string, params: Record<string, unknown>) {
        const query = typeof params.query === "string" ? params.query.trim() : "";
        if (!query) {
          throw new Error("query required");
        }
        const page = normalizePositiveInt(params.page, 1, 100_000);
        const pageSize = normalizePositiveInt(params.page_size, 20, 100);
        const account = normalizeAccount(params.account) ?? cfg.defaultAccount;

        const payload = await requestJson(cfg, "/api/v1/search", {
          query: {
            q: query,
            page,
            page_size: pageSize,
            ...(account ? { account } : {}),
          },
        });
        return jsonResult({
          ...(payload as Record<string, unknown>),
          _meta: {
            source: "msgvault_search",
            ...(account ? { account } : {}),
          },
        });
      },
    });

    api.registerTool({
      name: "msgvault_get_message",
      label: "msgvault Get Message",
      description: "Get a full message record from msgvault by id.",
      parameters: GetMessageToolSchema,
      async execute(_id: string, params: Record<string, unknown>) {
        const rawId = params.id;
        const id =
          typeof rawId === "number" && Number.isFinite(rawId) ? Math.floor(rawId) : Number.NaN;
        if (!Number.isInteger(id) || id < 1) {
          throw new Error("id must be a positive integer");
        }
        const payload = await requestJson(cfg, `/api/v1/messages/${id}`);
        return jsonResult(payload);
      },
    });

    api.registerTool({
      name: "msgvault_list_accounts",
      label: "msgvault List Accounts",
      description: "List configured msgvault accounts and sync status.",
      parameters: EmptySchema,
      async execute() {
        const payload = await requestJson(cfg, "/api/v1/accounts");
        return jsonResult(payload);
      },
    });

    api.registerTool({
      name: "msgvault_stats",
      label: "msgvault Stats",
      description: "Read aggregate archive stats from msgvault.",
      parameters: EmptySchema,
      async execute() {
        const payload = await requestJson(cfg, "/api/v1/stats");
        return jsonResult(payload);
      },
    });

    api.registerTool({
      name: "msgvault_sync_account",
      label: "msgvault Sync Account",
      description: "Trigger an incremental sync for an account in msgvault.",
      parameters: SyncToolSchema,
      async execute(_id: string, params: Record<string, unknown>) {
        if (!cfg.allowSync) {
          throw new Error(
            "msgvault_sync_account is disabled by policy (plugins.entries.msgvault.config.allowSync=false).",
          );
        }
        const account = normalizeAccount(params.account);
        if (!account) {
          throw new Error("account required");
        }
        const payload = await requestJson(cfg, `/api/v1/sync/${encodeURIComponent(account)}`, {
          method: "POST",
          body: {},
        });
        return jsonResult(payload);
      },
    });
  },
};

export default msgvaultPlugin;
