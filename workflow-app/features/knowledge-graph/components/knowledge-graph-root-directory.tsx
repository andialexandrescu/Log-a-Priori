"use client";

import { FolderOpen } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useGetRootDirectory } from "../api/use-get-root-directory";
import { useQueryClient } from "@tanstack/react-query";

export function KnowledgeGraphRootDirectory() {
    const { data: rootDirectory, isLoading } = useGetRootDirectory();
    const queryClient = useQueryClient();

    const handleChangeFolder = async () => {
        if (typeof window === "undefined" || !window.desktopControl) return;
        const selected = await window.desktopControl.selectRootDirectory();
        if (selected) {
            queryClient.setQueryData(["root-directory"], selected);
        }
    };

    return (
        <div>
            <Card>
                <CardHeader>
                    <CardTitle className="text-2xl">Knowledge graph</CardTitle>
                    <CardDescription>
                        Local folder where project files are saved on this machine
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-1">
                        <p className="text-sm font-medium text-muted-foreground">Save folder</p>
                        {isLoading ? (
                            <Skeleton className="h-9 w-80" />
                        ) : rootDirectory ? (
                            <div className="flex items-center gap-2">
                                <span className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm font-mono break-all">
                                    {rootDirectory}
                                </span>
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground italic">
                                No folder selected, set one during project creation or below
                            </p>
                        )}
                    </div>
                    <Button variant="outline" size="sm" onClick={handleChangeFolder}>
                        <FolderOpen className="mr-2 size-4" />
                        {rootDirectory ? "Change folder" : "Select folder"}
                    </Button>
                </CardContent>
            </Card>
        </div>
    );
}
