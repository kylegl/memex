import * as vscode from "vscode";
import { join } from "path";

export function activate(context: vscode.ExtensionContext) {
  // Use the bundled CLI instead of npx — no network dependency, no cache issues
  const cliPath = join(context.extensionPath, "node_modules", "@touchskyer", "memex", "dist", "cli.js");

  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider("memex.mcpServer", {
      provideMcpServerDefinitions: async () => [
        new vscode.McpStdioServerDefinition(
          "Memex",
          "node",
          [cliPath, "mcp"],
          {},
          "0.1.10"
        ),
      ],
      resolveMcpServerDefinition: async (server) => server,
    })
  );
}
