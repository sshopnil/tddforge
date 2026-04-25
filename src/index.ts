#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerInitCommand } from "./commands/init.js";
import { registerPlanCommand } from "./commands/plan.js";
import { runTui } from "./tui/run.js";

const program = new Command();

program
  .name("tddforge")
  .description("Repo-native AI testing CLI for story-to-test workflows")
  .version("0.1.0");

registerInitCommand(program);
registerDoctorCommand(program);
registerPlanCommand(program);

if (process.argv.length <= 2) {
  runTui(process.cwd());
} else {
  program.parseAsync(process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`tddforge failed: ${message}`);
    process.exitCode = 1;
  });
}
