"use client";

import { FolderOpen } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2Icon, AlertCircleIcon } from "lucide-react";
import { useGetCommitStorageRootDirectory } from "../api/use-get-commit-storage-root-directory";
import { useProjectRootActions } from "../hooks/use-project-root-actions";

export function KnowledgeGraphRootDirectory({ projectId, canChangeProjectRoot = true, canRunAnalysis = true }: { projectId?: string; canChangeProjectRoot?: boolean; canRunAnalysis?: boolean; }) {
    const { data: commitStorageRoot, isLoading: isLoadingCommit } =
        useGetCommitStorageRootDirectory(projectId);
    const { projectRoot, isLoading: isLoadingProject, isAnalyzing, selectFolder, canPickFolder } =
        useProjectRootActions(projectId, canRunAnalysis);

    return (
        <div className="space-y-8">
            <Card>
                <CardHeader>
                    <CardTitle className="text-2xl">Commit storage folder</CardTitle>
                    <CardDescription>
                        Project specific folder where commit shas and related files are automatically saved in your appdata folder
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-1">
                        <p className="text-sm font-medium text-muted-foreground">Commit storage location (auto managed)</p>
                        {isLoadingCommit ? (
                            <Skeleton className="h-9 w-80" />
                        ) : commitStorageRoot ? (
                            <div className="flex items-center gap-2">
                                <span className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-mono break-all">
                                    {commitStorageRoot}
                                </span>
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground italic">
                                Commits will be stored in your app data under a project specific folder
                            </p>
                        )}
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-center gap-2">
                        <CardTitle className="text-2xl">Project root directory</CardTitle>
                        {!isLoadingProject &&
                            (projectRoot ? (
                                <Badge variant="secondary">
                                    <CheckCircle2Icon className="mr-1 size-3" />
                                    Configured
                                </Badge>
                            ) : (
                                <Badge variant="secondary">
                                    <AlertCircleIcon className="mr-1 size-3" />
                                    Not set
                                </Badge>
                            ))}
                    </div>
                    <CardDescription>
                        Select the real project root on this machine (path including configuration files)
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-1">
                        <p className="text-sm font-medium text-muted-foreground">Project root folder</p>
                        {isLoadingProject ? (
                            <Skeleton className="h-9 w-80" />
                        ) : projectRoot ? (
                            <div className="flex items-center gap-2">
                                <span className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-mono break-all">
                                    {projectRoot}
                                </span>
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground italic">
                                No project root selected, set one
                            </p>
                        )}
                    </div>
                    {canChangeProjectRoot ? (
                        <>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => void selectFolder()}
                                disabled={isAnalyzing || !canPickFolder}
                            >
                                <FolderOpen className="mr-2 size-4" />
                                {isAnalyzing
                                    ? "Building knowledge graph..."
                                    : projectRoot
                                      ? "Change folder"
                                      : "Select folder"}
                            </Button>
                        </>
                    ) : null}
                    <div className="rounded-md space-y-1">
                        <p className="font-semibold text-sm">What this folder is for</p>
                        <ul className="list-disc list-inside space-y-1 text-xs text-muted-foreground">
                            <li>Your real repository root (where source and config files live)</li>
                            <li>After you pick a folder, the desktop app scans it and rebuilds <span className="font-mono">ts-code-graph.json</span> for the graph canvas</li>
                            <li>Commit storage stays automatic in appdata, you do not choose a commit folder here</li>
                        </ul>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
