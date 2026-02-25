import { Hono } from "hono";
import { sessionMiddleware } from "@/lib/session-middleware";

const app = new Hono()
    .get("/:projectId/:changelogId", sessionMiddleware, async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const projectId = c.req.param("projectId");
        const changelogId = c.req.param("changelogId");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        const changelog = await pb.collection("changelogs").getOne(changelogId);
        if (!changelog) {
            return c.json({ error: "Not found" }, 404);
        }
        if (changelog.project !== projectId) {
            return c.json({ error: `Changelog ${changelogId} not found for project ${projectId}` }, 404);
        }

        try {
            await pb.collection("members").getFirstListItem(
                `user = "${account.id}" && project = "${projectId}"`
            );

            return c.json({ data: changelog });
        } catch {
            return c.json({ error: "Forbidden" }, 403);
        }
    });

export default app;