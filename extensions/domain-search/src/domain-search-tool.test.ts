import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { __testing, createDomainSearchTool } from "./domain-search-tool.js";

// oxlint-disable-next-line typescript/no-explicit-any
function fakeApi(overrides: any = {}) {
  return {
    id: "domain-search",
    name: "domain-search",
    source: "test",
    config: {},
    pluginConfig: {},
    runtime: { version: "test" },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    registerTool() {},
    ...overrides,
  };
}

describe("domain_search tool", () => {
  const envSnapshot = { ...process.env };
  const restoreEnv = () => {
    for (const key of Object.keys(process.env)) {
      if (!(key in envSnapshot)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(envSnapshot)) {
      if (value === undefined) {
        delete process.env[key];
        continue;
      }
      process.env[key] = value;
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    restoreEnv();
  });

  it("search_domain calls executeSearchDomain", async () => {
    const executeSearchDomain = vi.fn(async () => ({ ok: true }));
    const tool = createDomainSearchTool(fakeApi(), {
      loadImpl: async () => ({
        executeSearchDomain,
        executeBulkSearch: vi.fn(),
        executeSuggestDomainsSmart: vi.fn(),
        executeTldInfo: vi.fn(),
        executeCheckSocials: vi.fn(),
      }),
    });

    const res = await tool.execute("id", {
      action: "search_domain",
      domain_name: "vibecoding",
      tlds: [".COM", "IO"],
      registrars: ["porkbun"],
    });

    expect(executeSearchDomain).toHaveBeenCalledWith({
      domain_name: "vibecoding",
      tlds: ["com", "io"],
      registrars: ["porkbun"],
    });

    // oxlint-disable-next-line typescript/no-explicit-any
    expect((res as any).details.action).toBe("search_domain");
  });

  it("search_domain accepts full domains and infers tld", async () => {
    const executeSearchDomain = vi.fn(async () => ({ ok: true }));
    const tool = createDomainSearchTool(fakeApi(), {
      loadImpl: async () => ({
        executeSearchDomain,
        executeBulkSearch: vi.fn(),
        executeSuggestDomainsSmart: vi.fn(),
        executeTldInfo: vi.fn(),
        executeCheckSocials: vi.fn(),
      }),
    });

    await tool.execute("id", {
      action: "search_domain",
      domain_name: "bpcefinance.com",
    });

    expect(executeSearchDomain).toHaveBeenCalledWith({
      domain_name: "bpcefinance",
      tlds: ["com"],
      registrars: undefined,
    });
  });

  it("bulk_search calls executeBulkSearch", async () => {
    const executeBulkSearch = vi.fn(async () => ({ ok: true }));
    const tool = createDomainSearchTool(fakeApi(), {
      loadImpl: async () => ({
        executeSearchDomain: vi.fn(),
        executeBulkSearch,
        executeSuggestDomainsSmart: vi.fn(),
        executeTldInfo: vi.fn(),
        executeCheckSocials: vi.fn(),
      }),
    });

    await tool.execute("id", {
      action: "bulk_search",
      domains: ["a", "b"],
      tld: "io",
      registrar: "porkbun",
    });

    expect(executeBulkSearch).toHaveBeenCalledWith({
      domains: ["a", "b"],
      tld: "io",
      registrar: "porkbun",
    });
  });

  it("bulk_search normalizes tld parameter", async () => {
    const executeBulkSearch = vi.fn(async () => ({ ok: true }));
    const tool = createDomainSearchTool(fakeApi(), {
      loadImpl: async () => ({
        executeSearchDomain: vi.fn(),
        executeBulkSearch,
        executeSuggestDomainsSmart: vi.fn(),
        executeTldInfo: vi.fn(),
        executeCheckSocials: vi.fn(),
      }),
    });

    await tool.execute("id", {
      action: "bulk_search",
      domains: ["a", "b"],
      tld: ".IO",
    });

    expect(executeBulkSearch).toHaveBeenCalledWith({
      domains: ["a", "b"],
      tld: "io",
      registrar: undefined,
    });
  });

  it("bulk_search accepts full domains and infers tld", async () => {
    const executeBulkSearch = vi.fn(async () => ({ ok: true }));
    const tool = createDomainSearchTool(fakeApi(), {
      loadImpl: async () => ({
        executeSearchDomain: vi.fn(),
        executeBulkSearch,
        executeSuggestDomainsSmart: vi.fn(),
        executeTldInfo: vi.fn(),
        executeCheckSocials: vi.fn(),
      }),
    });

    await tool.execute("id", {
      action: "bulk_search",
      domains: ["a.com", "b.com"],
      registrar: "porkbun",
    });

    expect(executeBulkSearch).toHaveBeenCalledWith({
      domains: ["a", "b"],
      tld: "com",
      registrar: "porkbun",
    });
  });

  it("suggest_domains_smart calls executeSuggestDomainsSmart", async () => {
    const executeSuggestDomainsSmart = vi.fn(async () => ({ ok: true }));
    const tool = createDomainSearchTool(fakeApi(), {
      loadImpl: async () => ({
        executeSearchDomain: vi.fn(),
        executeBulkSearch: vi.fn(),
        executeSuggestDomainsSmart,
        executeTldInfo: vi.fn(),
        executeCheckSocials: vi.fn(),
      }),
    });

    await tool.execute("id", {
      action: "suggest_domains_smart",
      query: "coffee shop in seattle",
      tld: "com",
      industry: "food",
      style: "brandable",
      max_suggestions: 12,
      include_premium: true,
      project_context: { name: "MyApp", keywords: ["coffee", "seattle"] },
    });

    expect(executeSuggestDomainsSmart).toHaveBeenCalledWith({
      query: "coffee shop in seattle",
      tld: "com",
      industry: "food",
      style: "brandable",
      max_suggestions: 12,
      include_premium: true,
      project_context: {
        name: "MyApp",
        description: undefined,
        keywords: ["coffee", "seattle"],
        industry: undefined,
        repository_url: undefined,
      },
    });
  });

  it("tld_info calls executeTldInfo", async () => {
    const executeTldInfo = vi.fn(async () => ({ ok: true }));
    const tool = createDomainSearchTool(fakeApi(), {
      loadImpl: async () => ({
        executeSearchDomain: vi.fn(),
        executeBulkSearch: vi.fn(),
        executeSuggestDomainsSmart: vi.fn(),
        executeTldInfo,
        executeCheckSocials: vi.fn(),
      }),
    });

    await tool.execute("id", { action: "tld_info", tld: ".IO", detailed: true });
    expect(executeTldInfo).toHaveBeenCalledWith({ tld: "io", detailed: true });
  });

  it("check_socials calls executeCheckSocials", async () => {
    const executeCheckSocials = vi.fn(async () => ({ ok: true }));
    const tool = createDomainSearchTool(fakeApi(), {
      loadImpl: async () => ({
        executeSearchDomain: vi.fn(),
        executeBulkSearch: vi.fn(),
        executeSuggestDomainsSmart: vi.fn(),
        executeTldInfo: vi.fn(),
        executeCheckSocials,
      }),
    });

    await tool.execute("id", {
      action: "check_socials",
      name: "vibecoding",
      platforms: ["github", "npm"],
    });

    expect(executeCheckSocials).toHaveBeenCalledWith({
      name: "vibecoding",
      platforms: ["github", "npm"],
    });
  });

  it("throws ToolInputError on missing required params", async () => {
    const tool = createDomainSearchTool(fakeApi(), {
      loadImpl: async () => ({
        executeSearchDomain: vi.fn(),
        executeBulkSearch: vi.fn(),
        executeSuggestDomainsSmart: vi.fn(),
        executeTldInfo: vi.fn(),
        executeCheckSocials: vi.fn(),
      }),
    });

    await expect(tool.execute("id", { action: "search_domain" })).rejects.toMatchObject({
      name: "ToolInputError",
      status: 400,
    });
  });

  it("qwenMode=disabled disables Qwen inference by default", () => {
    delete process.env.QWEN_INFERENCE_ENDPOINT;
    __testing.applyDomainSearchEnv({ qwenMode: "disabled" });
    expect(process.env.QWEN_INFERENCE_ENDPOINT).toBe("disabled");
  });
});
