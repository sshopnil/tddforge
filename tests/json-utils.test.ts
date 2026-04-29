import { describe, expect, it } from "vitest";
import { extractJsonObject, parseModelJsonObject, safeJsonParse } from "../src/utils/json.js";

describe("json utilities", () => {
  it("parses typed JSON strings", () => {
    const result = safeJsonParse<{ name: string }>("{\"name\":\"TDDForge\"}");

    expect(result.name).toBe("TDDForge");
  });

  it("extracts a JSON object from markdown fenced output", () => {
    const result = extractJsonObject(`
      Here is the plan:

      \`\`\`json
      { "summary": "Write tests first" }
      \`\`\`
    `);

    expect(result).toBe('{ "summary": "Write tests first" }');
  });

  it("repairs common model JSON punctuation mistakes", () => {
    const result = parseModelJsonObject<{ items: string[]; summary: string }>(
      `{ "items": ["first" "second",], "summary": "ok" }`,
    );

    expect(result).toEqual({
      items: ["first", "second"],
      summary: "ok"
    });
  });

  it("repairs missing commas between object array elements", () => {
    const result = parseModelJsonObject<{ items: Array<{ id: string }> }>(
      `{ "items": [{ "id": "REQ-1" } { "id": "REQ-2" }] }`,
    );

    expect(result.items).toEqual([{ id: "REQ-1" }, { id: "REQ-2" }]);
  });

  it("extracts only the first complete object when a model appends extra JSON", () => {
    const result = parseModelJsonObject<{ summary: string }>(
      `{ "summary": "ok" } { "extra": "ignored" }`,
    );

    expect(result.summary).toBe("ok");
  });

  it("merges adjacent top-level JSON objects from local model output", () => {
    const result = parseModelJsonObject<{
      summary: string;
      requirements: Array<{ id: string }>;
      edgeCases: string[];
    }>(
      `{ "summary": "ok" }
       { "requirements": [{ "id": "REQ-1" }] }
       { "edgeCases": ["empty input"] }`,
    );

    expect(result).toEqual({
      summary: "ok",
      requirements: [{ id: "REQ-1" }],
      edgeCases: ["empty input"]
    });
  });

  it("keeps braces inside JSON strings while finding the object boundary", () => {
    const result = extractJsonObject(`
      { "summary": "Use {literal} braces", "done": true }
      trailing { ignored: true }
    `);

    expect(result).toBe('{ "summary": "Use {literal} braces", "done": true }');
  });

  it("throws a clear error when no JSON object exists", () => {
    expect(() => parseModelJsonObject("no json here")).toThrow(
      "Model response did not contain a valid JSON object",
    );
  });
});
