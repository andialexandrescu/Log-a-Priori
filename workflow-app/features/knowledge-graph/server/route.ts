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
    try {
        const projectAppDataPath = getProjectAppdataPath(projectId); // project specific appdata folder
        await fs.access(projectAppDataPath);
        return projectAppDataPath;
    } catch {
    }

    const rootDirectory = await getSelectedRootDirectory(); // selected root directory from desktop shell settings
    if (rootDirectory) {
        const candidate = path.join(rootDirectory, "analysis", "ts-code-graph.json")
        
        try {
            await fs.access(candidate);
            return candidate;
        } catch {
        }
    }
    
    return path.join(process.cwd(), "analysis", "ts-code-graph.json");
}

function getDesktopShellAppdataPath(projectId: string): string {
    const appData = process.env.APPDATA?.trim();
    const baseDir = appData 
        ? path.join(appData, "log-a-priori-desktop-shell", projectId)
        : path.join(os.homedir(), "AppData", "Roaming", "log-a-priori-desktop-shell", projectId);
    return baseDir;
}

function getProjectAnalysisDirectory(projectId: string): string {
    const baseDir = getDesktopShellAppdataPath(projectId);
    return path.join(baseDir, "analysis");
}

function getProjectAppdataPath(projectId: string): string {
    const baseDir = getDesktopShellAppdataPath(projectId);
    return path.join(baseDir, "analysis", "ts-code-graph.json");
}

function getProjectCommitsDirectory(projectId: string): string {
    const baseDir = getDesktopShellAppdataPath(projectId);
    return path.join(baseDir, "commits");
}

function normalizeRelativePath(filePath: string): string | null {
    const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
    if (!normalized) {
        return null;
    }

    if (path.isAbsolute(normalized)) {
        return null;
    }

    const segments = normalized.split("/");
    if (segments.some((segment) => !segment || segment === "..")) {
        return null;
    }

    return normalized;
}

async function searchForCommitDirectory(rootDirectory: string, sha: string): Promise<string | null> {
    const queue = [rootDirectory];

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
            continue;
        }

        let entries: Array<{ name: string; isDirectory: () => boolean }> = [];
        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const fullPath = path.join(current, entry.name);
            if (entry.name === sha) {
                return fullPath;
            }

            queue.push(fullPath);
        }
    }

    return null;
}

async function verifyProjectAccess(c: any): Promise< | { ok: true; pb: any; projectId: string } | { ok: false; response: Response } > {
    const pb = c.get("pb");
    const account = c.get("account");
    const projectId = c.req.param("projectId");

    if (!account) {
        return { ok: false, response: c.json({ error: "Unauthorized" }, 401) };
    }

    if (!projectId) {
        return { ok: false, response: c.json({ error: "Missing projectId" }, 400) };
    }

    const project = await pb.collection("projects").getOne(projectId);
    if (!project) {
        return { ok: false, response: c.json({ error: "Project not found" }, 404) };
    }

    if (project.owner !== account.id) {
        try {
            await pb.collection("members").getFirstListItem(
                `project = "${projectId}" && user = "${account.id}"`
            );
        } catch {
            return { ok: false, response: c.json({ error: "Forbidden" }, 403) };
        }
    }

    return { ok: true, pb, projectId };
}

const knowledgeGraphApp = new Hono()
    .get("/", sessionMiddleware, async (c) => {
        const access = await verifyProjectAccess(c);
        if (!access.ok) {
            return access.response;
        }

        const graphPath = await resolveGraphFilePath(access.pb, access.projectId);

        try {
            const raw = await fs.readFile(graphPath, "utf8");
            const data = JSON.parse(raw);
            const stats = await fs.stat(graphPath);

            const historyPath = path.join(getProjectAnalysisDirectory(access.projectId), "function-history.json"); // loading function history to enrich nodes
            let historyMap: Map<string, any[]> = new Map();
            try {
                const historyRaw = await fs.readFile(historyPath, "utf8");
                const historyObject = JSON.parse(historyRaw) as Record<string, any[]>;
                
                for (const [key, entries] of Object.entries(historyObject)) {
                    const sorted = [...entries].sort((a, b) => {
                        const tsA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                        const tsB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                        return tsB - tsA;
                    }); // sorting entries descending by timestamp (newest first)
                    historyMap.set(key, sorted);
                }
                console.log(`Loaded function history: ${historyMap.size} keys`);
            } catch (err) {
                console.log(`No function history found at ${historyPath}: ${(err as Error).message}`);
            }

            if (data.graph?.nodes && Array.isArray(data.graph.nodes)) {
                let enrichedCount = 0;
                data.graph.nodes = data.graph.nodes.map((node: any) => {
                    const key = `${node.repoRelativePath || node.file}::${node.simpleName}::${node.kind}`;
                    const history = historyMap.get(key) || [];
                    if (history.length > 0) enrichedCount++;
                    return { ...node, commitHistory: history }; // enriching graph nodes
                });
                console.log(`[Knowledge Graph] Enriched ${enrichedCount}/${data.graph.nodes.length} graph nodes with commit history`);
            }

            if (data.visualization?.functionNodes && Array.isArray(data.visualization.functionNodes)) {
                let vizEnrichedCount = 0;
                data.visualization.functionNodes = data.visualization.functionNodes.map((vizNode: any) => {
                    const normalizedFile = vizNode.file.replace(/\\/g, '/').replace(/^\/+/, '');
                    const kind = vizNode.kind;
                    if (!kind) {
                        console.warn(`vizNode missing kind: ${vizNode.file}::${vizNode.name}`);
                        return { ...vizNode, commitHistory: [] };
                    }
                    const key = `${normalizedFile}::${vizNode.name}::${kind}`;
                    const history = historyMap.get(key) || [];
                    if (history.length > 0) vizEnrichedCount++;
                    return { ...vizNode, commitHistory: history }; // the same for visualization nodes
                });
                console.log(`Enriched ${vizEnrichedCount}/ ${data.visualization.functionNodes.length} visualization nodes with commit history`);
            }

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
                message: "Knowledge graph file not found, run the AST analyzer first by selecting/ changing the project root folder or by clicking on the reload symbol button situated in the knowledge graph canvas",
            });
        }
    })
    .get("/function-history", sessionMiddleware, async (c) => {
        const access = await verifyProjectAccess(c);
        if (!access.ok) {
            return access.response;
        }

        const file = c.req.query("file") || "";
        const simpleName = c.req.query("simpleName") || "";
        const kind = c.req.query("kind") || "";

        if (!file || !simpleName || !kind) {
            return c.json({ error: "Missing required query params: file, simpleName, kind" }, 400);
        }

        const normalizedFile = normalizeRelativePath(file);
        if (!normalizedFile) {
            return c.json({ error: "Invalid file path" }, 400);
        }

        const historyPath = path.join(getProjectAnalysisDirectory(access.projectId), "function-history.json");
        try {
            const raw = await fs.readFile(historyPath, "utf8");
            const historyObject = JSON.parse(raw) as Record<string, unknown[]>;
            const key = `${normalizedFile}::${simpleName}::${kind}`;
            const history = Array.isArray(historyObject[key]) ? historyObject[key] : [];

            return c.json({
                data: history,
                key,
                source: {
                    path: historyPath,
                },
            });
        } catch {
            return c.json({
                data: [],
                key: `${normalizedFile}::${simpleName}::${kind}`,
                source: {
                    path: historyPath,
                },
                message: "Function history not found, run the AST analyzer first by selecting/ changing the project root folder or by clicking on the reload symbol button situated in the knowledge graph canvas",
            });
        }
    })
    .get("/function-source", sessionMiddleware, async (c) => {
        const access = await verifyProjectAccess(c);
        if (!access.ok) {
            return access.response;
        }

        const sha = c.req.query("sha") || "";
        const file = c.req.query("file") || "";
        const startLineRaw = c.req.query("startLine") || "";
        const endLineRaw = c.req.query("endLine") || "";

        if (!sha || !file) {
            return c.json({ error: "Missing required query params: sha, file" }, 400);
        }

        const normalizedFile = normalizeRelativePath(file);
        if (!normalizedFile) {
            return c.json({ error: "Invalid file path" }, 400);
        }

        const startLine = Number.parseInt(startLineRaw, 10);
        const endLine = Number.parseInt(endLineRaw, 10);

        if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || startLine <= 0 || endLine < startLine) {
            return c.json({ error: "Invalid line range" }, 400);
        }

        if (sha === "current") { // current sha refers to functions not yet having a history because they haven't been pushed yet to a commit
            const graphPath = await resolveGraphFilePath(access.pb, access.projectId);
            try {
                const graphRaw = await fs.readFile(graphPath, "utf8");
                const graphData = JSON.parse(graphRaw);
                const projectRoot = graphData.input?.root;
                if (!projectRoot) {
                    return c.json({ data: null, message: "Project root not found in graph file" });
                }
                const fullPath = path.join(projectRoot, normalizedFile);
                try {
                    await fs.access(fullPath);
                    const content = await fs.readFile(fullPath, "utf8");
                    const lines = content.split("\n");
                    const sourceCode = lines.slice(startLine - 1, endLine).join("\n");
                    return c.json({
                        data: {
                            sha: "current",
                            file: normalizedFile,
                            operation: "current",
                            startLine,
                            endLine,
                            sourceCode,
                        },
                    });
                } catch {
                    return c.json({ data: null, message: "File not found in current project" });
                }
            } catch (err) {
                return c.json({ data: null, message: "Failed to load project root" });
            }
        }

        const commitsRoot = getProjectCommitsDirectory(access.projectId);
        const commitDirectory = await searchForCommitDirectory(commitsRoot, sha);

        if (!commitDirectory) {
            return c.json({
                data: null,
                message: "Commit not found",
            });
        }

        const operationFolders = ["added", "modified", "removed"];
        for (const operation of operationFolders) {
            const fullPath = path.join(commitDirectory, operation, normalizedFile);
            try {
                await fs.access(fullPath);
                const content = await fs.readFile(fullPath, "utf8");
                const lines = content.split("\n");
                const sourceCode = lines.slice(startLine - 1, endLine).join("\n");

                return c.json({
                    data: {
                        sha,
                        file: normalizedFile,
                        operation,
                        startLine,
                        endLine,
                        sourceCode,
                    },
                });
            } catch {
            }
        }

        return c.json({
            data: null,
            message: "File not found in commit operation folders",
        });
    })
    .get("/removed-graph", sessionMiddleware, async (c) => {
        const access = await verifyProjectAccess(c);
        if (!access.ok) {
            return access.response;
        }

        const historyPath = path.join(getProjectAnalysisDirectory(access.projectId), "function-history.json");
        
        try {
            const raw = await fs.readFile(historyPath, "utf8");
            const historyObject = JSON.parse(raw) as Record<string, any[]>;

            let removedCount = 0;
            for (const [key, entries] of Object.entries(historyObject)) {
                const sorted = [...entries].sort((a, b) => {
                    const tsA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                    const tsB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                    return tsB - tsA;
                });
                const latest = sorted[0];
                if (latest?.changeType === "removed") {
                    removedCount++;
                    // console.log(`${key}: removal sha ${latest.sha}`);
                }
            }
            
            const removedNodes: any[] = [];
            const removedKeys: Set<string> = new Set();
            
            for (const [key, entries] of Object.entries(historyObject)) {
                const latestEntry = entries.sort((a, b) => {
                    const tsA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
                    const tsB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
                    return tsB - tsA;
                })[0];
                
                if (latestEntry?.changeType === "removed") { // collecting all functions that have a 'removed' entry
                    const firstEntry = entries[0];
                    removedNodes.push({
                        id: `removed:${key}`,
                        name: firstEntry.simpleName,
                        simpleName: firstEntry.simpleName,
                        kind: firstEntry.kind,
                        file: firstEntry.file,
                        repoRelativePath: firstEntry.file,
                        commitHistory: entries,
                        isRemoved: true,
                        startLine: latestEntry.boundaries?.startLine,
                        endLine: latestEntry.boundaries?.endLine,
                        removalSha: latestEntry.sha,
                    });
                    removedKeys.add(key);
                }
            }
            
            console.log(`Found ${removedNodes.length} removed functions`);
            
            const visualization = { // building visualization structure similar to ts-code-graph
                functionNodes: removedNodes.map(node => ({
                    key: node.id,
                    name: node.name,
                    simpleName: node.simpleName,
                    kind: node.kind,
                    file: node.file,
                    line: node.startLine || 0,
                    commitHistory: node.commitHistory,
                    isRemoved: true,
                })),
                edges: {
                    calls: {
                        inFile: [],
                        crossFile: [],
                    },
                },
                components: removedNodes.length > 0 ? [removedNodes.map(n => n.id)] : [],
            };
            
            return c.json({
                data: {
                    graph: {
                        nodes: removedNodes,
                        edges: [],
                    },
                    visualization,
                    summary: {
                        functions: removedNodes.length,
                        filesAnalyzed: 0,
                        totalEdges: 0,
                    },
                },
                source: {
                    path: historyPath,
                    updatedAt: new Date().toISOString(),
                },
            });
        } catch (err) {
            console.error(`Error: ${err}`);
            return c.json({
                data: null,
                message: "Could not build removed nodes graph",
            });
        }
    });

export default knowledgeGraphApp;
