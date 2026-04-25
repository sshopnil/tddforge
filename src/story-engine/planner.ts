import { readFile } from "node:fs/promises";
import type { ResolvedConfig } from "../config/load-config.js";
import { createProvider } from "../providers/factory.js";
import type { LlmProvider } from "../providers/types.js";
import { extractJsonObject } from "../utils/json.js";
import { getWorkspaceTreeContext } from "../workspace/context.js";
import { scanWorkspace } from "../workspace/scan.js";
import type { WorkspaceScanResult } from "../workspace/types.js";
import { buildPlanningPrompt } from "./prompt.js";
import { planArtifactSchema, type PlanArtifact } from "./schema.js";

export interface PlanWorkflowResult {
  workspace: WorkspaceScanResult;
  folderTree?: string;
  plan: PlanArtifact;
}

export interface PlanBuildOptions {
  folderTreeContext?: string;
}

export async function buildPlanFromStoryFile(
  config: ResolvedConfig,
  storyPath: string,
  provider?: LlmProvider,
  options?: PlanBuildOptions,
): Promise<PlanWorkflowResult> {
  const storyText = await readFile(storyPath, "utf8");
  return buildPlanFromStoryText(config, storyText, provider, options);
}

export async function buildPlanFromStoryText(
  config: ResolvedConfig,
  storyText: string,
  provider?: LlmProvider,
  options?: PlanBuildOptions,
): Promise<PlanWorkflowResult> {
  const workspace = scanWorkspace(config.workspaceRoot);
  const selectedProvider = provider ?? createProvider(config.provider);
  const folderTree = options?.folderTreeContext ?? await getWorkspaceTreeContext(config.workspaceRoot);
  const prompt = buildPlanningPrompt(storyText, workspace, folderTree);
  const rawResponse = await selectedProvider.generateText(config.provider, prompt);
  const plan = planArtifactSchema.parse(JSON.parse(extractJsonObject(rawResponse)));

  return { workspace, folderTree, plan };
}
