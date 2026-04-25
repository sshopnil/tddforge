import type { PlanWorkflowResult } from "../story-engine/planner.js";

export function renderPlanMarkdown(result: PlanWorkflowResult): string {
  const lines: string[] = [];

  lines.push("# TDDForge Test Plan");
  lines.push("");
  lines.push(`Workspace: ${result.workspace.workspaceRoot}`);
  lines.push(`Package manager: ${result.workspace.packageManager}`);
  lines.push(`Test framework: ${result.workspace.testFramework}`);
  lines.push(`Language: ${result.workspace.language}`);
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push(result.plan.summary);
  lines.push("");
  lines.push("## Requirements");
  lines.push("");
  for (const requirement of result.plan.requirements) {
    lines.push(`- ${requirement.id} [${requirement.source}]: ${requirement.text}`);
  }
  lines.push("");
  lines.push("## Ambiguities");
  lines.push("");
  if (result.plan.ambiguities.length === 0) {
    lines.push("- None identified");
  } else {
    for (const ambiguity of result.plan.ambiguities) {
      lines.push(`- ${ambiguity}`);
    }
  }
  lines.push("");
  lines.push("## Edge Cases");
  lines.push("");
  for (const edgeCase of result.plan.edgeCases) {
    lines.push(`- ${edgeCase}`);
  }
  lines.push("");
  lines.push("## Suggested Test Scenarios");
  lines.push("");
  for (const scenario of result.plan.suggestedTestScenarios) {
    lines.push(`### ${scenario.id}: ${scenario.title}`);
    lines.push("");
    lines.push(`- Level: ${scenario.level}`);
    lines.push(`- Requirement IDs: ${scenario.requirementIds.join(", ")}`);
    lines.push(`- Given: ${scenario.given}`);
    lines.push(`- When: ${scenario.when}`);
    lines.push(`- Then: ${scenario.then}`);
    lines.push("");
  }

  return lines.join("\n");
}
