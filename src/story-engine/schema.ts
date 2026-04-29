import { z } from "zod";

export const requirementItemSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  source: z.enum(["explicit", "inferred", "unknown"])
});

export const testScenarioSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  level: z.enum(["unit", "integration", "e2e"]),
  requirementIds: z.array(z.string()).default([]),
  given: z.string().min(1),
  when: z.string().min(1),
  then: z.string().min(1)
});

export const planArtifactSchema = z.object({
  summary: z.string().min(1),
  requirements: z.array(requirementItemSchema).min(1),
  ambiguities: z.array(z.string()).default([]),
  edgeCases: z.array(z.string()).default([]),
  suggestedTestScenarios: z.array(testScenarioSchema).min(1)
});

export type PlanArtifact = z.infer<typeof planArtifactSchema>;
