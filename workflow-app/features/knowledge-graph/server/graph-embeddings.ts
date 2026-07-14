import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getProjectAnalysisDirectory, getUserProjectDirectory } from "@desktop-shell/shared/desktop-shell-paths";

export type EmbeddingsProgress = {
    phase: string;
    message: string;
    current: number;
    total: number;
    updatedAt?: string;
};

export type EmbeddingsStatus = {
    ready: boolean;
    hasGraphJson: boolean;
    hasPreprocessedGraph: boolean;
    hasEmbedCache: boolean;
    embedCacheCount: number;
    progress: EmbeddingsProgress | null;
};

const GRAPH_JSON_NAME = "ts-code-graph.json";
const PROGRESS_FILE_NAME = ".embedding-progress.json";
const EMBED_CACHE_DIR = "embed_cache";

function getPreprocessScriptPath(): string {
    return path.join(process.cwd(), "scripts", "graph_preprocessing.py");
}

async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function countEmbedCacheFiles(projectDir: string): Promise<number> {
    const cacheDir = path.join(projectDir, EMBED_CACHE_DIR);
    try {
        const entries = await fs.readdir(cacheDir);
        return entries.filter((name) => name.endsWith(".npy")).length;
    } catch {
        return 0;
    }
}

async function findPreprocessedPickles(projectDir: string): Promise<string[]> {
    try {
        const entries = await fs.readdir(projectDir);
        return entries.filter((name) => name.startsWith("preprocessed-graph-") && name.endsWith(".pkl"));
    } catch {
        return [];
    }
}

async function readProgressFile(userId: string, projectId: string): Promise<EmbeddingsProgress | null> {
    const progressPath = path.join(getProjectAnalysisDirectory(userId, projectId), PROGRESS_FILE_NAME);
    try {
        const raw = await fs.readFile(progressPath, "utf8");
        const parsed = JSON.parse(raw) as EmbeddingsProgress;
        if (!parsed || typeof parsed !== "object") {
            return null;
        }
        return {
            phase: String(parsed.phase ?? ""),
            message: String(parsed.message ?? ""),
            current: Number(parsed.current ?? 0),
            total: Number(parsed.total ?? 0),
            updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : undefined,
        };
    } catch {
        return null;
    }
}

export async function readGraphEmbeddingsStatus( userId: string, projectId: string ): Promise<EmbeddingsStatus> {
    const projectDir = getUserProjectDirectory(userId, projectId);
    const graphJsonPath = path.join(getProjectAnalysisDirectory(userId, projectId), GRAPH_JSON_NAME);
    const hasGraphJson = await pathExists(graphJsonPath);
    const pickles = await findPreprocessedPickles(projectDir);
    const embedCacheCount = await countEmbedCacheFiles(projectDir);
    const progress = await readProgressFile(userId, projectId);

    return {
        ready: pickles.length > 0,
        hasGraphJson,
        hasPreprocessedGraph: pickles.length > 0,
        hasEmbedCache: embedCacheCount > 0,
        embedCacheCount,
        progress,
    };
}

export function runGraphEmbeddingsPreprocess(userId: string, projectId: string, refresh = false): { ok: boolean; error?: string; status?: EmbeddingsStatus & { pklPath?: string }; } {
    const scriptPath = getPreprocessScriptPath();
    const result = spawnSync(
        "python",
        [
            scriptPath,
            "--project-id",
            projectId,
            "--user-id",
            userId,
            ...(refresh ? ["--refresh"] : []),
        ],
        {
            encoding: "utf-8",
            cwd: path.dirname(scriptPath),
            env: {
                ...process.env,
                PROJECT_OWNER_USER_ID: userId,
            },
            maxBuffer: 20 * 1024 * 1024,
        }
    );

    const stdout = (result.stdout || "").trim();
    const stderr = (result.stderr || "").trim();

    if (result.error) {
        return { ok: false, error: result.error.message };
    }

    if (result.status !== 0) {
        return {
            ok: false,
            error: stderr || stdout || "Embedding preprocessing failed",
        };
    }

    try {
        const lastLine = stdout.split(/\r?\n/).filter(Boolean).pop() || "{}";
        const parsed = JSON.parse(lastLine) as EmbeddingsStatus & { pklPath?: string };
        return { ok: true, status: parsed };
    } catch {
        return {
            ok: true,
            status: {
                ready: true,
                hasGraphJson: true,
                hasPreprocessedGraph: true,
                hasEmbedCache: false,
                embedCacheCount: 0,
                progress: null,
            },
        };
    }
}
