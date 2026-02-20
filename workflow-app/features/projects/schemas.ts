import { z } from "zod";
import { ProjectRole } from "./constants";

export const createProjectSchema = z.object({
    name: z.string().min(1, 'Project name is required').max(100, 'Name must be under 100 characters'),
    description: z.string().max(500, 'Description must be under 500 characters').optional(),
    // no need to set the owner since it is set from the server route
});

export const createMemberSchema = z.object({
    userId: z.string(),
    role: z.enum([ProjectRole.ADMIN, ProjectRole.VIEWER, ProjectRole.EDITOR]),
    // no need to set the project id
});

export const bulkCreateMembersSchema = z.object({
    members: z.array(createMemberSchema)
});

// export const updateProjectSchema = z.object({ // optional fields for partial updates via patch
//     name: z.string().min(1, 'Project name is required').max(100, 'Name must be under 100 characters').optional(),
//     description: z.string().max(500, 'Description must be under 500 characters').optional(),
// });