import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectGateway } from "./app-gateway.ts";

type GatewayClientMock = {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  emitHello: (hello: { snapshot?: unknown }) => void;
  emitClose: (code: number, reason?: string) => void;
  emitGap: (expected: number, received: number) => void;
  emitEvent: (evt: { event: string; payload?: unknown; seq?: number }) => void;
};

const gatewayClientInstances: GatewayClientMock[] = [];

vi.mock("./app-settings.ts", () => ({
  applySettings: vi.fn((host: { settings: unknown }, next: unknown) => {
    host.settings = next;
  }),
  loadCron: vi.fn(),
  refreshActiveTab: vi.fn().mockResolvedValue(undefined),
  setLastActiveSessionKey: vi.fn(
    (host: { settings: { lastActiveSessionKey: string } }, key: string) => {
      host.settings.lastActiveSessionKey = key;
    },
  ),
}));

vi.mock("./controllers/assistant-identity.ts", () => ({
  loadAssistantIdentity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./controllers/agents.ts", () => ({
  loadAgents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./controllers/nodes.ts", () => ({
  loadNodes: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./controllers/devices.ts", () => ({
  loadDevices: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./gateway.ts", () => {
  class GatewayBrowserClient {
    readonly start = vi.fn();
    readonly stop = vi.fn();

    constructor(
      private opts: {
        onHello?: (hello: { snapshot?: unknown }) => void;
        onClose?: (info: { code: number; reason: string }) => void;
        onGap?: (info: { expected: number; received: number }) => void;
        onEvent?: (evt: { event: string; payload?: unknown; seq?: number }) => void;
      },
    ) {
      gatewayClientInstances.push({
        start: this.start,
        stop: this.stop,
        emitHello: (hello) => {
          this.opts.onHello?.(hello);
        },
        emitClose: (code, reason) => {
          this.opts.onClose?.({ code, reason: reason ?? "" });
        },
        emitGap: (expected, received) => {
          this.opts.onGap?.({ expected, received });
        },
        emitEvent: (evt) => {
          this.opts.onEvent?.(evt);
        },
      });
    }
  }

  return { GatewayBrowserClient };
});

function createHost() {
  return {
    settings: {
      gatewayUrl: "ws://127.0.0.1:18789",
      token: "",
      sessionKey: "main",
      lastActiveSessionKey: "main",
      theme: "system",
      chatFocusMode: false,
      chatShowThinking: true,
      splitRatio: 0.6,
      navCollapsed: false,
      navGroupsCollapsed: {},
    },
    password: "",
    client: null,
    connected: false,
    hello: null,
    lastError: null,
    eventLogBuffer: [],
    eventLog: [],
    tab: "overview",
    presenceEntries: [],
    presenceError: null,
    presenceStatus: null,
    agentsLoading: false,
    agentsList: null,
    agentsError: null,
    debugHealth: null,
    assistantName: "OpenClaw",
    assistantAvatar: null,
    assistantAgentId: null,
    sessionKey: "main",
    chatRunId: null,
    toolStreamById: new Map(),
    toolStreamOrder: [],
    chatToolMessages: [],
    toolStreamSyncTimer: null,
    refreshSessionsAfterChat: new Set<string>(),
    execApprovalQueue: [],
    execApprovalError: null,
  } as unknown as Parameters<typeof connectGateway>[0];
}

describe("connectGateway", () => {
  beforeEach(() => {
    gatewayClientInstances.length = 0;
    vi.clearAllMocks();
  });

  it("ignores stale client onGap callbacks after reconnect", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();

    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();

    firstClient.emitGap(10, 13);
    expect(host.lastError).toBeNull();

    secondClient.emitGap(20, 24);
    expect(host.lastError).toBe(
      "event gap detected (expected seq 20, got 24); refresh recommended",
    );
  });

  it("ignores stale client onEvent callbacks after reconnect", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();

    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();

    firstClient.emitEvent({ event: "presence", payload: { presence: [{ host: "stale" }] } });
    expect(host.eventLogBuffer).toHaveLength(0);

    secondClient.emitEvent({ event: "presence", payload: { presence: [{ host: "active" }] } });
    expect(host.eventLogBuffer).toHaveLength(1);
    expect(host.eventLogBuffer[0]?.event).toBe("presence");
  });

  it("ignores stale client onClose callbacks after reconnect", () => {
    const host = createHost();

    connectGateway(host);
    const firstClient = gatewayClientInstances[0];
    expect(firstClient).toBeDefined();

    connectGateway(host);
    const secondClient = gatewayClientInstances[1];
    expect(secondClient).toBeDefined();

    firstClient.emitClose(1005);
    expect(host.lastError).toBeNull();

    secondClient.emitClose(1005);
    expect(host.lastError).toBe("disconnected (1005): no reason");
  });

  it("normalizes main aliases from snapshot defaults when mainSessionKey is absent", () => {
    const host = createHost();
    host.sessionKey = "agent:denver-move:main";
    host.settings.sessionKey = "agent:denver-move:main";
    host.settings.lastActiveSessionKey = "agent:denver-move:main";

    connectGateway(host);
    const client = gatewayClientInstances[0];
    expect(client).toBeDefined();

    client.emitHello({
      snapshot: {
        sessionDefaults: {
          defaultAgentId: "denver-move",
          mainKey: "heartbeat",
        },
      },
    });

    expect(host.connected).toBe(true);
    expect(host.sessionKey).toBe("agent:denver-move:heartbeat");
    expect(host.settings.sessionKey).toBe("agent:denver-move:heartbeat");
    expect(host.settings.lastActiveSessionKey).toBe("agent:denver-move:heartbeat");
  });
});
