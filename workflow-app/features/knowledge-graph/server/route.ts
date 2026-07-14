import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Hono } from "hono";
import { sessionMiddleware } from "@/lib/session-middleware";
import clusteringRouter from "./clustering-route";
import embeddingsRouter from "./embeddings-route";
import { ensureUserProjectDirectory, getDesktopSettingsFilePath, getProjectAnalysisDirectory, getProjectCommitsDirectory, getProjectDocumentationPaths, getProjectGraphFilePath } from "@desktop-shell/shared/desktop-shell-paths";
import { ProjectRole } from "@/features/project-sharing/constants";
import { resolveProjectAccess } from "@/features/project-sharing/lib/project-access";

const execFileAsync = promisify(execFile);

async function readProjectRootFromDesktopSettings(
    userId: string,
    projectId: string
): Promise<string | null> {
    try {
        const raw = await fs.readFile(getDesktopSettingsFilePath(), "utf8");
        const parsed = JSON.parse(raw) as {
            githubFilesRoot?: string;
            projectRoots?: Record<string, string>;
            users?: Record<string, { projectRoots?: Record<string, string> }>;
        };

        const userRoots = parsed.users?.[userId]?.projectRoots;
        if (userRoots?.[projectId]) {
            try {
                await fs.access(userRoots[projectId]);
                return userRoots[projectId];
            } catch {
            }
        }
        if (parsed.projectRoots?.[projectId]) {
            try {
                await fs.access(parsed.projectRoots[projectId]);
                return parsed.projectRoots[projectId];
            } catch {
            }
        }
        if (typeof parsed.githubFilesRoot === "string" && parsed.githubFilesRoot.trim()) {
            try {
                await fs.access(parsed.githubFilesRoot);
                return parsed.githubFilesRoot;
            } catch {
            }
        }
    } catch {
    }
    return null;
}

async function resolveGraphFilePath(userId: string, projectId: string): Promise<string> {
    await ensureUserProjectDirectory(userId, projectId);
    const projectGraphPath = getProjectGraphFilePath(userId, projectId);

    try {
        await fs.access(projectGraphPath);
        return projectGraphPath;
    } catch {
    }

    const rootDirectory = await readProjectRootFromDesktopSettings(userId, projectId);
    if (rootDirectory) {
        const candidate = path.join(rootDirectory, "analysis", "ts-code-graph.json");

        try {
            await fs.access(candidate);
            return candidate;
        } catch {
        }
    }

    return path.join(process.cwd(), "analysis", "ts-code-graph.json");
}

function getDocumentationScriptPath(): string {
    return path.join(process.cwd(), "scripts", "generate_dgi_documentation.py");
}

type DocumentationSeed = {
    query?: string;
    nodeIds?: string[];
    nodeNames?: string[];
};

type NormalizedDocumentationSeed = {
    query: string;
    nodeIds: string[];
    nodeNames: string[];
};

type RawPprSeedHistoryEntry = {
    id: string;
    query: string;
    nodeIds: string[];
    nodeNames: string[];
    kept: boolean;
    updatedAt: string;
};

type DocumentationDraft = {
    projectId: string;
    source: "base" | "draft";
    query: string;
    nodeIds: string[];
    nodeNames: string[];
    seeds?: NormalizedDocumentationSeed[];
    markdown: string;
    updatedAt: string;
};

async function readJsonIfExists<T>(targetPath: string): Promise<T | null> {
    try {
        const raw = await fs.readFile(targetPath, "utf8");
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

function normalizeSeedQuery(query?: string): string {
    return (query || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeSeedNodeIds(nodeIds?: string[]): string[] {
    return Array.from(new Set((nodeIds || []).map((value) => value.trim()).filter(Boolean))).sort();
}

function buildSeedKey(seed: DocumentationSeed): string {
    return `${normalizeSeedQuery(seed.query)}::${normalizeSeedNodeIds(seed.nodeIds).join("|")}`;
}

function normalizeSeed(seed: DocumentationSeed): NormalizedDocumentationSeed {
    return {
        query: (seed.query || "").trim(),
        nodeIds: normalizeSeedNodeIds(seed.nodeIds),
        nodeNames: (seed.nodeNames || []).map((value) => value.trim()).filter(Boolean),
    };
}

async function readRawPprSeedHistory(userId: string, projectId: string): Promise<RawPprSeedHistoryEntry[]> {
    const { seedHistoryJson } = getProjectDocumentationPaths(userId, projectId);
    const parsed = await readJsonIfExists<{ items?: RawPprSeedHistoryEntry[] } | RawPprSeedHistoryEntry[]>(seedHistoryJson);

    if (Array.isArray(parsed)) {
        return parsed;
    }

    const items = parsed?.items;
    if (!Array.isArray(items)) {
        return [];
    }

    return items;
}

async function saveRawPprSeedHistory(userId: string, projectId: string, items: RawPprSeedHistoryEntry[]): Promise<void> {
    const { directory, seedHistoryJson } = getProjectDocumentationPaths(userId, projectId);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(seedHistoryJson, JSON.stringify({ projectId, items, updatedAt: new Date().toISOString() }, null, 2), "utf8");
}

function sortSeedsByUpdatedAtDesc(items: RawPprSeedHistoryEntry[]): RawPprSeedHistoryEntry[] {
    return [...items].sort((a, b) => {
        const aTime = new Date(a.updatedAt || 0).getTime();
        const bTime = new Date(b.updatedAt || 0).getTime();
        return bTime - aTime;
    });
}

function buildDocumentationSeedsSection(seeds: NormalizedDocumentationSeed[]): string {
    const lines = ["## Cluster seeds"];

    if (seeds.length === 0) {
        lines.push("- No kept cluster seeds were selected.");
        return lines.join("\n");
    }

    seeds.forEach((seed, index) => {
        lines.push(`### Seed ${index + 1}`);
        lines.push(`- Original query: ${seed.query || "(empty query)"}`);
        if (seed.nodeNames.length > 0) {
            lines.push("- Node names:");
            for (const nodeName of seed.nodeNames.slice(0, 20)) {
                lines.push(`  - ${nodeName}`);
            }
        }
        if (seed.nodeIds.length > 0) {
            lines.push("- Node ids:");
            for (const nodeId of seed.nodeIds.slice(0, 20)) {
                lines.push(`  - ${nodeId}`);
            }
        }
        if (seed.nodeNames.length === 0 && seed.nodeIds.length === 0) {
            lines.push("- No cluster seed was provided.");
        }
        lines.push("");
    });

    return lines.join("\n").trimEnd();
}

async function ensureBaseDocumentation(userId: string, projectId: string): Promise<void> {
    const { baseMarkdown, baseJson } = getProjectDocumentationPaths(userId, projectId);
    try {
        await fs.access(baseMarkdown);
        await fs.access(baseJson);
        return;
    } catch {
    }

    const scriptPath = getDocumentationScriptPath();
    await execFileAsync("python", [scriptPath, "--project-id", projectId, "--user-id", userId], {
        cwd: process.cwd(),
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        env: {
            ...process.env,
            PROJECT_OWNER_USER_ID: userId,
        },
    });
}

function buildDocumentationDraft( projectId: string, baseMarkdown: string, seeds: DocumentationSeed[], baseJson?: any ): DocumentationDraft {
    const normalizedSeeds = seeds.map((seed) => normalizeSeed(seed)).filter((seed) => seed.query || seed.nodeIds.length > 0 || seed.nodeNames.length > 0);
    const primarySeed = normalizedSeeds[0] || normalizeSeed({ query: "Summarize this project at a feature level.", nodeIds: [], nodeNames: [] });
    const seedSection = buildDocumentationSeedsSection(normalizedSeeds);
    const graphSummary = baseJson?.clusters?.length
        ? `The generated DGI document currently contains ${baseJson.clusters.length} structural clusters.`
        : "No structural cluster summary was available in the base documentation.";

    return {
        projectId,
        source: "base",
        query: primarySeed.query || "Summarize this project at a feature level.",
        nodeIds: primarySeed.nodeIds,
        nodeNames: primarySeed.nodeNames,
        seeds: normalizedSeeds,
        markdown: [
            "# Project Documentation Draft",
            "",
            graphSummary,
            "",
            seedSection,
            "",
            "## Generated DGI Documentation",
            baseMarkdown.trim(),
        ].join("\n"),
        updatedAt: new Date().toISOString(),
    };
}

async function saveDocumentationDraft(userId: string, projectId: string, draft: DocumentationDraft): Promise<void> {
    const { directory, draftMarkdown, draftJson } = getProjectDocumentationPaths(userId, projectId);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(draftMarkdown, draft.markdown, "utf8");
    await fs.writeFile(draftJson, JSON.stringify(draft, null, 2), "utf8");
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

async function verifyProjectAccess(
    c: any,
    minimumRole: typeof ProjectRole.VIEWER | typeof ProjectRole.EDITOR = ProjectRole.VIEWER
): Promise<
    | { ok: true; pb: any; projectId: string; userId: string }
    | { ok: false; response: Response }
> {
    const pb = c.get("pb");
    const account = c.get("account");
    const projectId = c.req.param("projectId");

    const access = await resolveProjectAccess(pb, projectId, account?.id ?? "", minimumRole);
    if (!access.ok) {
        return {
            ok: false,
            response: c.json({ error: access.error }, access.status),
        };
    }

    await ensureUserProjectDirectory(access.userId, access.projectId);

    return { ok: true, pb, projectId: access.projectId, userId: access.userId };
}

const knowledgeGraphApp = new Hono()
    .get("/", sessionMiddleware, async (c) => {
        const access = await verifyProjectAccess(c);
        if (!access.ok) {
            return access.response;
        }

        const graphPath = await resolveGraphFilePath(access.userId, access.projectId);

        try {
            const raw = await fs.readFile(graphPath, "utf8");
            const data = JSON.parse(raw);
            const stats = await fs.stat(graphPath);

            const historyPath = path.join(getProjectAnalysisDirectory(access.userId, access.projectId), "function-history.json"); // loading function history to enrich nodes
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

        const historyPath = path.join(getProjectAnalysisDirectory(access.userId, access.projectId), "function-history.json");
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
            const graphPath = await resolveGraphFilePath(access.userId, access.projectId);
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

        const commitsRoot = getProjectCommitsDirectory(access.userId, access.projectId);
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

        const historyPath = path.join(getProjectAnalysisDirectory(access.userId, access.projectId), "function-history.json");
        
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
            const code = (err as NodeJS.ErrnoException)?.code;
            if (code === "ENOENT") {
                return c.json({ data: null, reason: "no_history" }, 200);
            }
            console.error(`Error building removed nodes graph:`, err);
            return c.json({
                data: null,
                reason: "error",
                message: "Could not build removed nodes graph",
            }, 200);
        }
    });

knowledgeGraphApp.get("/documentation", sessionMiddleware, async (c) => {
    const access = await verifyProjectAccess(c);
    if (!access.ok) {
        return access.response;
    }

    const paths = getProjectDocumentationPaths(access.userId, access.projectId);
    const savedDraft = await readJsonIfExists<DocumentationDraft>(paths.draftJson);
    if (savedDraft) {
        return c.json({
            source: "draft",
            draft: savedDraft,
        });
    }

    try {
        await fs.access(paths.baseMarkdown);
        await fs.access(paths.baseJson);
        const baseMarkdown = await fs.readFile(paths.baseMarkdown, "utf8");
        const baseJson = await readJsonIfExists(paths.baseJson);
        return c.json({
            source: "base",
            draft: buildDocumentationDraft(access.projectId, baseMarkdown, [], baseJson),
        });
    } catch {
        return c.json({
            source: "empty",
            draft: null,
        });
    }
});

knowledgeGraphApp.post("/documentation", sessionMiddleware, async (c) => {
    const access = await verifyProjectAccess(c, ProjectRole.EDITOR);
    if (!access.ok) {
        return access.response;
    }

    const body = await c.req.json().catch(() => ({})) as {
        action?: "generate" | "save";
        query?: string;
        nodeIds?: string[];
        nodeNames?: string[];
        seeds?: DocumentationSeed[];
        markdown?: string;
    };

    const action = body.action || "generate";
    const seeds = Array.isArray(body.seeds) && body.seeds.length > 0
        ? body.seeds
        : [{
            query: body.query,
            nodeIds: Array.isArray(body.nodeIds) ? body.nodeIds : [],
            nodeNames: Array.isArray(body.nodeNames) ? body.nodeNames : [],
        }];

    const paths = getProjectDocumentationPaths(access.userId, access.projectId);
    await fs.mkdir(paths.directory, { recursive: true });

    if (action === "generate") {
        await ensureBaseDocumentation(access.userId, access.projectId);
        const baseMarkdown = await fs.readFile(paths.baseMarkdown, "utf8");
        const baseJson = await readJsonIfExists(paths.baseJson);
        const draft = buildDocumentationDraft(access.projectId, baseMarkdown, seeds, baseJson);
        await saveDocumentationDraft(access.userId, access.projectId, draft);
        return c.json({
            source: "generated",
            draft,
        });
    }

    if (!body.markdown || !body.markdown.trim()) {
        return c.json({ error: "Missing markdown content" }, 400);
    }

    const normalizedSeeds = seeds.map((item) => normalizeSeed(item));
    const primarySeed = normalizedSeeds[0] || normalizeSeed({ query: "", nodeIds: [], nodeNames: [] });
    const draft: DocumentationDraft = {
        projectId: access.projectId,
        source: "draft",
        query: primarySeed.query,
        nodeIds: primarySeed.nodeIds,
        nodeNames: primarySeed.nodeNames,
        seeds: normalizedSeeds,
        markdown: body.markdown,
        updatedAt: new Date().toISOString(),
    };

    await saveDocumentationDraft(access.userId, access.projectId, draft);
    return c.json({
        source: "saved",
        draft,
    });
});

knowledgeGraphApp.get("/documentation/raw-ppr-seeds", sessionMiddleware, async (c) => {
    const access = await verifyProjectAccess(c);
    if (!access.ok) {
        return access.response;
    }

    const items = sortSeedsByUpdatedAtDesc(await readRawPprSeedHistory(access.userId, access.projectId));
    return c.json({
        items,
        projectId: access.projectId,
        updatedAt: items[0]?.updatedAt || null,
    });
});

knowledgeGraphApp.post("/documentation/raw-ppr-seeds", sessionMiddleware, async (c) => {
    const access = await verifyProjectAccess(c, ProjectRole.EDITOR);
    if (!access.ok) {
        return access.response;
    }

    const body = await c.req.json().catch(() => ({})) as {
        action?: "upsert" | "set-kept" | "remove";
        seed?: DocumentationSeed;
        id?: string;
        kept?: boolean;
    };

    const action = body.action || "upsert";
    const existingItems = await readRawPprSeedHistory(access.userId, access.projectId);

    if (action === "upsert") {
        const seed = normalizeSeed(body.seed || {});
        if (!seed.query && seed.nodeIds.length === 0 && seed.nodeNames.length === 0) {
            return c.json({ error: "Missing cluster seed" }, 400);
        }

        const key = buildSeedKey(seed);
        const index = existingItems.findIndex((item) => buildSeedKey(item) === key);
        const updatedAt = new Date().toISOString();

        if (index >= 0) {
            const current = existingItems[index];
            existingItems[index] = {
                ...current,
                query: seed.query || current.query,
                nodeIds: seed.nodeIds.length > 0 ? seed.nodeIds : current.nodeIds,
                nodeNames: seed.nodeNames.length > 0 ? seed.nodeNames : current.nodeNames,
                updatedAt,
            };
        } else {
            existingItems.unshift({
                id: randomUUID(),
                query: seed.query || "",
                nodeIds: seed.nodeIds,
                nodeNames: seed.nodeNames,
                kept: false,
                updatedAt,
            });
        }

        await saveRawPprSeedHistory(access.userId, access.projectId, sortSeedsByUpdatedAtDesc(existingItems));
        return c.json({
            items: sortSeedsByUpdatedAtDesc(existingItems),
            updatedAt,
        });
    }

    if (!body.id) {
        return c.json({ error: "Missing seed id" }, 400);
    }

    const index = existingItems.findIndex((item) => item.id === body.id);
    if (index === -1) {
        return c.json({ error: "Seed not found" }, 404);
    }

    if (action === "set-kept") {
        existingItems[index] = {
            ...existingItems[index],
            kept: Boolean(body.kept),
            updatedAt: new Date().toISOString(),
        };
        await saveRawPprSeedHistory(access.userId, access.projectId, sortSeedsByUpdatedAtDesc(existingItems));
        return c.json({
            items: sortSeedsByUpdatedAtDesc(existingItems),
        });
    }

    if (action === "remove") {
        const nextItems = existingItems.filter((item) => item.id !== body.id);
        await saveRawPprSeedHistory(access.userId, access.projectId, sortSeedsByUpdatedAtDesc(nextItems));
        return c.json({
            items: sortSeedsByUpdatedAtDesc(nextItems),
        });
    }

    return c.json({ error: "Unsupported action" }, 400);
});

knowledgeGraphApp.route("/clustering", clusteringRouter);
knowledgeGraphApp.route("/embeddings", embeddingsRouter);

export default knowledgeGraphApp;
