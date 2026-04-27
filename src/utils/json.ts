export function safeJsonParse<T>(value: string): T {
  return JSON.parse(value) as T;
}

export function parseModelJsonObject<T>(value: string): T {
  const jsonObject = extractJsonObject(value);
  const attempts = [
    jsonObject,
    repairCommonModelJson(jsonObject)
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt) as T;
    } catch (error) {
      lastError = error;
    }
  }

  const message = lastError instanceof Error ? lastError.message : "Unknown JSON parse error";
  throw new Error(`Model response did not contain parseable JSON. ${message}`);
}

export function extractJsonObject(value: string): string {
  const trimmed = value.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start === -1 || end === -1 || end < start) {
    throw new Error("Model response did not contain a valid JSON object");
  }

  return trimmed.slice(start, end + 1);
}

function repairCommonModelJson(value: string): string {
  return value
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/}\s*{/g, "}, {")
    .replace(/]\s*{/g, "], {")
    .replace(/]\s*\[/g, "], [")
    .replace(/}\s*\[/g, "}, [")
    .replace(/"\s*{/g, "\", {")
    .replace(/"\s*\[/g, "\", [")
    .replace(/]\s+"/g, "], \"")
    .replace(/}\s+"/g, "}, \"")
    .replace(/"\s+"/g, "\", \"");
}
