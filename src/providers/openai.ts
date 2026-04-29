import OpenAI from "openai";
import type { ProviderConfig } from "../config/schema.js";
import type { GenerateTextInput, GenerateTextResult, LlmProvider, ProviderHealth, TokenUsage } from "./types.js";

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

  async generateText(config: ProviderConfig, input: GenerateTextInput): Promise<GenerateTextResult> {
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
    }, { signal: input.signal });

    return {
      text: response.output_text.trim(),
      tokenUsage: readOpenAiTokenUsage(response.usage)
    };
  }
}

function readOpenAiTokenUsage(usage: unknown): TokenUsage | undefined {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const record = usage as Record<string, unknown>;
  return compactTokenUsage({
    inputTokens: readNumber(record.input_tokens),
    outputTokens: readNumber(record.output_tokens),
    totalTokens: readNumber(record.total_tokens)
  });
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function compactTokenUsage(usage: TokenUsage): TokenUsage | undefined {
  return usage.inputTokens === undefined && usage.outputTokens === undefined && usage.totalTokens === undefined
    ? undefined
    : usage;
}
