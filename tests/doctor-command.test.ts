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

  it("ollama generation sends bounded context and hardware-aware runtime options", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: "ok" })
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("TDDFORGE_OLLAMA_NUM_CTX", "4096");
    vi.stubEnv("TDDFORGE_OLLAMA_NUM_PREDICT", "512");
    vi.stubEnv("TDDFORGE_OLLAMA_NUM_THREAD", "6");
    vi.stubEnv("TDDFORGE_OLLAMA_NUM_GPU", "99");

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
        num_ctx: number;
        num_predict: number;
        num_thread: number;
        num_gpu: number;
      };
    };

    expect(body.options).toEqual({
      num_ctx: 4096,
      num_predict: 512,
      num_thread: 6,
      num_gpu: 99
    });
  });
});
