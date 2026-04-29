import type { ProviderConfig } from "../config/schema.js";
import type { GenerateTextInput, GenerateTextResult, LlmProvider, ProviderHealth, TokenUsage } from "./types.js";
import { Buffer } from "node:buffer";
import http from "node:http";
import https from "node:https";
import os from "node:os";

interface OllamaTagsResponse {
  models?: Array<{ name: string }>;
}

interface OllamaChatResponse {
  message?: {
    content?: string;
  };
  response?: string;
  error?: string;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaChatRequest {
  model: string;
  messages: Array<{
    role: "system" | "user";
    content: string;
  }>;
  stream: false;
  format: "json";
  options: {
    num_ctx: number;
    num_predict: number;
    num_thread: number;
    num_gpu?: number;
  };
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

  async generateText(config: ProviderConfig, input: GenerateTextInput): Promise<GenerateTextResult> {
    if (config.type !== "ollama") {
      throw new Error("Invalid provider config for Ollama");
    }

    const first = await requestOllamaChat(config, input, 1);
    const firstJsonStatus = getJsonObjectStatus(first.content);
    if (firstJsonStatus !== "incomplete") {
      return { text: first.content, tokenUsage: first.tokenUsage };
    }

    const retry = await requestOllamaChat(
      config,
      {
        system: input.system,
        signal: input.signal,
        prompt: [
          input.prompt,
          "",
          "The previous response was incomplete JSON.",
          "Return the complete JSON object again from the beginning.",
          "Do not include markdown, comments, or prose outside the JSON object."
        ].join("\n")
      },
      2,
    );

    if (getJsonObjectStatus(retry.content) !== "incomplete") {
      return { text: retry.content, tokenUsage: retry.tokenUsage };
    }

    throw new Error(
      `Ollama generation returned incomplete JSON for model '${config.model}' at ${config.host}` +
      `${first.doneReason ? ` (first stop: ${first.doneReason})` : ""}` +
      `${retry.doneReason ? ` (retry stop: ${retry.doneReason})` : ""}` +
      `. Increase TDDFORGE_OLLAMA_NUM_PREDICT or use a model with stronger JSON output.`,
    );
  }
}

async function requestOllamaChat(
  config: Extract<ProviderConfig, { type: "ollama" }>,
  input: GenerateTextInput,
  attempt: 1 | 2,
): Promise<{ content: string; doneReason?: string; tokenUsage?: TokenUsage }> {
  let response: HttpJsonResponse;
  try {
    response = await postJsonNoTimeout(
      new URL("/api/chat", config.host),
      {
        model: config.model,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.prompt }
        ],
        stream: false,
        format: "json",
        options: buildOllamaOptions(attempt)
      } satisfies OllamaChatRequest,
      input.signal,
    );
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Unknown HTTP error";
    throw new Error(`Ollama generation request failed at ${config.host}: ${message}`);
  }

  if (!response.ok) {
    throw new Error(`Ollama generation failed at ${config.host} with HTTP ${response.status}`);
  }

  const body = JSON.parse(response.body) as OllamaChatResponse;
  if (body.error) {
    throw new Error(`Ollama generation failed for model '${config.model}' at ${config.host}: ${body.error}`);
  }

  const content = body.message?.content ?? body.response ?? "";
  if (!content.trim()) {
    throw new Error(
      `Ollama generation returned empty content for model '${config.model}' at ${config.host}: ${summarizeOllamaBody(body)}`,
    );
  }

  return { content: content.trim(), doneReason: body.done_reason, tokenUsage: readOllamaTokenUsage(body) };
}

interface HttpJsonResponse {
  ok: boolean;
  status: number;
  body: string;
}

function postJsonNoTimeout(url: URL, body: unknown, signal?: globalThis.AbortSignal): Promise<HttpJsonResponse> {
  const bodyText = JSON.stringify(body);
  const transport = url.protocol === "https:" ? https : http;

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }

    const request = transport.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(bodyText).toString()
      },
      timeout: 0
    }, (response) => {
      response.setEncoding("utf8");
      let responseBody = "";
      response.on("data", (chunk: string) => {
        responseBody += chunk;
      });
      response.on("end", () => {
        resolve({
          ok: (response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300,
          status: response.statusCode ?? 500,
          body: responseBody
        });
      });
    });

    const abort = (): void => {
      request.destroy(createAbortError());
    };

    signal?.addEventListener("abort", abort, { once: true });
    request.setTimeout(0);
    request.on("error", (error) => {
      signal?.removeEventListener("abort", abort);
      reject(error);
    });
    request.on("close", () => {
      signal?.removeEventListener("abort", abort);
    });
    request.end(bodyText);
  });
}

function createAbortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function readOllamaTokenUsage(body: OllamaChatResponse): TokenUsage | undefined {
  const inputTokens = readFiniteNumber(body.prompt_eval_count);
  const outputTokens = readFiniteNumber(body.eval_count);
  const totalTokens = inputTokens === undefined && outputTokens === undefined
    ? undefined
    : (inputTokens ?? 0) + (outputTokens ?? 0);

  return inputTokens === undefined && outputTokens === undefined
    ? undefined
    : { inputTokens, outputTokens, totalTokens };
}

function readFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function buildOllamaOptions(attempt: 1 | 2): OllamaChatRequest["options"] {
  const cpuCount = typeof os.availableParallelism === "function"
    ? os.availableParallelism()
    : os.cpus().length;
  const configuredPredictionLimit = readPositiveIntegerEnv("TDDFORGE_OLLAMA_NUM_PREDICT", 4096);

  return {
    num_ctx: readPositiveIntegerEnv("TDDFORGE_OLLAMA_NUM_CTX", 8192),
    num_predict: attempt === 1 ? configuredPredictionLimit : Math.max(configuredPredictionLimit * 2, 8192),
    num_thread: readPositiveIntegerEnv("TDDFORGE_OLLAMA_NUM_THREAD", Math.max(1, cpuCount - 1)),
    ...readOptionalIntegerEnv("TDDFORGE_OLLAMA_NUM_GPU")
  };
}

function getJsonObjectStatus(value: string): "complete" | "incomplete" | "none" {
  const trimmed = value.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  let depth = 0;
  let started = false;
  let inString = false;
  let escaped = false;

  for (const char of trimmed) {
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = inString;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      started = true;
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (started && depth === 0) {
        return "complete";
      }
    }
  }

  return started && depth > 0 ? "incomplete" : "none";
}

function readPositiveIntegerEnv(name: string, fallback: number): number {
  return Math.max(1, readIntegerEnv(name, fallback));
}

function readIntegerEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readOptionalIntegerEnv(name: string): { num_gpu?: number } {
  const value = process.env[name];
  if (!value) {
    return {};
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? { num_gpu: parsed } : {};
}

function summarizeOllamaBody(body: OllamaChatResponse): string {
  const serialized = JSON.stringify(body);
  if (!serialized) {
    return "{}";
  }

  return serialized.length <= 300 ? serialized : `${serialized.slice(0, 300)}...`;
}
