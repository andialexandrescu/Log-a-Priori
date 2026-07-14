import { Hono } from "hono";
import { sessionMiddleware } from "@/lib/session-middleware";
import { ProjectRole } from "@/features/project-sharing/constants";
import { resolveProjectAccess } from "@/features/project-sharing/lib/project-access";
import { readGraphEmbeddingsStatus, runGraphEmbeddingsPreprocess } from "./graph-embeddings";

export const embeddingsRouter = new Hono();

embeddingsRouter.use(sessionMiddleware);

embeddingsRouter.get("/status", async (c) => {
    const projectId = c.req.param("projectId");
    const pb = (c as { get: (key: string) => unknown }).get("pb");
    const account = (c as { get: (key: string) => unknown }).get("account");
    if (!account) {
        return c.json({ error: "Unauthorized" }, 401);
    }
    if (!projectId) {
        return c.json({ error: "Missing projectId" }, 400);
    }

    const access = await resolveProjectAccess(pb as never, projectId, (account as { id: string }).id, ProjectRole.VIEWER);
    if (!access.ok) {
        return c.json({ error: access.error }, access.status);
    }

    const status = await readGraphEmbeddingsStatus(access.userId, projectId);
    return c.json(status, 200);
});

embeddingsRouter.post("/preprocess", async (c) => {
    const projectId = c.req.param("projectId");
    const pb = (c as { get: (key: string) => unknown }).get("pb");
    const account = (c as { get: (key: string) => unknown }).get("account");
    if (!account) {
        return c.json({ error: "Unauthorized" }, 401);
    }
    if (!projectId) {
        return c.json({ error: "Missing projectId" }, 400);
    }

    const access = await resolveProjectAccess(pb as never, projectId, (account as { id: string }).id, ProjectRole.EDITOR);
    if (!access.ok) {
        return c.json({ error: access.error }, access.status);
    }

    const statusBefore = await readGraphEmbeddingsStatus(access.userId, projectId);
    if (!statusBefore.hasGraphJson) {
        return c.json({
            error: "Generate the knowledge graph first (ts-code-graph.json is missing)",
        }, 400);
    }

    if (statusBefore.ready) {
        return c.json(statusBefore, 200);
    }

    const body = await c.req.json().catch(() => ({})) as { refresh?: boolean };
    const result = runGraphEmbeddingsPreprocess(access.userId, projectId, Boolean(body.refresh));
    if (!result.ok) {
        return c.json({ error: result.error || "Embedding preprocessing failed" }, 500);
    }

    const status = result.status ?? (await readGraphEmbeddingsStatus(access.userId, projectId));
    return c.json(status, 200);
});

export default embeddingsRouter;
