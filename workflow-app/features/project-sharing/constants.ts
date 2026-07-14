export const ProjectRole = {
    VIEWER: "viewer",
    EDITOR: "editor",
} as const;

export type ProjectRoleType = (typeof ProjectRole)[keyof typeof ProjectRole];

export const ProjectShareStatus = {
    PENDING: "pending",
    ACCEPTED: "accepted",
    DECLINED: "declined",
    PROJECT_DELETED: "project_deleted",
} as const;

export const PROJECT_ROLE_LABELS: Record<ProjectRoleType, string> = {
    viewer: "Viewer, read-only",
    editor: "Editor, edit graphs and documentation",
};

export const PROJECT_ROLE_CAPABILITIES: Record<ProjectRoleType, readonly string[]> = {
    [ProjectRole.VIEWER]: [
        "View knowledge graph, documentation, and recent commit events",
        "Set your local project root and rebuild the knowledge graph on this machine",
        "Cannot edit documentation or configure GitHub",
        "Cannot share the project or delete it",
    ],
    [ProjectRole.EDITOR]: [
        "Everything a viewer can do",
        "Change project root and re-run knowledge graph analysis",
        "Edit living documentation and clustering tools that modify project data",
        "Uses the project owner's GitHub integration for commits",
    ],
};
