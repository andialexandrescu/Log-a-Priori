import { z } from "zod";

export const createCredentialsSchema = z.object({
    name: z.string().min(1, "Platform name is required"),
    api_keys: z.object({
        token: z.string().min(1, "GitHub token is required"),
        owner: z.string().min(1, "Repository owner is required"),
        repo: z.string().min(1, "Repository name is required"),
        webhookSecret: z.string().min(1, "Webhook secret is required"),
    }),
    api_limitations: z.record(z.string(), z.unknown()).optional(), // json limitations not yet known
    // no need to set the project id or member id, since they are part of the endpoint
});