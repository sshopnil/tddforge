import { readFile } from "node:fs/promises";
import type { ResolvedConfig } from "../config/load-config.js";
import { createProvider } from "../providers/factory.js";
import type { LlmProvider, TokenUsage } from "../providers/types.js";
import { parseModelJsonObject } from "../utils/json.js";
import { getWorkspaceTreeContext } from "../workspace/context.js";
import { scanWorkspace } from "../workspace/scan.js";
import type { WorkspaceScanResult } from "../workspace/types.js";
import { buildPlanningPrompt } from "./prompt.js";
import { planArtifactSchema, type PlanArtifact } from "./schema.js";

export interface PlanWorkflowResult {
  workspace: WorkspaceScanResult;
  folderTree?: string;
  plan: PlanArtifact;
  tokenUsage?: TokenUsage;
}

export interface PlanBuildOptions {
  folderTreeContext?: string;
  signal?: globalThis.AbortSignal;
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
  const response = await selectedProvider.generateText(config.provider, {
    ...prompt,
    signal: options?.signal
  });
  const plan = planArtifactSchema.parse(parseModelJsonObject(response.text));

  return { workspace, folderTree, plan, tokenUsage: response.tokenUsage };
}
