import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { localConfigSchema, type LocalConfig } from "./schema.js";

export const CONFIG_DIR = ".tddforge";
export const CONFIG_FILE = "config.json";

export function getConfigPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, CONFIG_DIR, CONFIG_FILE);
}

export async function ensureLocalConfig(workspaceRoot: string): Promise<string> {
  const configPath = getConfigPath(workspaceRoot);
  await mkdir(path.dirname(configPath), { recursive: true });

  try {
    await readFile(configPath, "utf8");
  } catch {
    const initialConfig = localConfigSchema.parse({});
    await writeFile(configPath, JSON.stringify(initialConfig, null, 2) + "\n", "utf8");
  }

  return configPath;
}

export async function writeLocalConfig(
  workspaceRoot: string,
  config: LocalConfig,
): Promise<string> {
  const configPath = getConfigPath(workspaceRoot);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
  return configPath;
}
