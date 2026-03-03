import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Tools
import { registerProjectTool } from "./tools/project.js";
import { registerListTool, registerListTypesTool } from "./tools/list.js";
import { registerInfoTool } from "./tools/info.js";
import { registerAddTool } from "./tools/add.js";
import { registerRemoveTool } from "./tools/remove.js";
import { registerCreateTool } from "./tools/create.js";
import { registerLinkTool } from "./tools/link.js";
import { registerUnlinkTool } from "./tools/unlink.js";
import { registerInitTool } from "./tools/init.js";
import { registerNewTool } from "./tools/new.js";
import { registerUpdateTool } from "./tools/update.js";
import { registerDiffTool } from "./tools/diff.js";
import { registerRulesTool } from "./tools/rules.js";
import {
  registerRegistrySearchTool,
  registerRegistryListTool,
  registerRegistryAddTool,
} from "./tools/registry.js";
import { registerHelpTool } from "./tools/help.js";
import { registerTryTools } from "./tools/try.js";

// Package manager tools
import { registerInstallTool } from "./tools/install.js";
import { registerOutdatedTool } from "./tools/outdated.js";
import { registerWhyTool } from "./tools/why.js";
import { registerTreeTool } from "./tools/tree.js";
import { registerDoctorTool } from "./tools/doctor.js";

// Resources
import { registerRulesResource } from "./resources/rules.js";
import { registerProjectResource } from "./resources/project.js";

export function createServer() {
  const server = new McpServer({
    name: "kitn",
    version: "0.1.0",
  });

  // Core project tools
  registerProjectTool(server);
  registerListTypesTool(server);
  registerListTool(server);
  registerInfoTool(server);
  registerAddTool(server);
  registerRemoveTool(server);
  registerCreateTool(server);
  registerLinkTool(server);
  registerUnlinkTool(server);

  // Init, new, update, diff, rules
  registerInitTool(server);
  registerNewTool(server);
  registerUpdateTool(server);
  registerDiffTool(server);
  registerRulesTool(server);

  // Registry management
  registerRegistrySearchTool(server);
  registerRegistryListTool(server);
  registerRegistryAddTool(server);

  // Help
  registerHelpTool(server);

  // Try (interactive testing)
  registerTryTools(server);

  // Package manager tools
  registerInstallTool(server);
  registerOutdatedTool(server);
  registerWhyTool(server);
  registerTreeTool(server);
  registerDoctorTool(server);

  // Resources
  registerRulesResource(server);
  registerProjectResource(server);

  return server;
}
