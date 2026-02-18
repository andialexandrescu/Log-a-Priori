import { z } from "zod";

export const loginSchema = z.object({
    email: z.string().trim().email(),
    password: z.string().trim().min(1, "Required"),
});

export const registerSchema = z.object({
    username: z.string().trim().min(1, "Required"),
    email: z.string().trim().email(),
    password: z.string().trim().min(6, "Minimum of 6 characters"),
});