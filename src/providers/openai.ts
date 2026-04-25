import OpenAI from "openai";
import type { ProviderConfig } from "../config/schema.js";
import type { GenerateTextInput, LlmProvider, ProviderHealth } from "./types.js";

export class OpenAiProvider implements LlmProvider {
  readonly type = "openai" as const;

  async healthCheck(config: ProviderConfig): Promise<ProviderHealth> {
    if (config.type !== "openai") {
      throw new Error("Invalid provider config for OpenAI");
    }

    if (!config.apiKey) {
      return { ok: false, message: "OPENAI_API_KEY is missing" };
    }

    return { ok: true, message: "configuration present" };
  }

  async generateText(config: ProviderConfig, input: GenerateTextInput): Promise<string> {
    if (config.type !== "openai") {
      throw new Error("Invalid provider config for OpenAI");
    }

    if (!config.apiKey) {
      throw new Error("OPENAI_API_KEY is missing");
    }

    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl
    });

    const response = await client.responses.create({
      model: config.model,
      input: [
        { role: "system", content: input.system },
        { role: "user", content: input.prompt }
      ]
    });

    return response.output_text.trim();
  }
}
