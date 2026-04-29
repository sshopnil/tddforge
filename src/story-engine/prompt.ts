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
  const workspaceSummary = summarizeWorkspaceForPrompt(workspace);
  const folderTree = compactText(folderTreeContext ?? "", 6000);

  return {
    system: [
      "You are TDDForge, a senior test-planning assistant.",
      "Convert the provided story into a precise testing plan for a JavaScript or TypeScript repository.",
      "Return JSON only. Do not include markdown fences or explanation.",
      "Be careful to distinguish explicit requirements from inferred ones.",
      "Keep output grounded in the story and workspace context.",
      "Keep strings concise while preserving concrete requirements.",
      "Generate production-friendly TDD test scenarios that can be converted into real failing tests, not vague todos.",
      "For every explicit requirement, include at least one scenario that validates the happy path or main behavior.",
      "For every edge case listed in edgeCases, include at least one scenario that validates that exact edge case with concrete inputs and expected outcomes.",
      "Do not leave edge cases as vague labels only; convert each planned edge case into an executable-style Given/When/Then scenario.",
      "If an edge case maps to a requirement, include that requirement id on the scenario so generated tests can preserve traceability.",
      "Each scenario title must name the behavior under test, not generic text like should work or handles edge case.",
      "Use concrete Given/When/Then steps with realistic fixtures, exact user inputs or API payloads, and observable assertions.",
      "Each Then step must describe a production assertion such as response status, persisted state, emitted event, validation error, security boundary, idempotency, or user-visible output.",
      "Avoid implementation guesses such as private function names unless the workspace context clearly exposes them.",
      "Choose the narrowest useful level: unit for pure logic, integration for APIs or persistence, e2e only for full user workflows.",
      "For small local models: prefer fewer, complete, high-signal scenarios over many vague scenarios.",
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
      JSON.stringify(workspaceSummary),
      folderTree ? "" : null,
      folderTree ? "Workspace tree:" : null,
      folderTree || null,
      "",
      "User story:",
      compactText(storyText, 10000)
    ].filter(Boolean).join("\n")
  };
}

function summarizeWorkspaceForPrompt(workspace: WorkspaceScanResult): object {
  return {
    packageManager: workspace.packageManager,
    testFramework: workspace.testFramework,
    projectType: workspace.projectType,
    language: workspace.language,
    moduleSystem: workspace.moduleSystem,
    packageName: workspace.packageName,
    scripts: workspace.scripts.slice(0, 20),
    dependencies: workspace.dependencies.slice(0, 40),
    devDependencies: workspace.devDependencies.slice(0, 40),
    testDirectories: workspace.testDirectories,
    checkedInTestFiles: workspace.checkedInTestFiles.slice(0, 30)
  };
}

function compactText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength)}\n...truncated...`;
}
