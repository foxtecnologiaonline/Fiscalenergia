import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Informe seu nome").max(120),
  email: z.email("E-mail inválido").toLowerCase(),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres"),
});

export const loginSchema = z.object({
  email: z.email("E-mail inválido").toLowerCase(),
  password: z.string().min(1, "Informe a senha"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
