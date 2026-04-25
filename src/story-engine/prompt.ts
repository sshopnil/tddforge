import type { WorkspaceScanResult } from "../workspace/types.js";

export interface PlanningPrompt {
  system: string;
  prompt: string;
}

export function buildPlanningPrompt(
  storyText: string,
  workspace: WorkspaceScanResult,
  folderTreeContext?: string,
): PlanningPrompt {
  return {
    system: [
      "You are TDDForge, a senior test-planning assistant.",
      "Convert the provided story into a precise testing plan for a JavaScript or TypeScript repository.",
      "Return JSON only. Do not include markdown fences or explanation.",
      "Be careful to distinguish explicit requirements from inferred ones.",
      "Keep output grounded in the story and workspace context.",
      "Use this exact JSON shape:",
      JSON.stringify({
        summary: "short summary",
        requirements: [
          { id: "REQ-1", text: "A requirement", source: "explicit" }
        ],
        ambiguities: ["What should happen when ...?"],
        edgeCases: ["Empty input", "Unauthorized user"],
        suggestedTestScenarios: [
          {
            id: "TC-1",
            title: "Valid input succeeds",
            level: "unit",
            requirementIds: ["REQ-1"],
            given: "Given some precondition",
            when: "When an action occurs",
            then: "Then the expected outcome happens"
          }
        ]
      })
    ].join("\n"),
    prompt: [
      "Workspace context:",
      JSON.stringify(workspace, null, 2),
      folderTreeContext ? "" : null,
      folderTreeContext ? "Workspace tree:" : null,
      folderTreeContext ?? null,
      "",
      "User story:",
      storyText.trim()
    ].filter(Boolean).join("\n")
  };
}
