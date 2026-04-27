import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

export interface StoryFile {
  label: string;
  path: string;
}

const STORY_DIRECTORIES = ["story", "stories", "docs"];
const STORY_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

export async function findStoryFiles(workspaceRoot: string): Promise<StoryFile[]> {
  const files: StoryFile[] = [];

  for (const directory of STORY_DIRECTORIES) {
    const fullDirectory = path.join(workspaceRoot, directory);
    if (!await isDirectory(fullDirectory)) {
      continue;
    }

    for (const filePath of await listStoryFiles(fullDirectory)) {
      files.push({
        label: path.relative(workspaceRoot, filePath),
        path: filePath
      });
    }
  }

  return files.sort((left, right) => left.label.localeCompare(right.label));
}

export async function loadStoryFile(filePath: string): Promise<string> {
  return (await readFile(filePath, "utf8")).trim();
}

async function listStoryFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listStoryFiles(fullPath));
      continue;
    }

    if (entry.isFile() && STORY_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files;
}

async function isDirectory(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch {
    return false;
  }
}
