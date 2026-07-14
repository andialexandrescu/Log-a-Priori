import { z } from "zod";
import { ProjectRole } from "./constants";

export const createProjectShareSchema = z.object({
    recipientUserId: z.string().min(1),
    role: z.enum([ProjectRole.EDITOR, ProjectRole.VIEWER]).optional(),
    message: z.string().max(500).optional(),
});

export const updateProjectShareRoleSchema = z.object({
    role: z.enum([ProjectRole.EDITOR, ProjectRole.VIEWER]),
});
