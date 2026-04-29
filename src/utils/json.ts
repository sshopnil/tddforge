export function safeJsonParse<T>(value: string): T {
  return JSON.parse(value) as T;
}

export function parseModelJsonObject<T>(value: string): T {
  const jsonObject = extractJsonObject(value);
  const mergedObjects = extractJsonObjects(value);
  const attempts = [
    mergedObjects.length > 1 ? mergeJsonObjects(mergedObjects) : null,
    jsonObject,
    repairCommonModelJson(jsonObject)
  ].filter((attempt): attempt is string => Boolean(attempt));

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
  const [jsonObject] = extractJsonObjects(value);

  if (!jsonObject) {
    throw new Error("Model response did not contain a valid JSON object");
  }

  return jsonObject;
}

function extractJsonObjects(value: string): string[] {
  const trimmed = value.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const objects: string[] = [];
  let start: number | null = null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = inString;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0 && start !== null) {
        objects.push(trimmed.slice(start, index + 1));
        start = null;
      }
    }
  }

  if (objects.length === 0) {
    throw new Error(depth > 0
      ? "Model response did not contain a complete JSON object"
      : "Model response did not contain a valid JSON object");
  }

  return objects;
}

function mergeJsonObjects(objects: string[]): string {
  const merged: Record<string, unknown> = {};

  for (const objectText of objects) {
    const parsed = parseJsonObjectAttempt(objectText);
    if (!parsed || Array.isArray(parsed)) {
      continue;
    }
    Object.assign(merged, parsed);
  }

  return JSON.stringify(merged);
}

function parseJsonObjectAttempt(value: string): Record<string, unknown> | null {
  for (const attempt of [value, repairCommonModelJson(value)]) {
    try {
      const parsed = JSON.parse(attempt) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
    } catch {
      // Try the repaired form.
    }
  }

  return null;
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
