import type { ProviderConfig } from "../config/schema.js";
import { OllamaProvider } from "./ollama.js";
import { OpenAiProvider } from "./openai.js";
import type { LlmProvider } from "./types.js";

export function createProvider(config: ProviderConfig): LlmProvider {
  switch (config.type) {
    case "ollama":
      return new OllamaProvider();
    case "openai":
      return new OpenAiProvider();
    default:
      throw new Error(`Unsupported provider type: ${(config as { type: string }).type}`);
  }
}
