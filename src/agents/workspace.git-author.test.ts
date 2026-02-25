import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCommandWithTimeout } from "../process/exec.js";

async function makeTempRoot(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

const TEMPLATE_FILES = [
  "AGENTS.md",
  "SOUL.md",
  "TOOLS.md",
  "IDENTITY.md",
  "USER.md",
  "HEARTBEAT.md",
  "BOOTSTRAP.md",
] as const;

async function makeTemplateDir(): Promise<string> {
  const dir = await makeTempRoot("openclaw-workspace-templates-");
  for (const name of TEMPLATE_FILES) {
    await fs.writeFile(path.join(dir, name), `# ${name}\n`, "utf-8");
  }
  return dir;
}

async function loadWorkspaceModule(templateDir: string) {
  vi.resetModules();
  vi.doMock("./workspace-templates.js", () => ({
    resolveWorkspaceTemplateDir: async () => templateDir,
  }));
  return await import("./workspace.js");
}

async function gitAvailable(): Promise<boolean> {
  try {
    const result = await runCommandWithTimeout(["git", "--version"], { timeoutMs: 2_000 });
    return result.code === 0;
  } catch {
    return false;
  }
}

async function hasGitRepo(dir: string): Promise<boolean> {
  try {
    await fs.stat(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

async function readLocalGitConfig(
  dir: string,
  key: "user.name" | "user.email",
): Promise<string | null> {
  try {
    const result = await runCommandWithTimeout(["git", "config", "--local", "--get", key], {
      cwd: dir,
      timeoutMs: 5_000,
    });
    if (result.code !== 0) {
      return null;
    }
    const value = result.stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

afterEach(() => {
  vi.doUnmock("./workspace-templates.js");
  vi.unstubAllEnvs();
});

describe("ensureAgentWorkspace git author config", () => {
  it("sets local git author identity for new bootstrap workspaces", async () => {
    const dir = await makeTempRoot("openclaw-workspace-git-author-new-");
    const templateDir = await makeTemplateDir();
    const { ensureAgentWorkspace } = await loadWorkspaceModule(templateDir);

    await ensureAgentWorkspace({ dir, ensureBootstrapFiles: true });

    const canUseGit = await gitAvailable();
    const gitRepo = await hasGitRepo(dir);
    if (!canUseGit) {
      expect(gitRepo).toBe(false);
      return;
    }

    expect(gitRepo).toBe(true);
    expect(await readLocalGitConfig(dir, "user.name")).toBe("OpenClaw Agent");
    expect(await readLocalGitConfig(dir, "user.email")).toBe("openclaw-agent@local");
  });

  it("does not overwrite an existing local git author identity", async () => {
    const dir = await makeTempRoot("openclaw-workspace-git-author-existing-");
    const templateDir = await makeTemplateDir();
    const { ensureAgentWorkspace } = await loadWorkspaceModule(templateDir);
    const canUseGit = await gitAvailable();

    await ensureAgentWorkspace({ dir, ensureBootstrapFiles: true });
    const gitRepo = await hasGitRepo(dir);
    if (!canUseGit) {
      expect(gitRepo).toBe(false);
      return;
    }

    expect(gitRepo).toBe(true);
    await runCommandWithTimeout(["git", "config", "--local", "user.name", "Custom Agent"], {
      cwd: dir,
      timeoutMs: 5_000,
    });
    await runCommandWithTimeout(["git", "config", "--local", "user.email", "custom@example.com"], {
      cwd: dir,
      timeoutMs: 5_000,
    });

    await ensureAgentWorkspace({ dir, ensureBootstrapFiles: true });

    expect(await readLocalGitConfig(dir, "user.name")).toBe("Custom Agent");
    expect(await readLocalGitConfig(dir, "user.email")).toBe("custom@example.com");
  });

  it("does not throw when git is unavailable", async () => {
    const dir = await makeTempRoot("openclaw-workspace-git-author-nogit-");
    const templateDir = await makeTemplateDir();
    vi.stubEnv("PATH", "");
    const { ensureAgentWorkspace } = await loadWorkspaceModule(templateDir);

    await expect(ensureAgentWorkspace({ dir, ensureBootstrapFiles: true })).resolves.toMatchObject({
      dir,
    });
    expect(await hasGitRepo(dir)).toBe(false);
  });
});
