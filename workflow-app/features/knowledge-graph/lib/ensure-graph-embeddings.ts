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

export function describeEmbeddingsPhase(progress: EmbeddingsProgress | null): { title: string; description: string; percent: number | null; } {
    if (!progress) {
        return {
            title: "Preparing code embeddings",
            description:
                "First-time setup builds UniXcoder embeddings and a preprocessed graph so cluster search and documentation can run, this usually runs once per project and may take a few minutes",
            percent: null,
        };
    }

    const { phase, message, current, total } = progress;
    const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : null;

    if (phase === "loading_model") {
        return {
            title: "Loading embedding model",
            description: message || "Loading UniXcoder (first run may download model weights)",
            percent,
        };
    }

    if (phase === "embedding") {
        return {
            title: "Generating function embeddings",
            description:
                message ||
                "Encoding each function in your knowledge graph, cached embeddings are reused on the next run",
            percent,
        };
    }

    if (phase === "building_graph") {
        return {
            title: "Building inference graph",
            description: message || "Packaging embeddings into the preprocessed graph used for search",
            percent,
        };
    }

    if (phase === "complete") {
        return {
            title: "Embeddings ready",
            description: message || "Finishing up...",
            percent: 100,
        };
    }

    if (phase === "error") {
        return {
            title: "Embedding setup failed",
            description: message || "Check the desktop shell logs and try again",
            percent: null,
        };
    }

    return {
        title: "Preparing code embeddings",
        description: message || "Working...",
        percent,
    };
}

async function fetchEmbeddingsStatus(projectId: string): Promise<EmbeddingsStatus> {
    const res = await fetch(`/api/projects/${projectId}/knowledge-graph/embeddings/status`, {
        credentials: "include",
    });
    if (!res.ok) {
        const payload = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || "Failed to read embedding status");
    }
    return res.json() as Promise<EmbeddingsStatus>;
}

export async function ensureGraphEmbeddings(
    projectId: string,
    options?: {
        onStatus?: (status: EmbeddingsStatus) => void;
        pollIntervalMs?: number;
    }
): Promise<EmbeddingsStatus> {
    const pollIntervalMs = options?.pollIntervalMs ?? 1000;
    let latest = await fetchEmbeddingsStatus(projectId);
    options?.onStatus?.(latest);

    if (latest.ready) {
        return latest;
    }

    if (!latest.hasGraphJson) {
        throw new Error("Generate the knowledge graph first before running cluster search or documentation");
    }

    const pollTimer = setInterval(async () => {
        try {
            latest = await fetchEmbeddingsStatus(projectId);
            options?.onStatus?.(latest);
        } catch {
            // keep polling until preprocess finishes
        }
    }, pollIntervalMs);

    try {
        const res = await fetch(`/api/projects/${projectId}/knowledge-graph/embeddings/preprocess`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        });
        const payload = await res.json().catch(() => null) as (EmbeddingsStatus & { error?: string }) | null;
        if (!res.ok) {
            throw new Error(payload?.error || "Embedding preprocessing failed");
        }
        latest = payload as EmbeddingsStatus;
        options?.onStatus?.(latest);
        if (!latest.ready) {
            throw new Error("Embedding preprocessing did not complete successfully");
        }
        return latest;
    } finally {
        clearInterval(pollTimer);
    }
}
