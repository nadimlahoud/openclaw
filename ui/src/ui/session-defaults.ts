import { normalizeAgentId, normalizeMainKey } from "../../../src/routing/session-key.js";

export type SessionDefaultsSnapshot = {
  defaultAgentId?: string;
  mainKey?: string;
  mainSessionKey?: string;
  scope?: string;
};

function normalizeScope(scope?: string): string {
  return (scope ?? "").trim().toLowerCase();
}

export function resolveSnapshotMainSessionKey(
  defaults?: SessionDefaultsSnapshot | null,
): string | null {
  if (!defaults) {
    return null;
  }

  const explicitMainSessionKey = defaults.mainSessionKey?.trim();
  if (explicitMainSessionKey) {
    return explicitMainSessionKey;
  }

  if (normalizeScope(defaults.scope) === "global") {
    return "global";
  }

  const agentId = normalizeAgentId(defaults.defaultAgentId);
  const mainKey = normalizeMainKey(defaults.mainKey);
  return `agent:${agentId}:${mainKey}`;
}

export function isMainSessionAlias(
  value: string | undefined,
  defaults?: SessionDefaultsSnapshot | null,
): boolean {
  const raw = (value ?? "").trim();
  if (!raw) {
    return false;
  }

  const resolvedMainSessionKey = resolveSnapshotMainSessionKey(defaults);
  if (!resolvedMainSessionKey) {
    return false;
  }

  const normalizedRaw = raw.toLowerCase();
  const normalizedResolved = resolvedMainSessionKey.toLowerCase();
  if (normalizedRaw === normalizedResolved) {
    return true;
  }

  if (normalizedResolved === "global") {
    return normalizedRaw === "global";
  }

  const agentId = normalizeAgentId(defaults?.defaultAgentId);
  const mainKey = normalizeMainKey(defaults?.mainKey);
  return (
    normalizedRaw === "main" ||
    normalizedRaw === mainKey ||
    normalizedRaw === `agent:${agentId}:main` ||
    normalizedRaw === `agent:${agentId}:${mainKey}`
  );
}
