import { render } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { MessageGroup } from "../types/chat-types.ts";
import { renderMessageGroup } from "./grouped-render.ts";

function makeToolGroup(
  message: Record<string, unknown>,
  onOpenSidebar?: (content: string) => void,
) {
  const group: MessageGroup = {
    kind: "group",
    key: "g1",
    role: "toolResult",
    messages: [{ message, key: "m1" }],
    timestamp: Date.now(),
    isStreaming: false,
  };
  return renderMessageGroup(group, {
    onOpenSidebar,
    showReasoning: false,
    assistantName: "OpenClaw",
    assistantAvatar: null,
  });
}

describe("grouped-render", () => {
  it("renders tool results as tool cards without duplicating raw output as chat text", () => {
    const container = document.createElement("div");
    const onOpenSidebar = vi.fn();

    const output = JSON.stringify(
      {
        a: "line 1",
        b: "line 2",
        c: "line 3",
        duration_ms: 4117,
      },
      null,
      2,
    );

    render(
      makeToolGroup(
        {
          role: "toolResult",
          toolName: "domain_search",
          content: [{ type: "text", text: output }],
          timestamp: Date.now(),
        },
        onOpenSidebar,
      ),
      container,
    );

    expect(container.querySelector(".chat-text")).toBeNull();
    expect(container.querySelectorAll(".chat-tool-card").length).toBeGreaterThan(0);
    // The full output should not be dumped into the main chat thread.
    expect(container.textContent).not.toContain('"duration_ms": 4117');

    const card = container.querySelector(".chat-tool-card");
    expect(card).not.toBeNull();
    card!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onOpenSidebar).toHaveBeenCalledTimes(1);
    expect(String(onOpenSidebar.mock.calls[0]?.[0] ?? "")).toContain("```json");
    expect(String(onOpenSidebar.mock.calls[0]?.[0] ?? "")).toContain('"duration_ms": 4117');
  });

  it("treats assistant-shaped tool outputs (toolCallId + string content) as tool cards", () => {
    const container = document.createElement("div");
    const onOpenSidebar = vi.fn();

    const output = JSON.stringify(
      {
        x: "value",
        y: "more",
        z: "even more",
        duration_ms: 42,
      },
      null,
      2,
    );

    render(
      makeToolGroup(
        {
          role: "assistant",
          toolCallId: "call-123",
          toolName: "domain_search",
          content: output,
          timestamp: Date.now(),
        },
        onOpenSidebar,
      ),
      container,
    );

    expect(container.querySelector(".chat-text")).toBeNull();
    expect(container.querySelectorAll(".chat-tool-card").length).toBeGreaterThan(0);
  });
});
