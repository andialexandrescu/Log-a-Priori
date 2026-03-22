import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Hono } from "hono";
import { sessionMiddleware } from "@/lib/session-middleware";

const SETTINGS_FILE_NAME = "desktop-settings.json";

function getSettingsCandidate(): string {
    const appData = process.env.APPDATA?.trim();

    if (!appData)
    {
        return path.join(os.homedir(), "AppData", "Roaming", "log-a-priori-desktop-shell", SETTINGS_FILE_NAME);
    }
    return path.join(appData, "log-a-priori-desktop-shell", SETTINGS_FILE_NAME);
}

async function getSelectedRootDirectory(): Promise<string | null> {
    const candidate = getSettingsCandidate();

    if (!candidate) {
        return null;
    }

    try {
        const raw = await fs.readFile(candidate, "utf8");
        const parsed = JSON.parse(raw) as { githubFilesRoot?: string };

        if (typeof parsed.githubFilesRoot === "string" && parsed.githubFilesRoot.trim()) {
            return parsed.githubFilesRoot;
        }
    } catch {
    }

    return null;
}

async function resolveGraphFilePath(pb: any, projectId: string): Promise<string> {
    const fallbackPath = path.join(process.cwd(), "analysis", "ts-code-graph.json");
    const rootDirectory = await getSelectedRootDirectory();

    if (rootDirectory) {
        const candidate = path.join(rootDirectory, "analysis", "ts-code-graph.json")
        
        try {
            await fs.access(candidate);
            return candidate;
        } catch {
            return fallbackPath;
        }
    }
    
    return fallbackPath;
}

const knowledgeGraphApp = new Hono().get("/", sessionMiddleware, async (c) => {
    const pb = c.get("pb");
    const account = c.get("account");
    const projectId = c.req.param("projectId");

    if (!account) {
        return c.json({ error: "Unauthorized" }, 401);
    }

    if (!projectId) {
        return c.json({ error: "Missing projectId" }, 400);
    }

    const project = await pb.collection("projects").getOne(projectId);
    if (!project) {
        return c.json({ error: "Project not found" }, 404);
    }

    if (project.owner !== account.id) {
        try {
            await pb.collection("members").getFirstListItem(
                `project = "${projectId}" && user = "${account.id}"`
            );
        } catch {
            return c.json({ error: "Forbidden" }, 403);
        }
    }

    const graphPath = await resolveGraphFilePath(pb, projectId);

    try {
        const raw = await fs.readFile(graphPath, "utf8");
        const data = JSON.parse(raw);
        const stats = await fs.stat(graphPath);

        return c.json({
            data,
            source: {
                path: graphPath,
                updatedAt: stats.mtime.toISOString(),
            },
        });
    } catch {
        return c.json({
            data: null,
            source: {
                path: graphPath,
                updatedAt: null,
            },
            message: "Knowledge graph file not found, run kg:analyze:ts first",
        });
    }
});

export default knowledgeGraphApp;
