"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { GitCommitHorizontal, FolderOpen } from "lucide-react";
import { WebhookEventsList } from "@/features/webhook-events/components/webhook-events-list";
import { useCurrent } from "@/features/auth/api/use-current";
import { KnowledgeGraphRootDirectory } from "@/features/knowledge-graph/components/root-directory";
import { KnowledgeGraphCanvas } from "@/features/knowledge-graph/components/knowledge-graph-canvas";
import { useGetProject } from "@/features/projects/api/use-get-project-by-id";
import { ProjectFolderSyncPrompt, notifyNewCommitsForProjectFolder } from "@/features/knowledge-graph/components/project-folder-sync-prompt";
import { isUserBrowsingProject } from "@/features/knowledge-graph/lib/graph-folder-sync-state";
import { cn } from "@/lib/utils";

type View = "events" | "knowledge-graph";

interface ProjectViewToggleProps {
    projectId: string;
}

export function ProjectViewToggle({ projectId }: ProjectViewToggleProps) {
    const [view, setView] = useState<View>("events");
    const [highlightRerunOnKgTab, setHighlightRerunOnKgTab] = useState(false);
    const { data: currentUser } = useCurrent();
    const { data: projectDetail } = useGetProject(projectId);
    const permissions =
        projectDetail?.status === "ok" ? projectDetail.access.permissions : null;
    const canManageFolder = Boolean(permissions?.canRunKnowledgeGraphAnalysis);

    return (
        <div className="min-w-0 max-w-full">
            <div className="flex min-w-0 flex-col gap-2">
                <div className="flex gap-2">
                    <Button variant="ghost" size="sm"
                        className={cn(
                            "rounded-b-none",
                            view === "events" ? "bg-muted hover:bg-muted" : "bg-white hover:bg-muted/50"
                        )}
                        onClick={() => setView("events")}
                    >
                        <GitCommitHorizontal className="mr-2 size-4" />
                        Recent events
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        className={cn(
                            "rounded-b-none",
                            view === "knowledge-graph"
                                ? "bg-muted hover:bg-muted"
                                : "bg-white hover:bg-muted/50",
                            highlightRerunOnKgTab &&
                                canManageFolder &&
                                view !== "knowledge-graph" &&
                                "ring-2 ring-purple-500 ring-offset-1 bg-purple-50 animate-pulse shadow-sm"
                        )}
                        onClick={() => {
                            setView("knowledge-graph");
                            setHighlightRerunOnKgTab(false);
                        }}
                    >
                        <FolderOpen className="mr-2 size-4" />
                        Knowledge graph
                    </Button>
                </div>

                <ProjectFolderSyncPrompt
                    projectId={projectId}
                    canManageFolder={canManageFolder}
                />
            </div>

            <div
                id="knowledge-graph-shell"
                className={cn(
                    "min-w-0 max-w-full overflow-hidden rounded-b-lg bg-muted p-4",
                    view === "events" ? "rounded-tl-none rounded-tr-lg" : "rounded-t-lg"
                )}
            >
                {view === "events" ? (
                    currentUser ? (
                        <WebhookEventsList projectId={projectId} userId={currentUser.id} canRunDuplicateCleanup={Boolean(permissions?.canManageGitHubCredentials)}
                            onCommitsSyncedWithNew={
                                canManageFolder
                                    ? ({ newCommitCount, repository }) => {
                                          if (isUserBrowsingProject(projectId)) {
                                              notifyNewCommitsForProjectFolder(
                                                  projectId,
                                                  newCommitCount,
                                                  repository
                                              );
                                          }
                                      }
                                    : undefined
                            }
                        />
                    ) : (
                        <div>Loading user...</div>
                    )
                ) : (
                    <div className="space-y-4">
                        <KnowledgeGraphRootDirectory projectId={projectId} canChangeProjectRoot={permissions?.canChangeProjectRoot ?? false} canRunAnalysis={permissions?.canRunKnowledgeGraphAnalysis ?? false} />
                        <KnowledgeGraphCanvas projectId={projectId} canRunAnalysis={permissions?.canRunKnowledgeGraphAnalysis ?? false} canManageDocumentation={permissions?.canManageDocumentation ?? false} onRequestHighlightRerun={() => setHighlightRerunOnKgTab(true)} />
                    </div>
                )}
            </div>
        </div>
    );
}
