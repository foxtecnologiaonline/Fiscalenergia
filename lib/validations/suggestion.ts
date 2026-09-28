import { z } from "zod";

export const applySuggestionSchema = z.object({
  appliedNote: z
    .string()
    .trim()
    .min(1, "Descreva o que você fez")
    .max(500),
});

export type ApplySuggestionInput = z.infer<typeof applySuggestionSchema>;
