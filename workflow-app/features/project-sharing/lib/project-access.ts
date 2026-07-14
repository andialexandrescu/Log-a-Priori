import { ProjectRole, ProjectShareStatus, type ProjectRoleType } from "../constants";
import { createAdminClient } from "@/lib/pocketbase";
import { parseShareDeletionManifest } from "@/features/project-sharing/lib/project-shares-pocketbase";

export type ProjectPermissions = {
    canViewContent: boolean;
    canEditContent: boolean;
    canChangeProjectRoot: boolean;
    canRunKnowledgeGraphAnalysis: boolean;
    canManageDocumentation: boolean;
    canManageGitHubCredentials: boolean;
    canShareProject: boolean;
    canDeleteProject: boolean;
};

export function getProjectPermissions(isOwner: boolean, role: ProjectRoleType): ProjectPermissions {
    if (isOwner) {
        return {
            canViewContent: true,
            canEditContent: true,
            canChangeProjectRoot: true,
            canRunKnowledgeGraphAnalysis: true,
            canManageDocumentation: true,
            canManageGitHubCredentials: true,
            canShareProject: true,
            canDeleteProject: true,
        };
    }

    const canEdit = roleMeetsMinimum(role, ProjectRole.EDITOR);

    return {
        canViewContent: true,
        canEditContent: canEdit,
        canChangeProjectRoot: true,
        canRunKnowledgeGraphAnalysis: true,
        canManageDocumentation: canEdit,
        canManageGitHubCredentials: false,
        canShareProject: false,
        canDeleteProject: false,
    };
}

export type DeletedProjectNotice = {
    projectId: string;
    projectName: string;
    deletedAt?: string;
};

export async function getDeletedProjectNotice( projectId: string, userId: string ): Promise<DeletedProjectNotice | null> {
    const admin = await createAdminClient();

    try {
        const shares = await admin.collection("project_shares").getFullList({
            filter: `to_user = "${userId}" && status = "${ProjectShareStatus.PROJECT_DELETED}"`,
        });

        const share =
            shares.find(
                (entry) =>
                    (entry as { deleted_project_id?: string }).deleted_project_id === projectId ||
                    parseShareDeletionManifest(entry.manifest)?.projectId === projectId
            ) ?? shares.find((entry) => entry.project === projectId);

        if (!share) {
            return null;
        }

        const record = share as {
            deleted_project_name?: string;
            manifest?: unknown;
        };
        const manifest = parseShareDeletionManifest(record.manifest);

        return {
            projectId,
            projectName:
                record.deleted_project_name ?? manifest?.projectName ?? "This project",
            deletedAt: manifest?.deletedAt,
        };
    } catch {
        return null;
    }
}

export type ProjectShareLike = { role?: string | null };
export type ProjectLike = { id?: string; owner?: string | null };

const ROLE_RANK: Record<ProjectRoleType, number> = {
    [ProjectRole.VIEWER]: 1,
    [ProjectRole.EDITOR]: 2,
};

export function normalizeRole(role?: string | null): ProjectRoleType {
    if (role === ProjectRole.EDITOR || role === "admin") {
        return ProjectRole.EDITOR;
    }
    if (role === ProjectRole.VIEWER) {
        return ProjectRole.VIEWER;
    }
    return ProjectRole.VIEWER;
}

export function isProjectOwner(project: ProjectLike, userId: string): boolean {
    return project.owner === userId;
}

export function roleMeetsMinimum(role: ProjectRoleType, minimum: ProjectRoleType): boolean {
    return ROLE_RANK[normalizeRole(role)] >= ROLE_RANK[minimum];
}

export async function getAcceptedShareForUser(
    pb: {
        collection: (name: string) => {
            getFirstListItem: (filter: string) => Promise<ProjectShareLike>;
        };
    },
    projectId: string,
    userId: string
): Promise<ProjectShareLike | null> {
    try {
        return await pb.collection("project_shares").getFirstListItem(
            `project = "${projectId}" && to_user = "${userId}" && status = "accepted"`
        );
    } catch {
        return null;
    }
}

export function canShareProjectData(project: ProjectLike, userId: string): boolean {
    return isProjectOwner(project, userId);
}

export function canEditProjectContent( project: ProjectLike, share: ProjectShareLike | null, userId: string ): boolean {
    if (isProjectOwner(project, userId)) return true;
    return share ? roleMeetsMinimum(normalizeRole(share.role), ProjectRole.EDITOR) : false;
}

export function canViewProjectContent( project: ProjectLike, share: ProjectShareLike | null, userId: string ): boolean {
    if (isProjectOwner(project, userId)) return true;
    return share !== null;
}

export type ProjectAccessResult =
    | {
          ok: true;
          project: ProjectLike;
          projectId: string;
          userId: string;
          ownerUserId: string;
          isOwner: boolean;
          role: ProjectRoleType;
          share: ProjectShareLike | null;
      }
    | { ok: false; status: 401 | 403 | 404; error: string };

export async function resolveProjectAccess(
    _pb: {
        collection: (name: string) => {
            getOne: (id: string) => Promise<ProjectLike>;
            getFirstListItem: (filter: string) => Promise<ProjectShareLike>;
        };
    },
    projectId: string,
    userId: string,
    minimumRole: ProjectRoleType = ProjectRole.VIEWER
): Promise<ProjectAccessResult> {
    if (!userId) {
        return { ok: false, status: 401, error: "Unauthorized" };
    }

    if (!projectId) {
        return { ok: false, status: 404, error: "Project not found" };
    }

    const admin = await createAdminClient();

    let project: ProjectLike;
    try {
        project = await admin.collection("projects").getOne(projectId);
    } catch {
        return { ok: false, status: 404, error: "Project not found" };
    }

    if (isProjectOwner(project, userId)) {
        return {
            ok: true,
            project,
            projectId,
            userId,
            ownerUserId: project.owner ?? userId,
            isOwner: true,
            role: ProjectRole.EDITOR,
            share: null,
        };
    }

    const share = await getAcceptedShareForUser(admin, projectId, userId);
    if (!share) {
        return { ok: false, status: 403, error: "Forbidden" };
    }

    const role = normalizeRole(share.role);
    if (!roleMeetsMinimum(role, minimumRole)) {
        return { ok: false, status: 403, error: "Insufficient permissions" };
    }

    return {
        ok: true,
        project,
        projectId,
        userId,
        ownerUserId: project.owner ?? userId,
        isOwner: false,
        role,
        share,
    };
}

export type ProjectIntegrationContext = {
    accessUserId: string;
    projectId: string;
    ownerUserId: string;
    integrationUserId: string;
    localDataUserId: string;
    isOwner: boolean;
    isSharedRecipient: boolean;
    role: ProjectRoleType;
};

export type ProjectIntegrationResult =
    | ({ ok: true } & ProjectIntegrationContext)
    | { ok: false; status: 401 | 403 | 404; error: string };

export async function resolveProjectIntegrationContext(
    pb: {
        collection: (name: string) => {
            getOne: (id: string) => Promise<ProjectLike>;
            getFirstListItem: (filter: string) => Promise<ProjectShareLike>;
        };
    },
    projectId: string,
    userId: string,
    minimumRole: ProjectRoleType = ProjectRole.VIEWER
): Promise<ProjectIntegrationResult> {
    const access = await resolveProjectAccess(pb, projectId, userId, minimumRole);
    if (!access.ok) {
        return access;
    }

    const ownerUserId = access.ownerUserId;

    return {
        ok: true,
        accessUserId: userId,
        projectId,
        ownerUserId,
        integrationUserId: access.isOwner ? userId : ownerUserId,
        localDataUserId: userId,
        isOwner: access.isOwner,
        isSharedRecipient: !access.isOwner,
        role: access.role,
    };
}
