import { describe, expect, it } from "vitest";
import { createProvider } from "../src/providers/factory.js";

describe("provider factory", () => {
  it("creates ollama provider", () => {
    const provider = createProvider({
      type: "ollama",
      model: "llama3.1",
      host: "http://127.0.0.1:11434"
    });

    expect(provider.type).toBe("ollama");
  });

  it("creates openai provider", () => {
    const provider = createProvider({
      type: "openai",
      model: "gpt-4o-mini",
      apiKey: "test-key"
    });

    expect(provider.type).toBe("openai");
  });
});
