import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProjectTool } from "./tools/project.js";
import { registerListTool } from "./tools/list.js";
import { registerInfoTool } from "./tools/info.js";
import { registerAddTool } from "./tools/add.js";
import { registerRemoveTool } from "./tools/remove.js";
import { registerCreateTool } from "./tools/create.js";
import { registerLinkTool } from "./tools/link.js";
import { registerUnlinkTool } from "./tools/unlink.js";

export function createServer() {
  const server = new McpServer({
    name: "kitn",
    version: "0.1.0",
  });

  registerProjectTool(server);
  registerListTool(server);
  registerInfoTool(server);
  registerAddTool(server);
  registerRemoveTool(server);
  registerCreateTool(server);
  registerLinkTool(server);
  registerUnlinkTool(server);

  return server;
}
