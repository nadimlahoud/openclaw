#!/usr/bin/env node

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const BIND_HOST = process.env.MSGVAULT_COMPAT_BIND || "127.0.0.1";
const PORT = Number(process.env.MSGVAULT_COMPAT_PORT || 18080);
const TIMEOUT_MS = Number(process.env.MSGVAULT_COMPAT_TIMEOUT_MS || 30_000);
const MAX_BUFFER = 16 * 1024 * 1024;
const MSGVAULT_API_BASE = process.env.MSGVAULT_API_BASE || "http://127.0.0.1:8080";
const MSGVAULT_HOME = process.env.MSGVAULT_HOME || path.join(os.homedir(), ".msgvault");
const MSGVAULT_BIN =
  process.env.MSGVAULT_BIN || path.join(os.homedir(), ".local", "bin", "msgvault");

function parseAuthKeys() {
  const raw = process.env.MSGVAULT_COMPAT_API_KEYS || process.env.MSGVAULT_COMPAT_API_KEY || "";
  const keys = raw
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  return new Set(keys);
}

const AUTH_KEYS = parseAuthKeys();
const ALLOW_INSECURE = process.env.MSGVAULT_COMPAT_ALLOW_INSECURE === "1";

function isLoopbackHost(host) {
  const value = String(host || "")
    .trim()
    .toLowerCase();
  if (!value) {
    return false;
  }
  if (value === "localhost" || value === "::1" || value === "0:0:0:0:0:0:0:1") {
    return true;
  }
  if (value.startsWith("127.")) {
    return true;
  }
  return false;
}

if (!isLoopbackHost(BIND_HOST) && AUTH_KEYS.size === 0 && !ALLOW_INSECURE) {
  console.error(
    JSON.stringify({
      error: "insecure_bind_blocked",
      message:
        "Refusing to bind msgvault compat server on a non-loopback address without auth. Set MSGVAULT_COMPAT_API_KEYS (or MSGVAULT_COMPAT_API_KEY), or set MSGVAULT_COMPAT_ALLOW_INSECURE=1 to override.",
      bind: BIND_HOST,
    }),
  );
  process.exit(1);
}

function readAuthToken(req) {
  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }
  const xKey = req.headers["x-api-key"];
  if (typeof xKey === "string") {
    return xKey.trim();
  }
  return "";
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

function parseJsonFromMixedOutput(stdout, stderr) {
  const merged = `${stdout || ""}\n${stderr || ""}`.trim();
  if (!merged) {
    return null;
  }
  const firstObject = merged.indexOf("{");
  const firstArray = merged.indexOf("[");
  const start =
    firstObject < 0 ? firstArray : firstArray < 0 ? firstObject : Math.min(firstObject, firstArray);
  if (start < 0) {
    return null;
  }
  const lastObject = merged.lastIndexOf("}");
  const lastArray = merged.lastIndexOf("]");
  const end = Math.max(lastObject, lastArray);
  if (end < start) {
    return null;
  }
  const candidate = merged.slice(start, end + 1);
  return JSON.parse(candidate);
}

async function runMsgvaultJson(args) {
  const commandArgs = ["--home", MSGVAULT_HOME, ...args];
  const { stdout = "", stderr = "" } = await execFileAsync(MSGVAULT_BIN, commandArgs, {
    timeout: TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });
  const parsed = parseJsonFromMixedOutput(stdout, stderr);
  if (parsed === null) {
    throw new Error(`No JSON output from msgvault for args: ${commandArgs.join(" ")}`);
  }
  return parsed;
}

async function readMsgvaultApiKey() {
  const fromEnv = process.env.MSGVAULT_API_KEY?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const keyPath = process.env.MSGVAULT_API_KEY_FILE || path.join(MSGVAULT_HOME, "api_key");
  const raw = await fs.readFile(keyPath, "utf8");
  return raw.trim();
}

async function proxyMsgvaultApi(pathnameAndQuery) {
  const apiKey = await readMsgvaultApiKey();
  const response = await fetch(`${MSGVAULT_API_BASE}${pathnameAndQuery}`, {
    headers: { authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { message: text };
  }
  return { status: response.status, payload };
}

async function handleRequest(req, res) {
  if (!req.url) {
    writeJson(res, 400, { error: "bad_request", message: "Missing URL" });
    return;
  }
  const url = new URL(req.url, "http://localhost");
  const method = req.method || "GET";

  if (AUTH_KEYS.size > 0) {
    const token = readAuthToken(req);
    if (!AUTH_KEYS.has(token)) {
      writeJson(res, 401, { error: "unauthorized", message: "Invalid API key" });
      return;
    }
  }

  try {
    if (method === "GET" && url.pathname === "/health") {
      writeJson(res, 200, { status: "ok" });
      return;
    }

    if (method === "GET" && url.pathname === "/api/v1/stats") {
      const proxied = await proxyMsgvaultApi("/api/v1/stats");
      writeJson(res, proxied.status, proxied.payload);
      return;
    }

    if (method === "GET" && url.pathname === "/api/v1/accounts") {
      const proxied = await proxyMsgvaultApi("/api/v1/accounts");
      writeJson(res, proxied.status, proxied.payload);
      return;
    }

    if (method === "GET" && url.pathname === "/api/v1/search") {
      const query = (url.searchParams.get("q") || "").trim();
      if (!query) {
        writeJson(res, 400, { error: "bad_request", message: "Missing q parameter" });
        return;
      }
      const page = Math.max(1, Number(url.searchParams.get("page") || 1));
      const pageSize = Math.max(1, Math.min(100, Number(url.searchParams.get("page_size") || 20)));
      const offset = (page - 1) * pageSize;
      const account = (url.searchParams.get("account") || "").trim();

      const rows = await runMsgvaultJson([
        "search",
        query,
        "--json",
        "--limit",
        String(pageSize),
        "--offset",
        String(offset),
      ]);
      if (!Array.isArray(rows)) {
        throw new Error("Unexpected msgvault search output");
      }
      writeJson(res, 200, {
        query,
        page,
        page_size: pageSize,
        total: rows.length,
        messages: rows,
        _meta: {
          transport: "cli",
          ...(account
            ? { account, account_filter_note: "Compatibility mode cannot enforce account filter." }
            : {}),
        },
      });
      return;
    }

    if (method === "GET" && url.pathname.startsWith("/api/v1/messages/")) {
      const id = url.pathname.split("/").pop() || "";
      if (!/^\d+$/.test(id)) {
        writeJson(res, 400, { error: "bad_request", message: "Message id must be numeric" });
        return;
      }
      const message = await runMsgvaultJson(["show-message", id, "--json"]);
      writeJson(res, 200, {
        ...message,
        _meta: { transport: "cli" },
      });
      return;
    }

    if (method === "POST" && url.pathname.startsWith("/api/v1/sync/")) {
      const account = url.pathname.split("/").pop() || "";
      const proxied = await proxyMsgvaultApi(`/api/v1/sync/${encodeURIComponent(account)}`);
      writeJson(res, proxied.status, proxied.payload);
      return;
    }

    writeJson(res, 404, { error: "not_found", message: "Endpoint not found" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeJson(res, 500, { error: "internal_error", message });
  }
}

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    writeJson(res, 500, { error: "internal_error", message });
  });
});

server.listen(PORT, BIND_HOST, () => {
  console.log(
    JSON.stringify({
      status: "started",
      bind: BIND_HOST,
      port: PORT,
      msgvault_api_base: MSGVAULT_API_BASE,
      msgvault_bin: MSGVAULT_BIN,
      msgvault_home: MSGVAULT_HOME,
      auth_keys: AUTH_KEYS.size,
    }),
  );
});
