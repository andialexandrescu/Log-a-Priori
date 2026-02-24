import { z } from "zod";

export const createProjectSchema = z.object({
    name: z.string().min(1, 'Project name is required').max(100, 'Name must be under 100 characters'),
    description: z.string().max(500, 'Description must be under 500 characters').optional(),
    // no need to set the owner since it is set from the server route
});

// export const updateProjectSchema = z.object({ // optional fields for partial updates via patch
//     name: z.string().min(1, 'Project name is required').max(100, 'Name must be under 100 characters').optional(),
//     description: z.string().max(500, 'Description must be under 500 characters').optional(),
// });