import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import register from "./index.js";

type RegisteredTool = {
  name: string;
  execute: (id: string, params?: Record<string, unknown>) => Promise<unknown>;
};

function createApi(overrides?: Record<string, unknown>) {
  const tools: RegisteredTool[] = [];
  return {
    tools,
    api: {
      id: "msgvault",
      name: "msgvault",
      source: "test",
      pluginConfig: {},
      config: {},
      runtime: {},
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      registerTool: vi.fn((tool: RegisteredTool) => {
        tools.push(tool);
      }),
      ...(overrides ?? {}),
    },
  };
}

function getTool(tools: RegisteredTool[], name: string): RegisteredTool {
  const tool = tools.find((entry) => entry.name === name);
  if (!tool) {
    throw new Error(`missing tool: ${name}`);
  }
  return tool;
}

describe("msgvault plugin", () => {
  const originalFetch = globalThis.fetch;
  const originalMsgvaultApiKey = process.env.MSGVAULT_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MSGVAULT_API_KEY = "test-key";
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalMsgvaultApiKey === undefined) {
      delete process.env.MSGVAULT_API_KEY;
    } else {
      process.env.MSGVAULT_API_KEY = originalMsgvaultApiKey;
    }
  });

  it("registers all tools", () => {
    const { tools, api } = createApi();
    register.register(api as never);
    expect(tools.map((t) => t.name)).toEqual([
      "msgvault_search",
      "msgvault_get_message",
      "msgvault_list_accounts",
      "msgvault_stats",
      "msgvault_sync_account",
    ]);
  });

  it("runs msgvault_search and applies defaultAccount", async () => {
    const { tools, api } = createApi({
      pluginConfig: { defaultAccount: "archive@example.com" },
    });
    register.register(api as never);
    const search = getTool(tools, "msgvault_search");

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ total: 1, messages: [{ id: 7 }] }), { status: 200 }),
    );

    await search.execute("id", { query: "invoice" });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining(
          "/api/v1/search?q=invoice&page=1&page_size=20&account=archive%40example.com",
        ),
      }),
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ authorization: "Bearer test-key" }),
      }),
    );
  });

  it("maps auth failures with a specific message", async () => {
    const { tools, api } = createApi();
    register.register(api as never);
    const search = getTool(tools, "msgvault_search");

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }),
    );

    await expect(search.execute("id", { query: "invoice" })).rejects.toThrow(/authentication/i);
  });

  it("retries on rate limit and succeeds", async () => {
    const { tools, api } = createApi();
    register.register(api as never);
    const search = getTool(tools, "msgvault_search");

    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "rate_limit_exceeded" }), {
          status: 429,
          headers: { "retry-after": "0" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ total: 1, messages: [{ id: 7 }] }), { status: 200 }),
      );

    await search.execute("id", { query: "invoice" });

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("blocks sync tool when allowSync is false", async () => {
    const { tools, api } = createApi({ pluginConfig: { allowSync: false } });
    register.register(api as never);
    const sync = getTool(tools, "msgvault_sync_account");

    await expect(sync.execute("id", { account: "user@example.com" })).rejects.toThrow(
      /disabled by policy/i,
    );
  });

  it("executes sync tool when allowSync is true", async () => {
    const { tools, api } = createApi({ pluginConfig: { allowSync: true } });
    register.register(api as never);
    const sync = getTool(tools, "msgvault_sync_account");

    vi.mocked(globalThis.fetch).mockResolvedValue(
      new Response(JSON.stringify({ status: "accepted" }), { status: 202 }),
    );

    await sync.execute("id", { account: "user@example.com" });

    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.objectContaining({
        href: expect.stringContaining("/api/v1/sync/user%40example.com"),
      }),
      expect.objectContaining({
        method: "POST",
      }),
    );
  });
});
