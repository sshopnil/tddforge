import * as fs from "node:fs";
import { execa } from "execa";
import os from "node:os";
import path from "node:path";

const MAX_OUTPUT_LENGTH = 12000;

export async function getWorkspaceTreeContext(workspaceRoot: string): Promise<string> {
  const platform = os.platform();

  try {
    if (platform === "win32") {
      const result = await execa("cmd", ["/c", "tree", "/A", "/F"], {
        cwd: workspaceRoot,
        reject: false
      });
      if (result.exitCode === 0 && result.stdout.trim()) {
        return truncateOutput(result.stdout);
      }
    } else {
      const result = await execa("tree", ["-a", "-L", "4"], {
        cwd: workspaceRoot,
        reject: false
      });
      if (result.exitCode === 0 && result.stdout.trim()) {
        return truncateOutput(result.stdout);
      }
    }
  } catch {
    // Fall back to a Node-based tree when OS command is unavailable.
  }

  return buildNodeTree(workspaceRoot);
}

function buildNodeTree(workspaceRoot: string, depth = 0, maxDepth = 3): string {
  if (depth > maxDepth) {
    return "";
  }

  const entries = fs
    .readdirSync(workspaceRoot, { withFileTypes: true })
    .filter((entry) => entry.name !== "node_modules" && !entry.name.startsWith("."))
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));

  const lines: string[] = [];
  for (const entry of entries) {
    const prefix = `${"  ".repeat(depth)}- `;
    lines.push(`${prefix}${entry.name}${entry.isDirectory() ? "/" : ""}`);
    if (entry.isDirectory()) {
      lines.push(buildNodeTree(path.join(workspaceRoot, entry.name), depth + 1, maxDepth));
    }
  }

  return truncateOutput(lines.filter(Boolean).join("\n"));
}

function truncateOutput(value: string): string {
  return value.length > MAX_OUTPUT_LENGTH ? `${value.slice(0, MAX_OUTPUT_LENGTH)}\n...truncated...` : value;
}
