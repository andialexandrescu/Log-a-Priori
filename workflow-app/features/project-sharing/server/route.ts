import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { sessionMiddleware } from "@/lib/session-middleware";
import { createAdminClient } from "@/lib/pocketbase";
import { getDesktopSettingsFilePath } from "@desktop-shell/shared/desktop-shell-paths";
import { createProjectShareSchema } from "../schemas";
import { createProjectDataArchive } from "./package-project";
import { resolveProjectAccess } from "../lib/project-access";
import { buildProjectAccessList } from "../lib/project-access-list";

const PROJECT_SHARES_COLLECTION = "project_shares";

async function readProjectRootFromDesktopSettings( userId: string, projectId: string ): Promise<string | null> {
    try {
        const raw = await fs.readFile(getDesktopSettingsFilePath(), "utf8");
        const parsed = JSON.parse(raw) as {
            projectRoots?: Record<string, string>;
            users?: Record<string, { projectRoots?: Record<string, string> }>;
        };

        const userRoots = parsed.users?.[userId]?.projectRoots;
        if (userRoots?.[projectId]) {
            return userRoots[projectId];
        }
        if (parsed.projectRoots?.[projectId]) {
            return parsed.projectRoots[projectId];
        }
    } catch {
    }
    return null;
}

const projectSharingApp = new Hono()
    .get("/access", sessionMiddleware, async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const projectId = c.req.param("projectId");
        if (!account) return c.json({ error: "Unauthorized" }, 401);
        if (!projectId) return c.json({ error: "Project ID required" }, 400);

        const access = await resolveProjectAccess(pb, projectId, account.id);
        if (!access.ok) {
            return c.json({ error: access.error }, access.status);
        }

        const admin = await createAdminClient();
        const ownerUser = await admin.collection("users").getOne(access.ownerUserId);
        const shares = await admin.collection(PROJECT_SHARES_COLLECTION).getFullList({
            filter: `project = "${projectId}"`,
            sort: "-created",
            expand: "to_user",
        });

        const users = buildProjectAccessList(ownerUser, shares, {
            includePending: access.isOwner,
        });

        return c.json({ data: users });
    })
    .get("/outgoing", sessionMiddleware, async (c) => {
        const account = c.get("account");
        const projectId = c.req.param("projectId");
        if (!account) return c.json({ error: "Unauthorized" }, 401);

        const admin = await createAdminClient();
        const shares = await admin.collection(PROJECT_SHARES_COLLECTION).getFullList({
            filter: `project = "${projectId}" && from_user = "${account.id}"`,
            sort: "-created",
            expand: "from_user,to_user",
        });
        return c.json({ data: shares });
    })
    .post("/", sessionMiddleware, zValidator("json", createProjectShareSchema), async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const projectId = c.req.param("projectId");
        const { recipientUserId, role, message } = c.req.valid("json");

        if (!account) return c.json({ error: "Unauthorized" }, 401);

        if (!projectId) return c.json({ error: "Project ID required" }, 400);

        const project = await pb.collection("projects").getOne(projectId);
        if (project.owner !== account.id) {
            return c.json({ error: "Only project owners can share project data" }, 403);
        }

        if (recipientUserId === account.id) {
            return c.json({ error: "Cannot share a project package to yourself" }, 400);
        }

        const tempDir = path.join(os.tmpdir(), "log-a-priori-share", projectId, `${Date.now()}`);
        await fs.mkdir(tempDir, { recursive: true });
        const zipPath = path.join(tempDir, `${projectId}-share.zip`);

        try {
            const projectRootPath = await readProjectRootFromDesktopSettings(account.id, projectId);
            const manifest = await createProjectDataArchive({
                senderUserId: account.id,
                projectId,
                projectName: project.name,
                recipientUserId,
                projectRootPath,
                outputZipPath: zipPath,
            });

            const zipBuffer = await fs.readFile(zipPath);
            const formData = new FormData();

            // append text fields (all required)
            formData.append("project", projectId);
            formData.append("from_user", account.id);
            formData.append("to_user", recipientUserId);
            formData.append("status", "pending");
            formData.append("sender_read", "false");
            formData.append("receiver_read", "false");
            formData.append("role", role ?? "viewer");
            if (message) formData.append("message", message);
            formData.append("manifest", JSON.stringify(manifest));

            // append the file, field name MUST be "package_file"
            const blob = new Blob([zipBuffer], { type: "application/zip" });
            formData.append("package_file", blob, `${projectId}-share.zip`);

            const admin = await createAdminClient();
            
            let shareRecord;
            try {
                shareRecord = await admin.collection(PROJECT_SHARES_COLLECTION).create(formData);
            } catch (error: any) {
                console.error("PocketBase error details:", {
                    message: error.message,
                    response: error.response?.data,
                    status: error.status,
                });
                throw error;
            }

            return c.json({ data: shareRecord }, 201);
        } catch (error) {
            const errMessage = error instanceof Error ? error.message : String(error);
            if (errMessage.includes("collection") || errMessage.includes("404")) {
                return c.json({
                    error: "PocketBase collection project_shares is not configured",
                }, 503);
            }
            console.error("[project-sharing] share failed:", error);
            return c.json({ error: "Failed to create project share package" }, 500);
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        }
    })
    .post("/export", sessionMiddleware, async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const projectId = c.req.param("projectId");

        if (!account) return c.json({ error: "Unauthorized" }, 401);

        if (!projectId) return c.json({ error: "Project ID required" }, 400);

        const project = await pb.collection("projects").getOne(projectId);
        if (project.owner !== account.id) {
            return c.json({ error: "Forbidden" }, 403);
        }

        const tempDir = path.join(os.tmpdir(), "log-a-priori-export", projectId, `${Date.now()}`);
        await fs.mkdir(tempDir, { recursive: true });
        const zipPath = path.join(tempDir, `${projectId}-export.zip`);

        try {
            const projectRootPath = await readProjectRootFromDesktopSettings(account.id, projectId);
            await createProjectDataArchive({
                senderUserId: account.id,
                projectId,
                projectName: project.name,
                recipientUserId: account.id,
                projectRootPath,
                outputZipPath: zipPath,
            });

            const zipBuffer = await fs.readFile(zipPath);
            return new Response(zipBuffer, {
                headers: {
                    "Content-Type": "application/zip",
                    "Content-Disposition": `attachment; filename="${projectId}-share.zip"`,
                },
            });
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        }
    });

export default projectSharingApp;
