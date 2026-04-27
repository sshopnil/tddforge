import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTuiSessionId, listTuiSessions, readTuiSession, writeTuiSession } from "../src/tui/sessions.js";

describe("tui sessions", () => {
  it("stores and lists sessions", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "tddforge-session-"));
    const session = {
      id: createTuiSessionId(),
      updatedAt: "2026-04-27T10:00:00.000Z",
      activeStoryPath: path.join(workspace, "docs", "sample-story.md"),
      storyDraft: "As a user, I can reset my password.",
      latestPlan: null,
      latestGeneratedTests: null,
      folderTreeContext: "",
      logEntries: [{ id: 1, tone: "success" as const, text: "Started" }]
    };

    await writeTuiSession(workspace, session);

    await expect(readTuiSession(workspace, session.id)).resolves.toEqual(session);
    await expect(listTuiSessions(workspace)).resolves.toEqual([
      {
        id: session.id,
        updatedAt: session.updatedAt,
        title: "sample-story.md"
      }
    ]);
  });
});
