import { z } from "zod";

export const providerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ollama"),
    model: z.string().min(1),
    host: z.string().url().default("http://127.0.0.1:11434")
  }),
  z.object({
    type: z.literal("openai"),
    model: z.string().min(1),
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional()
  })
]);

export const localConfigSchema = z.object({
  provider: providerSchema.default({
    type: "ollama",
    model: "gemma4:e4b",
    host: "http://127.0.0.1:11434"
  }),
  testFramework: z.enum(["auto", "vitest", "jest", "pytest"]).default("auto")
});

export type LocalConfig = z.infer<typeof localConfigSchema>;
export type ProviderConfig = z.infer<typeof providerSchema>;
