import { z } from "zod";

export const webhookEventsSchema = z.object({
    event: z.string(),
    repo: z.string(),
    data: z.any(),
});