import { z } from "zod";

export const getCommitsQuerySchema = z.object({ 
    repo: z.string().regex(/^[^\/]+\/[^\/]+$/),
    refresh: z.enum(["true", "false"]).optional().default("false"),
    reconcile: z.enum(["true", "false"]).optional().default("false"),
});