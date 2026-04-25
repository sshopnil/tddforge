export function safeJsonParse<T>(value: string): T {
  return JSON.parse(value) as T;
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
