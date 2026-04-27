import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { GeneratedTestFiles } from "../export/generated-tests.js";
import type { PlanWorkflowResult } from "../story-engine/planner.js";

export interface StoredLogEntry {
  id: number;
  tone: "info" | "success" | "error" | "muted";
  text: string;
}

export interface TuiSession {
  id: string;
  updatedAt: string;
  activeStoryPath: string | null;
  storyDraft: string;
  latestPlan: PlanWorkflowResult | null;
  latestGeneratedTests: GeneratedTestFiles | null;
  folderTreeContext: string;
  logEntries: StoredLogEntry[];
}

export interface TuiSessionSummary {
  id: string;
  updatedAt: string;
  title: string;
}

export async function listTuiSessions(workspaceRoot: string): Promise<TuiSessionSummary[]> {
  const directory = getSessionDirectory(workspaceRoot);
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch {
    return [];
  }

  const sessions = await Promise.all(entries
    .filter((entry) => entry.endsWith(".json"))
    .map(async (entry) => {
      try {
        const session = await readTuiSession(workspaceRoot, entry.replace(/\.json$/, ""));
        return {
          id: session.id,
          updatedAt: session.updatedAt,
          title: buildSessionTitle(session)
        };
      } catch {
        return null;
      }
    }));

  return sessions
    .filter((session): session is TuiSessionSummary => session !== null)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function readTuiSession(workspaceRoot: string, sessionId: string): Promise<TuiSession> {
  const sessionPath = getSessionPath(workspaceRoot, sessionId);
  return JSON.parse(await readFile(sessionPath, "utf8")) as TuiSession;
}

export async function writeTuiSession(workspaceRoot: string, session: TuiSession): Promise<string> {
  const directory = getSessionDirectory(workspaceRoot);
  await mkdir(directory, { recursive: true });
  const sessionPath = getSessionPath(workspaceRoot, session.id);
  await writeFile(sessionPath, JSON.stringify(session, null, 2) + "\n", "utf8");
  return sessionPath;
}

export function createTuiSessionId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function getSessionDirectory(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".tddforge", "sessions");
}

function getSessionPath(workspaceRoot: string, sessionId: string): string {
  return path.join(getSessionDirectory(workspaceRoot), `${sessionId}.json`);
}

function buildSessionTitle(session: TuiSession): string {
  if (session.activeStoryPath) {
    return path.basename(session.activeStoryPath);
  }
  const firstLine = session.storyDraft.split("\n").find((line) => line.trim());
  return firstLine ? firstLine.slice(0, 72) : "Empty session";
}
