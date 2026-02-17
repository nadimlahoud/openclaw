import type { AnyAgentTool, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createDomainSearchTool } from "./src/domain-search-tool.js";

export default function register(api: OpenClawPluginApi) {
  api.registerTool(createDomainSearchTool(api) as unknown as AnyAgentTool);
}
