"use client";

import { FolderOpen } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetCommitStorageRootDirectory } from "../api/use-get-commit-storage-root-directory";
import { useGetProjectRootDirectory } from "../api/use-get-project-root-directory";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

export function KnowledgeGraphRootDirectory({ projectId }: { projectId?: string }) {
    const { data: commitStorageRoot, isLoading: isLoadingCommit } = useGetCommitStorageRootDirectory(projectId);
    const { data: projectRoot, isLoading: isLoadingProject } = useGetProjectRootDirectory(projectId);
    const queryClient = useQueryClient();
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    const handleChangeProjectRoot = async () => {
        if (typeof window === "undefined" || !window.desktopControl) return;
        const selected = await window.desktopControl.selectProjectRootDirectory(projectId);
        if (selected) {
            queryClient.setQueryData(["project-root-directory", projectId], selected);
            queryClient.setQueryData(["projects", projectId, "knowledge-graph"], null); // clear the old graph data before running analysis
            // auto trigger analysis after folder selection
            if (projectId) {
                setIsAnalyzing(true);
                try {
                    const result = await window.desktopControl.runKnowledgeGraphAnalysis(projectId);
                    if (result.ok) {
                        await queryClient.refetchQueries({ queryKey: ["projects", projectId, "knowledge-graph"], exact: true }); // refetching instead of just invalidating to ensure new data is loaded
                    }
                } finally {
                    setIsAnalyzing(false);
                }
            }
        }
    };

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
                    <CardTitle className="text-2xl">Project root directory</CardTitle>
                    <CardDescription>
                        Select the real project root (path including configuration files)
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
                    <Button variant="outline" size="sm" onClick={handleChangeProjectRoot} disabled={isAnalyzing}>
                        <FolderOpen className="mr-2 size-4" />
                        {isAnalyzing ? `${projectRoot ? "Changing" : "Selecting"} folder and analyzing...` : (projectRoot ? "Change folder" : "Select folder")}
                    </Button>
                    <div className="rounded-md">
                        <p className="font-semibold">Details about the project root:</p>
                        <ul className="list-disc list-inside space-y-1 text-xs">
                            <li>the actual directory where your repository is cloned</li>
                            <li>selecting a folder will automatically run the analysis to scan your code</li>
                        </ul>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
