import { Hono } from "hono";
import { sessionMiddleware } from "@/lib/session-middleware";

const app = new Hono()
    .get("/", sessionMiddleware, async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const projectId = c.req.param("projectId");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        if (!projectId) {
            return c.json({ error: "Project id is required" }, 400);
        }

        try {
            const project = await pb.collection("projects").getOne(projectId, {
                fields: "id,owner",
            });

            console.log(`Project found: owner=${project.owner}`);

            let hasAccess = project.owner === account.id;

            if (!hasAccess) {
                const member = await pb.collection("members").getFirstListItem(
                    `user = "${account.id}" && project = "${projectId}"`
                ).catch(() => null);
                hasAccess = !!member;
                console.log(`Member check: hasAccess=${hasAccess}`);
            }

            if (!hasAccess) {
                console.log(`Access denied for account=${account.id}`);
                return c.json({ error: "Unauthorized" }, 401);
            }

            console.log(`Querying commit_index collection for project=${projectId}`);
            const indices = await pb.collection("commit_index").getFullList({
                filter: `project="${projectId}"`,
            }); // get all commit indices for this project

            console.log(`Found ${indices.length} commit indices`);
            return c.json({ data: indices });
        } catch (error) {
            console.error("Error:", error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            return c.json({
                data: [],
                error: `Failed to fetch commit indices: ${errorMessage}`,
            }, 500);
        }
    });

export default app;
