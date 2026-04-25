import type { ProviderConfig } from "../config/schema.js";
import type { GenerateTextInput, LlmProvider, ProviderHealth } from "./types.js";

interface OllamaTagsResponse {
  models?: Array<{ name: string }>;
}

interface OllamaGenerateResponse {
  response?: string;
}

export class OllamaProvider implements LlmProvider {
  readonly type = "ollama" as const;

  async healthCheck(config: ProviderConfig): Promise<ProviderHealth> {
    if (config.type !== "ollama") {
      throw new Error("Invalid provider config for Ollama");
    }

    try {
      const response = await fetch(new URL("/api/tags", config.host));
      if (!response.ok) {
        return { ok: false, message: `HTTP ${response.status}` };
      }

      const body = (await response.json()) as OllamaTagsResponse;
      const modelExists = body.models?.some((model) => model.name === config.model);

      return modelExists
        ? { ok: true, message: "model available" }
        : { ok: false, message: `model '${config.model}' not found` };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown Ollama error";
      return { ok: false, message };
    }
  }

  async generateText(config: ProviderConfig, input: GenerateTextInput): Promise<string> {
    if (config.type !== "ollama") {
      throw new Error("Invalid provider config for Ollama");
    }

    const response = await fetch(new URL("/api/generate", config.host), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        prompt: `${input.system}\n\n${input.prompt}`,
        stream: false
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama generation failed with HTTP ${response.status}`);
    }

    const body = (await response.json()) as OllamaGenerateResponse;
    return body.response?.trim() ?? "";
  }
}
