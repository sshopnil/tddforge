import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { OllamaProvider } from "../src/providers/ollama.js";

describe("OllamaProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries with a larger response budget when Ollama returns incomplete JSON", async () => {
    const server = await createOllamaServer([
      {
        message: { content: "{ \"summary\": \"incomplete\"" },
        done_reason: "length"
      },
      {
        message: { content: "{ \"summary\": \"complete\" }" },
        done_reason: "stop"
      }
    ]);

    const provider = new OllamaProvider();
    const result = await provider.generateText(
      { type: "ollama", model: "gemma4:e4b", host: server.host },
      { system: "Return JSON", prompt: "Build a plan" },
    );

    expect(result.text).toBe("{ \"summary\": \"complete\" }");
    expect(server.requests).toHaveLength(2);
    const firstRequest = server.requests[0] as { options: { num_predict: number } };
    const retryRequest = server.requests[1] as { options: { num_predict: number }; messages: Array<{ content: string }> };
    expect(retryRequest.options.num_predict).toBeGreaterThan(firstRequest.options.num_predict);
    expect(retryRequest.messages[1]?.content).toContain("previous response was incomplete JSON");
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
