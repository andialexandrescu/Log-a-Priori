"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BackgroundProcessInfo, BackgroundProcessPanel } from "@/components/ui/background-process-panel";
import { useDesktopUserId } from "@/lib/use-desktop-user-id";
import { clearGraphFolderSyncState, declineFolderPull, getGraphFolderSyncState, GRAPH_FOLDER_SYNC_EVENT, highlightRerunAnalysis, markPendingFolderPull, reopenFolderPullPrompt, type GraphFolderSyncState } from "@/features/knowledge-graph/lib/graph-folder-sync-state";

const FOLDER_PULL_PROMPT_MAX_NEW_COMMITS = 25;

type Props = {
    projectId: string;
    canManageFolder: boolean;
    className?: string;
};

export function ProjectFolderSyncPrompt({ projectId, canManageFolder, className }: Props) {
    const userId = useDesktopUserId();
    const [syncState, setSyncState] = useState<GraphFolderSyncState | null>(null);
    const [isPulling, setIsPulling] = useState(false);

    const reloadState = useCallback(() => {
        const state = getGraphFolderSyncState(projectId);
        // Stale prompts from bulk backfill before dedup fix (not meaningful for git pull).
        if (state?.status === "pending_pull" && state.newCommitCount > FOLDER_PULL_PROMPT_MAX_NEW_COMMITS) {
            clearGraphFolderSyncState(projectId);
            setSyncState(null);
            return;
        }
        setSyncState(state);
    }, [projectId]);

    useEffect(() => {
        reloadState();

        const onChange = (event: Event) => {
            const detail = (event as CustomEvent<{ projectId: string }>).detail;
            if (detail?.projectId === projectId) {
                reloadState();
            }
        };

        window.addEventListener(GRAPH_FOLDER_SYNC_EVENT, onChange);
        return () => window.removeEventListener(GRAPH_FOLDER_SYNC_EVENT, onChange);
    }, [projectId, reloadState]);

    const handleAcceptPull = async () => {
        if (!userId || !window.desktopControl?.pullProjectRootLatest) {
            toast.error("Pull is only available in the desktop app");
            return;
        }

        setIsPulling(true);
        try {
            const result = await window.desktopControl.pullProjectRootLatest(userId, projectId);
            if (!result.ok) {
                toast.error(result.error ?? "Failed to pull latest changes");
                return;
            }

            clearGraphFolderSyncState(projectId);
            setSyncState(null);
            toast.success(result.message ?? "Project folder updated from GitHub");
            highlightRerunAnalysis(projectId);
        } finally {
            setIsPulling(false);
        }
    };

    const handleDecline = () => {
        declineFolderPull(projectId);
        reloadState();
    };

    const handleFindOutHow = () => {
        reopenFolderPullPrompt(projectId);
        reloadState();
    };

    if (!canManageFolder || !syncState) {
        return null;
    }

    if (syncState.status === "pending_pull" || isPulling) {
        const repo = syncState.repository;
        return (
            <div className={className}>
                <BackgroundProcessPanel
                    status="active"
                    title="Project folder may be behind GitHub"
                    description={
                        syncState.newCommitCount > 1
                            ? `GitHub reported ${syncState.newCommitCount} new commit${
                                  syncState.newCommitCount === 1 ? "" : "s"
                              } for this project, if your local project root folder is behind the remote, pull it${
                                  repo ? ` (${repo})` : ""
                              } before re-running analysis (this is not the same as total commits on GitHub or duplicate records in Recent events)`
                            : `A new commit arrived on GitHub for this project, if your local project root is behind, pull it${
                                  repo ? ` (${repo})` : ""
                              } before re-running analysis`
                    }
                    detail={isPulling ? "Running git pull..." : undefined}
                />
                <div className="flex flex-wrap gap-2 mt-2">
                    <Button size="sm" disabled={isPulling} onClick={() => void handleAcceptPull()}>
                        {isPulling ? (
                            <>
                                <Loader2 className="mr-2 size-4 animate-spin" />
                                Pulling...
                            </>
                        ) : (
                            "Pull latest into project folder"
                        )}
                    </Button>
                    <Button size="sm" variant="outline" disabled={isPulling} onClick={handleDecline}>
                        Not now
                    </Button>
                </div>
            </div>
        );
    }

    if (syncState.status === "declined_pull") {
        return (
            <div className={className}>
                <BackgroundProcessInfo
                    title="Graph may be out of date"
                    description="The knowledge graph structure does not reflect the current state of the project on GitHub, your project root folder was not updated after new commits arrived"
                />
                <Button
                    size="sm"
                    className="h-auto px-0 mt-1 text-xs"
                    onClick={handleFindOutHow}
                >
                    Find out how to sync
                </Button>
            </div>
        );
    }

    return null;
}

export function notifyNewCommitsForProjectFolder( projectId: string, newCommitCount: number, repository?: string ): void {
    markPendingFolderPull({
        projectId,
        repository,
        newCommitCount,
        detectedAt: new Date().toISOString(),
    });
}
