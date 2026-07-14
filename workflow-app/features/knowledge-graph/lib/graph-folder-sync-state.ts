export const GRAPH_FOLDER_SYNC_EVENT = "lap-graph-folder-sync-changed";
export const HIGHLIGHT_RERUN_ANALYSIS_EVENT = "lap-highlight-rerun-analysis";

export type GraphFolderSyncStatus = "pending_pull" | "declined_pull";

export type GraphFolderSyncState = {
    projectId: string;
    status: GraphFolderSyncStatus;
    repository?: string;
    newCommitCount: number;
    detectedAt: string;
};

function storageKey(projectId: string): string {
    return `lap-graph-folder-sync:${projectId}`;
}

function dispatchChange(projectId: string): void {
    window.dispatchEvent(
        new CustomEvent(GRAPH_FOLDER_SYNC_EVENT, { detail: { projectId } })
    );
}

export function getGraphFolderSyncState(projectId: string): GraphFolderSyncState | null {
    if (typeof window === "undefined") {
        return null;
    }

    try {
        const raw = localStorage.getItem(storageKey(projectId));
        if (!raw) {
            return null;
        }
        return JSON.parse(raw) as GraphFolderSyncState;
    } catch {
        return null;
    }
}

export function markPendingFolderPull(payload: Omit<GraphFolderSyncState, "status">): void {
    if (typeof window === "undefined") {
        return;
    }

    const state: GraphFolderSyncState = {
        ...payload,
        status: "pending_pull",
    };

    try {
        localStorage.setItem(storageKey(payload.projectId), JSON.stringify(state));
    } catch {
    }

    dispatchChange(payload.projectId);
}

export function declineFolderPull(projectId: string): void {
    const existing = getGraphFolderSyncState(projectId);
    if (!existing) {
        return;
    }

    const state: GraphFolderSyncState = {
        ...existing,
        status: "declined_pull",
    };

    try {
        localStorage.setItem(storageKey(projectId), JSON.stringify(state));
    } catch {
    }

    dispatchChange(projectId);
}

export function reopenFolderPullPrompt(projectId: string): void {
    const existing = getGraphFolderSyncState(projectId);
    if (!existing || existing.status !== "declined_pull") {
        return;
    }

    const state: GraphFolderSyncState = {
        ...existing,
        status: "pending_pull",
    };

    try {
        localStorage.setItem(storageKey(projectId), JSON.stringify(state));
    } catch {
    }

    dispatchChange(projectId);
}

export function clearGraphFolderSyncState(projectId: string): void {
    if (typeof window === "undefined") {
        return;
    }

    try {
        localStorage.removeItem(storageKey(projectId));
    } catch {
    }

    dispatchChange(projectId);
}

export function highlightRerunAnalysis(projectId: string): void {
    if (typeof window === "undefined") {
        return;
    }

    window.dispatchEvent(
        new CustomEvent(HIGHLIGHT_RERUN_ANALYSIS_EVENT, { detail: { projectId } })
    );
}

export type NewCommitsKgPrompt = {
    projectId: string;
    repository?: string;
    newCommitCount: number;
    detectedAt: string;
};

export function markNewCommitsNeedKgAnalysis(payload: NewCommitsKgPrompt): void {
    markPendingFolderPull(payload);
}

export function getNewCommitsKgPrompt(projectId: string): NewCommitsKgPrompt | null {
    const state = getGraphFolderSyncState(projectId);
    if (!state) {
        return null;
    }
    return {
        projectId: state.projectId,
        repository: state.repository,
        newCommitCount: state.newCommitCount,
        detectedAt: state.detectedAt,
    };
}

export function clearNewCommitsKgPrompt(projectId: string): void {
    clearGraphFolderSyncState(projectId);
}

export function isUserBrowsingProject(projectId: string): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    if (document.visibilityState !== "visible") {
        return false;
    }

    const pathname = window.location.pathname;
    const prefix = `/projects/${projectId}`;
    return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
