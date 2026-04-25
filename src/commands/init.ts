import type { Command } from "commander";
import pc from "picocolors";
import { ensureLocalConfig } from "../config/local-config.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize local TDDForge configuration in this workspace")
    .action(async () => {
      const configPath = await ensureLocalConfig(process.cwd());
      console.log(pc.green(`Created ${configPath}`));
      console.log(pc.cyan("Next step: configure your provider and model in .tddforge/config.json"));
    });
}
