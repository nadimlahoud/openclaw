import { describe, it, expect } from "vitest";
import { buildCliExtraSystemPrompt } from "./helpers.js";

describe("buildCliExtraSystemPrompt", () => {
  it("includes the tools-disabled line by default", () => {
    const prompt = buildCliExtraSystemPrompt({ extraSystemPrompt: "hello" });
    expect(prompt).toContain("hello");
    expect(prompt).toContain("Tools are disabled in this session. Do not call tools.");
  });

  it("omits the tools-disabled line when nativeTools=true", () => {
    const prompt = buildCliExtraSystemPrompt({ nativeTools: true });
    expect(prompt).not.toContain("Tools are disabled in this session. Do not call tools.");
    expect(prompt).toContain(
      "Native CLI tools (including MCP servers) are allowed in this session.",
    );
  });

  it("nativeTools=false keeps tools disabled", () => {
    const prompt = buildCliExtraSystemPrompt({ nativeTools: false });
    expect(prompt).toContain("Tools are disabled in this session. Do not call tools.");
  });
});
