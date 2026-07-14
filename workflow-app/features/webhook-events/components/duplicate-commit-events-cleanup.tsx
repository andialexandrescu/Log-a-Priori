"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackgroundProcessPanel } from "@/components/ui/background-process-panel";
import { useDedupeCommitEvents } from "@/features/webhook-events/api/use-dedupe-commit-events";

type Props = {
    projectId: string;
    userId: string;
    canRunCleanup: boolean;
    commitRecordCount: number;
    uniqueCommitCount: number;
    duplicateRecordCount: number;
};

export function DuplicateCommitEventsCleanup({ projectId, userId, canRunCleanup, commitRecordCount, uniqueCommitCount, duplicateRecordCount }: Props) {
    const dedupe = useDedupeCommitEvents(projectId, userId);

    if (duplicateRecordCount <= 0) {
        return null;
    }

    return (
        <div className="space-y-3 rounded-lg border border-purple-500/40 bg-purple-500/5 p-3">
            <BackgroundProcessPanel status="idle" title="Duplicate commit records" description={`${commitRecordCount} rows stored, ${uniqueCommitCount} unique commits, cleanup removes ${duplicateRecordCount} duplicate${duplicateRecordCount === 1 ? "" : "s"} and keeps one row per commit, it does not delete appdata files`} compact/>

            {canRunCleanup ? (
                <Button size="sm" disabled={dedupe.isPending} onClick={() => void dedupe.mutateAsync()}>
                    {dedupe.isPending ? (
                        <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            Cleaning...
                        </>
                    ) : (
                        `Remove ${duplicateRecordCount} duplicate${duplicateRecordCount === 1 ? "" : "s"}`
                    )}
                </Button>
            ) : (
                <p className="text-xs text-muted-foreground">
                    Only the project owner can run cleanup on the connected PocketBase data
                </p>
            )}
        </div>
    );
}
