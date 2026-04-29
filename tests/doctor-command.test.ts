import { afterEach, describe, expect, it, vi } from "vitest";
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
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: "ok" } })
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("TDDFORGE_OLLAMA_NUM_CTX", "4096");
    vi.stubEnv("TDDFORGE_OLLAMA_NUM_PREDICT", "512");
    vi.stubEnv("TDDFORGE_OLLAMA_NUM_THREAD", "6");

    const provider = createProvider({
      type: "ollama",
      model: "llama3.1",
      host: "http://127.0.0.1:11434"
    });

    await provider.generateText({
      type: "ollama",
      model: "llama3.1",
      host: "http://127.0.0.1:11434"
    }, {
      system: "system",
      prompt: "prompt"
    });

    const request = fetchMock.mock.calls[0]?.[1] as { body: string };
    const url = fetchMock.mock.calls[0]?.[0] as URL;
    const body = JSON.parse(request.body) as {
      messages: Array<{ role: string; content: string }>;
      format: string;
      options: {
        num_ctx: number;
        num_predict: number;
        num_thread: number;
        num_gpu?: number;
      };
    };

    expect(url.pathname).toBe("/api/chat");
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
  });

  it("ollama generation allows explicit GPU override", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { content: "ok" } })
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("TDDFORGE_OLLAMA_NUM_GPU", "35");

    const provider = createProvider({
      type: "ollama",
      model: "llama3.1",
      host: "http://127.0.0.1:11434"
    });

    await provider.generateText({
      type: "ollama",
      model: "llama3.1",
      host: "http://127.0.0.1:11434"
    }, {
      system: "system",
      prompt: "prompt"
    });

    const request = fetchMock.mock.calls[0]?.[1] as { body: string };
    const body = JSON.parse(request.body) as {
      options: {
        num_gpu?: number;
      };
    };

    expect(body.options.num_gpu).toBe(35);
  });

  it("ollama generation returns chat message content like OpenAI output text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: { content: "  {\"summary\":\"ok\"}  " } })
      }),
    );

    const provider = createProvider({
      type: "ollama",
      model: "llama3.1",
      host: "http://127.0.0.1:11434"
    });

    const result = await provider.generateText({
      type: "ollama",
      model: "llama3.1",
      host: "http://127.0.0.1:11434"
    }, {
      system: "system",
      prompt: "prompt"
    });

    expect(result).toBe("{\"summary\":\"ok\"}");
  });

  it("ollama generation surfaces HTTP 200 provider errors before JSON parsing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ error: "model unloaded" })
      }),
    );

    const provider = createProvider({
      type: "ollama",
      model: "llama3.1",
      host: "http://127.0.0.1:11434"
    });

    await expect(provider.generateText({
      type: "ollama",
      model: "llama3.1",
      host: "http://127.0.0.1:11434"
    }, {
      system: "system",
      prompt: "prompt"
    })).rejects.toThrow("model unloaded");
  });

  it("ollama generation rejects empty successful responses with provider context", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ done: true })
      }),
    );

    const provider = createProvider({
      type: "ollama",
      model: "llama3.1",
      host: "http://127.0.0.1:11434"
    });

    await expect(provider.generateText({
      type: "ollama",
      model: "llama3.1",
      host: "http://127.0.0.1:11434"
    }, {
      system: "system",
      prompt: "prompt"
    })).rejects.toThrow("Ollama generation returned empty content");
  });
});
