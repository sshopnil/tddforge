import path from "node:path";
import type { Command } from "commander";
import pc from "picocolors";
import { loadResolvedConfig } from "../config/load-config.js";
import { buildPlanFromStoryFile } from "../story-engine/planner.js";

interface PlanCommandOptions {
  story: string;
  json?: boolean;
}

export function registerPlanCommand(program: Command): void {
  program
    .command("plan")
    .description("Analyze a user story and produce the first TDD plan")
    .requiredOption("-s, --story <path>", "Path to a story markdown or text file")
    .option("--json", "Print raw JSON output")
    .action(async (options: PlanCommandOptions) => {
      const config = loadResolvedConfig(process.cwd());
      const storyPath = path.resolve(process.cwd(), options.story);
      const result = await buildPlanFromStoryFile(config, storyPath);

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      printHumanPlan(result);
    });
}

function printHumanPlan(result: Awaited<ReturnType<typeof buildPlanFromStoryFile>>): void {
  console.log(pc.bold(pc.cyan("TDD Plan")));
  console.log(`Workspace: ${result.workspace.workspaceRoot}`);
  console.log(`Detected package manager: ${result.workspace.packageManager}`);
  console.log(`Detected test framework: ${result.workspace.testFramework}`);
  console.log(`Language: ${result.workspace.language}`);
  console.log("");

  console.log(pc.bold("Summary"));
  console.log(result.plan.summary);
  console.log("");

  console.log(pc.bold("Requirements"));
  for (const requirement of result.plan.requirements) {
    console.log(`- ${requirement.id} [${requirement.source}]: ${requirement.text}`);
  }
  console.log("");

  console.log(pc.bold("Ambiguities"));
  if (result.plan.ambiguities.length === 0) {
    console.log("- None identified");
  } else {
    for (const ambiguity of result.plan.ambiguities) {
      console.log(`- ${ambiguity}`);
    }
  }
  console.log("");

  console.log(pc.bold("Edge Cases"));
  for (const edgeCase of result.plan.edgeCases) {
    console.log(`- ${edgeCase}`);
  }
  console.log("");

  console.log(pc.bold("Suggested Test Scenarios"));
  for (const scenario of result.plan.suggestedTestScenarios) {
    console.log(`- ${scenario.id} [${scenario.level}] ${scenario.title}`);
    console.log(`  Given: ${scenario.given}`);
    console.log(`  When: ${scenario.when}`);
    console.log(`  Then: ${scenario.then}`);
  }
}
