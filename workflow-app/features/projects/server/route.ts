import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { sessionMiddleware } from "@/lib/session-middleware";
import { createProjectSchema } from "../schemas";
import { createAdminClient } from "@/lib/pocketbase";
import { finalizeImportedProjectData } from "@/features/project-sharing/lib/import-finalization";
import { getDeletedProjectNotice, isProjectOwner, resolveProjectAccess } from "@/features/project-sharing/lib/project-access";
import { deleteProjectAsOwner } from "../lib/delete-project";
import { buildProjectDetailResponse } from "../lib/project-response";
import type { ProjectSharesRecord, ProjectsRecord } from "@/pocketbase-types";

const app = new Hono()
    .post("/", sessionMiddleware, zValidator("json", createProjectSchema), async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const { name, description } = c.req.valid("json");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        const project = await pb.collection("projects").create({
            name,
            description: description || "",
            owner: account.id,
        });

        return c.json({ data: project });
    })
    .get("/", sessionMiddleware, async (c) => {
        const account = c.get("account");
        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        const pb = await createAdminClient();

        const allProjects = (await pb.collection("projects").getFullList()) as ProjectsRecord[];
        const ownedProjects = allProjects.filter((project) => project.owner === account.id);

        const shares = (await pb.collection("project_shares").getFullList({
            filter: `to_user = "${account.id}" && status = "accepted"`,
        })) as ProjectSharesRecord[];

        const sharedProjects = shares
            .map((share) => allProjects.find((project) => project.id === share.project))
            .filter((project): project is ProjectsRecord => project !== undefined);

        return c.json({ data: [...ownedProjects, ...sharedProjects] });
    })
    .get("/:projectId", sessionMiddleware, async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const projectId = c.req.param("projectId");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        const admin = await createAdminClient();
        let projectExists = true;

        try {
            await admin.collection("projects").getOne(projectId);
        } catch {
            projectExists = false;
        }

        if (!projectExists) {
            const deleted = await getDeletedProjectNotice(projectId, account.id);
            if (deleted) {
                return c.json(
                    {
                        error: `The project "${deleted.projectName}" was deleted by its owner, your local copy of shared data for this project has been removed from this machine`,
                        code: "PROJECT_DELETED_BY_OWNER",
                        deleted,
                    },
                    410
                );
            }
            return c.json({ error: "Project not found" }, 404);
        }

        const access = await resolveProjectAccess(pb, projectId, account.id);
        if (!access.ok) {
            return c.json({ error: access.error }, access.status);
        }

        if (!access.isOwner && access.share) {
            try {
                const share = await admin.collection("project_shares").getFirstListItem(
                    `to_user = "${account.id}" && project = "${projectId}" && status = "accepted"`
                );

                if (share.manifest) {
                    const manifest =
                        typeof share.manifest === "string"
                            ? JSON.parse(share.manifest)
                            : share.manifest;
                    await finalizeImportedProjectData({
                        recipientUserId: account.id,
                        projectId,
                        senderProjectRootPath: manifest.includesProjectRootPath ?? null,
                    });
                }
            } catch {
                // repair is best effort for previously accepted shares
            }
        }

        return c.json(
            buildProjectDetailResponse(access.project, access.isOwner, access.role)
        );
    })
    .delete("/:projectId", sessionMiddleware, async (c) => {
        const account = c.get("account");
        const projectId = c.req.param("projectId");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        const admin = await createAdminClient();

        let project: ProjectsRecord;
        try {
            project = (await admin.collection("projects").getOne(projectId)) as ProjectsRecord;
        } catch {
            return c.json({ error: "Project not found" }, 404);
        }

        if (!isProjectOwner(project, account.id)) {
            return c.json({ error: "Only the project owner can delete this project" }, 403);
        }

        try {
            await deleteProjectAsOwner(projectId, account.id);
            return c.json({ data: { id: projectId, deleted: true } });
        } catch (error) {
            console.error("Failed to delete project:", error);
            const message =
                error instanceof Error && error.message
                    ? error.message
                    : "Failed to delete project";
            return c.json({ error: message }, 500);
        }
    });

export default app;
