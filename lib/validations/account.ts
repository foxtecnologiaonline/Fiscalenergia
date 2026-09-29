import { z } from "zod";

export const emailPreferencesSchema = z.object({
  emailNotificationsEnabled: z.boolean(),
});

export type EmailPreferencesInput = z.infer<typeof emailPreferencesSchema>;
