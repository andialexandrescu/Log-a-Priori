"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useGetProjectRootDirectory } from "../api/use-get-project-root-directory";
import { useDesktopUserId } from "@/lib/use-desktop-user-id";
import { runProjectKnowledgeGraphAnalysis } from "@/features/knowledge-graph/lib/run-knowledge-graph-analysis";
import { useKnowledgeGraphAnalysisStatus } from "@/features/knowledge-graph/hooks/use-knowledge-graph-analysis-status";

export function useProjectRootActions(projectId: string | undefined, canRunAnalysis: boolean) {
    const userId = useDesktopUserId();
    const queryClient = useQueryClient();
    const { data: projectRoot, isLoading } = useGetProjectRootDirectory(projectId);
    const {
        isAnalyzing,
        analysisLog,
        setAnalysisLog,
        setAnalysisPhase,
    } = useKnowledgeGraphAnalysisStatus(projectId);

    const selectFolder = async () => {
        if (typeof window === "undefined" || !window.desktopControl || !userId || isAnalyzing) {
            return;
        }

        const selected = await window.desktopControl.selectProjectRootDirectory(userId, projectId);
        if (!selected) {
            return;
        }

        queryClient.setQueryData(["project-root-directory", userId, projectId], selected);

        if (!canRunAnalysis || !projectId) {
            return;
        }

        queryClient.setQueryData(["projects", projectId, "knowledge-graph"], null);
        setAnalysisPhase("scanning");
        setAnalysisLog(null);
        await runProjectKnowledgeGraphAnalysis(queryClient, userId, projectId, {
            onProgress: ({ message, error }) => {
                setAnalysisLog(message);
                if (error) {
                    setAnalysisPhase("error");
                }
            },
        });
    };

    return {
        projectRoot,
        isLoading,
        isAnalyzing,
        analysisLog,
        selectFolder,
        canPickFolder: Boolean(userId),
    };
}
