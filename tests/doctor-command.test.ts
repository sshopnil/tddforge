import { describe, expect, it, vi } from "vitest";
import { createProvider } from "../src/providers/factory.js";

describe("doctor prerequisites", () => {
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
});
