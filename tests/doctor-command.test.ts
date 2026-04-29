import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createProvider } from "../src/providers/factory.js";

describe("doctor prerequisites", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("ollama provider reports invalid model when health endpoint lacks it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ models: [{ name: "other-model" }] })
      }),
    );

    const provider = createProvider({
      type: "ollama",
      model: "llama3.1",
      host: "http://127.0.0.1:11434"
    });

    const result = await provider.healthCheck({
      type: "ollama",
      model: "llama3.1",
      host: "http://127.0.0.1:11434"
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("not found");
  });

  it("ollama generation uses chat messages, JSON format, and bounded CPU runtime options", async () => {
    const server = await createOllamaServer([{ message: { content: "ok" } }]);
    vi.stubEnv("TDDFORGE_OLLAMA_NUM_CTX", "4096");
    vi.stubEnv("TDDFORGE_OLLAMA_NUM_PREDICT", "512");
    vi.stubEnv("TDDFORGE_OLLAMA_NUM_THREAD", "6");

    const provider = createProvider({
      type: "ollama",
      model: "llama3.1",
      host: server.host
    });

    await provider.generateText({
      type: "ollama",
      model: "llama3.1",
      host: server.host
    }, {
      system: "system",
      prompt: "prompt"
    });

    const body = server.requests[0] as {
      messages: Array<{ role: string; content: string }>;
      format: string;
      options: {
        num_ctx: number;
        num_predict: number;
        num_thread: number;
        num_gpu?: number;
      };
    };

    expect(body.messages).toEqual([
      { role: "system", content: "system" },
      { role: "user", content: "prompt" }
    ]);
    expect(body.format).toBe("json");
    expect(body.options).toEqual({
      num_ctx: 4096,
      num_predict: 512,
      num_thread: 6
    });
    await server.close();
  });

  it("ollama generation allows explicit GPU override", async () => {
    const server = await createOllamaServer([{ message: { content: "ok" } }]);
    vi.stubEnv("TDDFORGE_OLLAMA_NUM_GPU", "35");

    const provider = createProvider({
      type: "ollama",
      model: "llama3.1",
      host: server.host
    });

    await provider.generateText({
      type: "ollama",
      model: "llama3.1",
      host: server.host
    }, {
      system: "system",
      prompt: "prompt"
    });

    const body = server.requests[0] as {
      options: {
        num_gpu?: number;
      };
    };

    expect(body.options.num_gpu).toBe(35);
    await server.close();
  });

  it("ollama generation returns chat message content like OpenAI output text", async () => {
    const server = await createOllamaServer([{ message: { content: "  {\"summary\":\"ok\"}  " }, prompt_eval_count: 12, eval_count: 8 }]);

    const provider = createProvider({
      type: "ollama",
      model: "llama3.1",
      host: server.host
    });

    const result = await provider.generateText({
      type: "ollama",
      model: "llama3.1",
      host: server.host
    }, {
      system: "system",
      prompt: "prompt"
    });

    expect(result.text).toBe("{\"summary\":\"ok\"}");
    expect(result.tokenUsage).toEqual({
      inputTokens: 12,
      outputTokens: 8,
      totalTokens: 20
    });
    await server.close();
  });

  it("ollama generation surfaces HTTP 200 provider errors before JSON parsing", async () => {
    const server = await createOllamaServer([{ error: "model unloaded" }]);

    const provider = createProvider({
      type: "ollama",
      model: "llama3.1",
      host: server.host
    });

    await expect(provider.generateText({
      type: "ollama",
      model: "llama3.1",
      host: server.host
    }, {
      system: "system",
      prompt: "prompt"
    })).rejects.toThrow("model unloaded");
    await server.close();
  });

  it("ollama generation rejects empty successful responses with provider context", async () => {
    const server = await createOllamaServer([{ done: true }]);

    const provider = createProvider({
      type: "ollama",
      model: "llama3.1",
      host: server.host
    });

    await expect(provider.generateText({
      type: "ollama",
      model: "llama3.1",
      host: server.host
    }, {
      system: "system",
      prompt: "prompt"
    })).rejects.toThrow("Ollama generation returned empty content");
    await server.close();
  });
});

async function createOllamaServer(responses: unknown[]): Promise<{
  host: string;
  requests: unknown[];
  close: () => Promise<void>;
}> {
  const requests: unknown[] = [];
  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    let body = "";
    request.setEncoding("utf8");
    for await (const chunk of request) {
      body += chunk;
    }
    requests.push(JSON.parse(body) as unknown);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(responses.shift() ?? responses.at(-1) ?? {}));
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start test Ollama server");
  }

  return {
    host: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    })
  };
}
