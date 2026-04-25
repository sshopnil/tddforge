import type { Command } from "commander";
import pc from "picocolors";
import { loadResolvedConfig } from "../config/load-config.js";
import { createProvider } from "../providers/factory.js";

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description("Validate configuration and provider connectivity")
    .action(async () => {
      const config = loadResolvedConfig(process.cwd());
      const provider = createProvider(config.provider);
      const health = await provider.healthCheck(config.provider);

      console.log(pc.bold("TDDForge doctor"));
      console.log(`Workspace: ${config.workspaceRoot}`);
      console.log(`Provider: ${config.provider.type}`);
      console.log(`Model: ${config.provider.model}`);

      if (health.ok) {
        console.log(pc.green(`Provider health: ok${health.message ? ` (${health.message})` : ""}`));
        return;
      }

      console.log(pc.red(`Provider health: failed${health.message ? ` (${health.message})` : ""}`));
      process.exitCode = 1;
    });
}
