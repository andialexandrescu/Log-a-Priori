import { z } from "zod";

export const getCommitsQuerySchema = z.object({ 
    repo: z.string().regex(/^[^\/]+\/[^\/]+$/),
});