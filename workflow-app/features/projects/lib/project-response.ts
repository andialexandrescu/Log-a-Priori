import type { ProjectLike } from "@/features/project-sharing/lib/project-access";
import { getProjectPermissions, type ProjectPermissions } from "@/features/project-sharing/lib/project-access";
import type { ProjectRoleType } from "@/features/project-sharing/constants";

export type ProjectAccessPayload = {
    isOwner: boolean;
    role: ProjectRoleType;
    permissions: ProjectPermissions;
};

export function buildProjectAccessPayload( isOwner: boolean, role: ProjectRoleType ): ProjectAccessPayload {
    return {
        isOwner,
        role,
        permissions: getProjectPermissions(isOwner, role),
    };
}

export function buildProjectDetailResponse( project: ProjectLike, isOwner: boolean, role: ProjectRoleType ) {
    return {
        data: project,
        access: buildProjectAccessPayload(isOwner, role),
    };
}
