export const ProjectRole = {
  VIEWER: "viewer",
  EDITOR: "editor", 
  ADMIN: "admin"
} as const;

export type ProjectRoleType = (typeof ProjectRole)[keyof typeof ProjectRole];