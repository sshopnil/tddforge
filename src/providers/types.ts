import type { ProviderConfig } from "../config/schema.js";

export interface ProviderHealth {
  ok: boolean;
  message?: string;
}

export interface GenerateTextInput {
  system: string;
  prompt: string;
}

export interface LlmProvider {
  readonly type: ProviderConfig["type"];
  healthCheck(config: ProviderConfig): Promise<ProviderHealth>;
  generateText(config: ProviderConfig, input: GenerateTextInput): Promise<string>;
}
