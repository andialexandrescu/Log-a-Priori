import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export const KG_ANALYSIS_STARTED_EVENT = "kg-analysis-started";
export const KG_ANALYSIS_ENDED_EVENT = "kg-analysis-ended";

function analysisStorageKey(projectId: string): string {
    return `kg-analysis-in-flight:${projectId}`;
}

function dispatchKnowledgeGraphAnalysisStarted(projectId: string) {
    if (typeof window === "undefined") {
        return;
    }
    window.dispatchEvent(
        new CustomEvent(KG_ANALYSIS_STARTED_EVENT, { detail: { projectId } })
    );
}

function dispatchKnowledgeGraphAnalysisEnded(projectId: string) {
    if (typeof window === "undefined") {
        return;
    }
    window.dispatchEvent(
        new CustomEvent(KG_ANALYSIS_ENDED_EVENT, { detail: { projectId } })
    );
}

export function isKnowledgeGraphAnalysisInFlight(projectId: string): boolean {
    if (typeof window === "undefined") {
        return false;
    }
    return sessionStorage.getItem(analysisStorageKey(projectId)) === "1";
}

export async function runProjectKnowledgeGraphAnalysis( queryClient: QueryClient, userId: string, projectId: string,
    options?: {
        showToast?: boolean;
        onProgress?: (data: { message: string; error?: boolean }) => void;
    }
): Promise<boolean> {
    if (typeof window === "undefined" || !window.desktopControl) {
        return false;
    }

    const showToast = options?.showToast ?? false;
    const toastId = showToast
        ? toast.loading("Analyzing project code for the knowledge graph...")
        : undefined;

    sessionStorage.setItem(analysisStorageKey(projectId), "1");
    dispatchKnowledgeGraphAnalysisStarted(projectId);

    const unsubscribe = window.desktopControl.onKnowledgeGraphAnalysisProgress?.((data) => {
        options?.onProgress?.(data);
    });

    try {
        const result = await window.desktopControl.runKnowledgeGraphAnalysis(userId, projectId);
        if (result.ok) {
            await queryClient.invalidateQueries({
                queryKey: ["projects", projectId, "knowledge-graph"],
                exact: true,
            });
            if (toastId) {
                toast.success("Knowledge graph generated", { id: toastId });
            }
            return true;
        }

        if (toastId) {
            toast.error(result.error ?? "Knowledge graph analysis failed", { id: toastId });
        }
        return false;
    } catch {
        if (toastId) {
            toast.error("Knowledge graph analysis failed", { id: toastId });
        }
        return false;
    } finally {
        unsubscribe?.();
        sessionStorage.removeItem(analysisStorageKey(projectId));
        dispatchKnowledgeGraphAnalysisEnded(projectId);
    }
}
