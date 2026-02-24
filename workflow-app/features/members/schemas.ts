import { ProjectRole } from "./constants";
import { z } from "zod";

export const createMemberSchema = z.object({
    userId: z.string(),
    role: z.enum([ProjectRole.ADMIN, ProjectRole.VIEWER, ProjectRole.EDITOR]),
    // no need to set the project id
});

export const bulkCreateMembersSchema = z.object({
    members: z.array(createMemberSchema)
});