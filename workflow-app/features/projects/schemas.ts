import { z } from "zod";

export type ProjectListItem = {
    id: string;
    name: string;
    description?: string;
    owner?: string;
};

export function normalizeProjectListItem(raw: unknown): ProjectListItem | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }

    const record = raw as Record<string, unknown>;
    if (typeof record.id !== "string" || record.id.length === 0) {
        return null;
    }
    if (typeof record.name !== "string") {
        return null;
    }

    return {
        id: record.id,
        name: record.name,
        description: typeof record.description === "string" ? record.description : undefined,
        owner: typeof record.owner === "string" ? record.owner : undefined,
    };
}

export function normalizeProjectListItems(raw: unknown): ProjectListItem[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    return raw
        .map(normalizeProjectListItem)
        .filter((project): project is ProjectListItem => project !== null);
}

export const createProjectSchema = z.object({
    name: z.string().min(1, 'Project name is required').max(100, 'Name must be under 100 characters'),
    description: z.string().max(500, 'Description must be under 500 characters').optional(),
    // no need to set the owner since it is set from the server route
});

// export const updateProjectSchema = z.object({ // optional fields for partial updates via patch
//     name: z.string().min(1, 'Project name is required').max(100, 'Name must be under 100 characters').optional(),
//     description: z.string().max(500, 'Description must be under 500 characters').optional(),
// });