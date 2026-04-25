import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PlanWorkflowResult } from "../story-engine/planner.js";
import { renderPlanMarkdown } from "./plan-markdown.js";

export interface SavedPlanFiles {
  jsonPath: string;
  markdownPath: string;
}

export async function savePlanArtifacts(
  workspaceRoot: string,
  result: PlanWorkflowResult,
  baseName = "test-plan",
): Promise<SavedPlanFiles> {
  const outputDir = path.join(workspaceRoot, ".tddforge-out");
  await mkdir(outputDir, { recursive: true });

  const safeBaseName = slugify(baseName);
  const jsonPath = path.join(outputDir, `${safeBaseName}.json`);
  const markdownPath = path.join(outputDir, `${safeBaseName}.md`);

  await writeFile(jsonPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  await writeFile(markdownPath, renderPlanMarkdown(result) + "\n", "utf8");

  return { jsonPath, markdownPath };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "test-plan";
}
