import type PocketBase from "pocketbase";

export const PROJECT_SHARES_COLLECTION = "project_shares";

export function getPocketBaseErrorMessage(error: unknown): string {
    if (error && typeof error === "object" && "response" in error) {
        const response = (error as { response?: { data?: unknown; message?: string } }).response;
        if (response?.message) {
            return response.message;
        }
        if (response?.data && typeof response.data === "object") {
            return JSON.stringify(response.data);
        }
    }
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return "Request failed";
}

function normalizeManifestForUpdate(manifest: unknown): unknown {
    if (typeof manifest !== "string") {
        return manifest;
    }
    try {
        return JSON.parse(manifest);
    } catch {
        return manifest;
    }
}

const OPTIONAL_SHARE_PATCH_FIELDS = [
    "sender_read",
    "receiver_read",
    "deleted_project_id",
    "deleted_project_name",
    "project",
] as const;

function buildShareUpdateAttempts(patch: Record<string, unknown>): Record<string, unknown>[] {
    const base = { ...patch };
    if ("manifest" in base) {
        base.manifest = normalizeManifestForUpdate(base.manifest);
    }

    const attempts: Record<string, unknown>[] = [base];
    for (const field of OPTIONAL_SHARE_PATCH_FIELDS) {
        if (!(field in base)) {
            continue;
        }
        const last = attempts[attempts.length - 1];
        const { [field]: _removed, ...next } = last;
        if (Object.keys(next).length > 0) {
            attempts.push(next);
        }
    }
    return attempts;
}

export async function updateProjectShareRecord( admin: PocketBase, shareId: string, patch: Record<string, unknown> ): Promise<void> {
    let lastError: unknown;
    for (const body of buildShareUpdateAttempts(patch)) {
        try {
            await admin.collection(PROJECT_SHARES_COLLECTION).update(shareId, body);
            return;
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError;
}

export type ShareDeletionManifest = {
    projectId: string;
    projectName: string;
    deletedAt: string;
    deletedBy: string;
};

export function parseShareDeletionManifest(manifest: unknown): ShareDeletionManifest | null {
    if (!manifest) {
        return null;
    }

    try {
        const parsed =
            typeof manifest === "string" ? JSON.parse(manifest) : (manifest as Record<string, unknown>);
        const projectId = typeof parsed.projectId === "string" ? parsed.projectId : "";
        const projectName = typeof parsed.projectName === "string" ? parsed.projectName : "";
        const deletedAt = typeof parsed.deletedAt === "string" ? parsed.deletedAt : "";
        const deletedBy = typeof parsed.deletedBy === "string" ? parsed.deletedBy : "";
        if (!projectId || !projectName) {
            return null;
        }
        return { projectId, projectName, deletedAt, deletedBy };
    } catch {
        return null;
    }
}

export async function markShareAsProjectDeleted( admin: PocketBase, shareId: string, payload: ShareDeletionManifest ): Promise<void> {
    await updateProjectShareRecord(admin, shareId, {
        status: "project_deleted",
        manifest: payload,
        deleted_project_id: payload.projectId,
        deleted_project_name: payload.projectName,
        receiver_read: false,
        project: "",
    });
}
