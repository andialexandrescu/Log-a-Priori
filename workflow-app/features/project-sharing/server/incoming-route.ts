import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";
import { sessionMiddleware } from "@/lib/session-middleware";
import { createAdminClient } from "@/lib/pocketbase";
import { extractProjectDataArchive } from "./package-project";
import { finalizeImportedProjectData } from "../lib/import-finalization";
import { PROJECT_SHARES_COLLECTION, updateProjectShareRecord } from "../lib/project-shares-pocketbase";

type ProjectShareRecord = {
    id: string;
    project: string;
    from_user: string;
    to_user: string;
    status: string;
    role?: string;
    package_file?: string;
    sender_read?: boolean;
    receiver_read?: boolean;
};

const incomingSharingApp = new Hono()
    .get("/incoming", sessionMiddleware, async (c) => {
        const account = c.get("account");
        if (!account) return c.json({ error: "Unauthorized" }, 401);

        try {
            const admin = await createAdminClient();
            const shares = await admin.collection(PROJECT_SHARES_COLLECTION).getFullList({
                filter: `to_user = "${account.id}" && status = "pending"`,
                sort: "-created",
                expand: "project,from_user,to_user",
            });
            return c.json({ data: shares });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("collection") || message.includes("404")) {
                return c.json({
                    error: "PocketBase collection project_shares is not configured",
                }, 503);
            }
            throw error;
        }
    })
    .get("/deletion-notices", sessionMiddleware, async (c) => {
        const account = c.get("account");
        if (!account) return c.json({ error: "Unauthorized" }, 401);

        try {
            const admin = await createAdminClient();
            const shares = await admin.collection(PROJECT_SHARES_COLLECTION).getFullList({
                filter: `to_user = "${account.id}" && status = "project_deleted" && receiver_read = false`,
                sort: "-updated",
                expand: "from_user",
            });
            return c.json({ data: shares });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("collection") || message.includes("404")) {
                return c.json({
                    error: "PocketBase collection project_shares is not configured",
                }, 503);
            }
            throw error;
        }
    })
    .get("/sender-updates", sessionMiddleware, async (c) => {
        const account = c.get("account");
        if (!account) return c.json({ error: "Unauthorized" }, 401);

        try {
            const admin = await createAdminClient();
            const shares = await admin.collection(PROJECT_SHARES_COLLECTION).getFullList({
                filter: `from_user = "${account.id}" && (status = "accepted" || status = "declined") && sender_read = false`,
                sort: "-updated",
                expand: "project,to_user",
            });
            return c.json({ data: shares });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (message.includes("collection") || message.includes("404")) {
                return c.json({
                    error: "PocketBase collection project_shares is not configured",
                }, 503);
            }
            throw error;
        }
    })
    .post("/:shareId/accept", sessionMiddleware, async (c) => {
        const account = c.get("account");
        const shareId = c.req.param("shareId");
        if (!account) return c.json({ error: "Unauthorized" }, 401);

        const admin = await createAdminClient();
        const share = (await admin.collection(PROJECT_SHARES_COLLECTION).getOne(shareId, {
            expand: "to_user,from_user"
        })) as ProjectShareRecord & { expand?: { to_user: { id: string }; from_user: { id: string } } };

        if (share.to_user !== account.id) {
            return c.json({ error: "Forbidden" }, 403);
        }
        if (share.status !== "pending") {
            return c.json({ error: `Share is already ${share.status}` }, 400);
        }

        const packageUrl = admin.files.getURL(share as unknown as { id: string; collectionId: string }, share.package_file!);
        const response = await fetch(packageUrl);
        if (!response.ok) {
            return c.json({ error: "Failed to download share package" }, 500);
        }

        const tempDir = path.join(os.tmpdir(), "log-a-priori-import", shareId);
        await fs.mkdir(tempDir, { recursive: true });
        const zipPath = path.join(tempDir, "package.zip");

        try {
            const buffer = Buffer.from(await response.arrayBuffer());
            await fs.writeFile(zipPath, buffer);

            const manifest = await extractProjectDataArchive({
                recipientUserId: account.id,
                zipPath,
            });

            await finalizeImportedProjectData({
                recipientUserId: account.id,
                projectId: manifest.projectId,
                senderProjectRootPath: manifest.includesProjectRootPath,
            });

            await updateProjectShareRecord(admin, shareId, {
                status: "accepted",
                manifest,
                sender_read: false,
            });

            return c.json({
                data: {
                    manifest,
                    projectRootPath: manifest.includesProjectRootPath ?? null,
                },
            });
        } finally {
            await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
        }
    })
    .post("/:shareId/decline", sessionMiddleware, async (c) => {
        const account = c.get("account");
        const shareId = c.req.param("shareId");
        if (!account) return c.json({ error: "Unauthorized" }, 401);

        const admin = await createAdminClient();
        const share = await admin.collection(PROJECT_SHARES_COLLECTION).getOne(shareId);

        if (share.to_user !== account.id) {
            return c.json({ error: "Forbidden" }, 403);
        }

        await updateProjectShareRecord(admin, shareId, {
            status: "declined",
            sender_read: false,
        });
        return c.json({ data: { id: shareId, status: "declined" } });
    })
    .post("/:shareId/read", sessionMiddleware, async (c) => {
        const account = c.get("account");
        const shareId = c.req.param("shareId");
        if (!account) return c.json({ error: "Unauthorized" }, 401);

        const admin = await createAdminClient();
        const share = (await admin.collection(PROJECT_SHARES_COLLECTION).getOne(shareId)) as ProjectShareRecord;

        if (share.from_user !== account.id) {
            return c.json({ error: "Forbidden" }, 403);
        }
        if (share.status !== "accepted" && share.status !== "declined") {
            return c.json({ error: "Only accepted or declined shares can be marked read" }, 400);
        }

        await updateProjectShareRecord(admin, shareId, { sender_read: true });
        return c.json({ data: { id: shareId, sender_read: true } });
    })
    .post("/:shareId/dismiss-deletion", sessionMiddleware, async (c) => {
        const account = c.get("account");
        const shareId = c.req.param("shareId");
        if (!account) return c.json({ error: "Unauthorized" }, 401);

        const admin = await createAdminClient();
        const share = await admin.collection(PROJECT_SHARES_COLLECTION).getOne(shareId);

        if (share.to_user !== account.id) {
            return c.json({ error: "Forbidden" }, 403);
        }
        if (share.status !== "project_deleted") {
            return c.json({ error: "Not a project deletion notice" }, 400);
        }

        await admin.collection(PROJECT_SHARES_COLLECTION).delete(shareId);
        return c.json({ data: { id: shareId, receiver_read: true } });
    });

export default incomingSharingApp;
