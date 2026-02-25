import { describe, expect, it } from "vitest";
import {
  isMainSessionAlias,
  resolveSnapshotMainSessionKey,
  type SessionDefaultsSnapshot,
} from "./session-defaults.ts";

describe("resolveSnapshotMainSessionKey", () => {
  it("returns explicit mainSessionKey when present", () => {
    const defaults: SessionDefaultsSnapshot = {
      defaultAgentId: "denver-move",
      mainKey: "heartbeat",
      mainSessionKey: "agent:denver-move:main-chat",
    };
    expect(resolveSnapshotMainSessionKey(defaults)).toBe("agent:denver-move:main-chat");
  });

  it("derives canonical key from defaultAgentId and mainKey", () => {
    const defaults: SessionDefaultsSnapshot = {
      defaultAgentId: "denver-move",
      mainKey: "heartbeat",
    };
    expect(resolveSnapshotMainSessionKey(defaults)).toBe("agent:denver-move:heartbeat");
  });

  it("returns global when scope is global and explicit key is missing", () => {
    const defaults: SessionDefaultsSnapshot = {
      defaultAgentId: "denver-move",
      mainKey: "heartbeat",
      scope: "global",
    };
    expect(resolveSnapshotMainSessionKey(defaults)).toBe("global");
  });

  it("returns null when defaults are absent", () => {
    expect(resolveSnapshotMainSessionKey(undefined)).toBeNull();
    expect(resolveSnapshotMainSessionKey(null)).toBeNull();
  });
});

describe("isMainSessionAlias", () => {
  const defaults: SessionDefaultsSnapshot = {
    defaultAgentId: "denver-move",
    mainKey: "heartbeat",
  };

  it("matches bare main alias", () => {
    expect(isMainSessionAlias("main", defaults)).toBe(true);
  });

  it("matches configured main key alias", () => {
    expect(isMainSessionAlias("heartbeat", defaults)).toBe(true);
  });

  it("matches agent-qualified default main alias", () => {
    expect(isMainSessionAlias("agent:denver-move:main", defaults)).toBe(true);
  });

  it("matches agent-qualified configured main alias", () => {
    expect(isMainSessionAlias("agent:denver-move:heartbeat", defaults)).toBe(true);
  });

  it("does not match non-main session", () => {
    expect(isMainSessionAlias("agent:denver-move:discord:group:dev", defaults)).toBe(false);
  });
});
