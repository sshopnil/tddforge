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

  it("throws a clear error when no JSON object exists", () => {
    expect(() => parseModelJsonObject("no json here")).toThrow(
      "Model response did not contain a valid JSON object",
    );
  });
});
