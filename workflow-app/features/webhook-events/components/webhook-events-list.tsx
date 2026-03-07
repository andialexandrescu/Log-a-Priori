"use client";

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { useGetMemberWebhookEvents } from "../api/use-get-member-webhook-events";
import { cn } from "@/lib/utils";
import { PushEventDetails } from "./push-event-details";
import { CommitEventDetails } from "./commit-event-details";
import { fetchGetCommits } from "../../commits/api/use-get-commits";
import { toast } from "sonner";

interface Props {
    projectId: string;
    memberId: string;
}

export function WebhookEventsList({ projectId, memberId }: Props) { 
    const queryClient = useQueryClient();
    const { data: events, isLoading, isError } = useGetMemberWebhookEvents(projectId, memberId);
    const [expandedEventIds, setExpandedEventIds] = useState<string[]>([]);
    const [isRefreshingCommits, setIsRefreshingCommits] = useState(false);
    const [syncSummary, setSyncSummary] = useState<string[]>([]);

    useEffect(() => { // for retrieving the initial 'create credential' commits backfill notice
        if (typeof window === "undefined") {
            return;
        }

        const applyBackfillNotice = () => {
            const rawNotice = sessionStorage.getItem("credentialBackfillNotice");
            if (!rawNotice) {
                return;
            }

            try {
                const parsed = JSON.parse(rawNotice) as {
                    projectId?: string;
                    memberId?: string;
                    fetchedFromGithub?: number;
                };

                if (parsed.projectId === projectId && parsed.memberId === memberId) {
                    const fetched = parsed.fetchedFromGithub ?? 0;
                    setSyncSummary([
                        `Initial 'create commit' backfill action: fetched ${fetched} commits`,
                    ]);
                    sessionStorage.removeItem("credentialBackfillNotice");
                }
            } catch {
                sessionStorage.removeItem("credentialBackfillNotice");
            }
        };

        const onBackfillNotice = () => {
            applyBackfillNotice();
        };

        applyBackfillNotice();
        window.addEventListener("credential-backfill-notice", onBackfillNotice);

        return () => {
            window.removeEventListener("credential-backfill-notice", onBackfillNotice);
        };
    }, [projectId, memberId]);

    if (isLoading) {
        return <div>Loading events...</div>;
    }
    if (isError) {
        return <div className="text-red-500">Could not load events</div>;
    }
    if (!events || events.length === 0) {
        return <div>No webhook events yet</div>;
    }

    const getEventGithubTimestamp = (event: any) => { // sort github webhook events based on the date they were pushed on the repo, including both push and commit event_type entries in webhook_events
        if (event?.event_type === "commit") {
            return Date.parse(event?.payload?.commit?.author?.date || event?.payload?.author?.date || event?.payload?.timestamp || "") || 0;
        }

        if (event?.event_type === "push") {
            const headCommitTs = Date.parse(event?.payload?.head_commit?.timestamp || "") || 0;
            if (headCommitTs) {
                return headCommitTs;
            }

            const commitTimestamps = Array.isArray(event?.payload?.commits)
                ? event.payload.commits
                    .map((commit: any) => Date.parse(commit?.timestamp || "") || 0)
                    .filter(Boolean)
                : [];

            return commitTimestamps.length > 0 ? Math.max(...commitTimestamps) : 0;
        }

        return 0;
    };

    const sortedEvents = [...events].sort((a, b) => getEventGithubTimestamp(b) - getEventGithubTimestamp(a));

    const expandEventBehaviour = (eventId: string) => {
        setExpandedEventIds(prev => 
            prev.includes(eventId)
                ? prev.filter(id => id !== eventId) // remove if expanded
                : [...prev, eventId] // add if collapsed
        );
    };

    const getEventDetailsClassName = (eventId: string) =>
        cn(
            "overflow-hidden transition-all duration-300 ease-in-out",
            expandedEventIds.includes(eventId)
                ? "max-h-96 opacity-100 pt-0"
                : "max-h-0 opacity-0 -mt-4"
        );

    const refreshCommits = async () => {
        if (!events || events.length === 0) {
            return;
        }

        const repositories = Array.from(
            new Set(events.map((event: any) => event.repository).filter(Boolean))
        );

        if (repositories.length === 0) {
            toast.error("No repository found to refresh commits");
            return;
        }

        setIsRefreshingCommits(true);
        try {
            const nextSyncSummary: string[] = [];

            for (const repo of repositories) {
                const result = await fetchGetCommits({ projectId, memberId, repo });

                const backfill = result.backfill as {
                    fetchedFromGithub?: number;
                    skippedExistingOrPush?: number;
                    deletedAsPushDuplicates?: number;
                } | undefined;
                const fetched = backfill?.fetchedFromGithub ?? 0;
                const skippedExistingOrPush = backfill?.skippedExistingOrPush ?? 0;
                const deletedAsPushDuplicates = backfill?.deletedAsPushDuplicates ?? 0;
                nextSyncSummary.push(
                    `Current 'update commit' backfill action: fetched ${fetched} commits (skipped existing commits/push: ${skippedExistingOrPush})${
                        deletedAsPushDuplicates > 0
                            ? ` (deleted push-duplicate commit events: ${deletedAsPushDuplicates})`
                            : ""
                    }`
                );
            }

            setSyncSummary(nextSyncSummary);
            await queryClient.invalidateQueries({
                queryKey: ["projects", projectId, "members", memberId, "webhook-events"],
            });
            toast.success("Commits refreshed");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to refresh commits");
        } finally {
            setIsRefreshingCommits(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-bold">Recent webhook events</h2>
                    <Badge variant="outline">{events.length}</Badge>
                </div>
                <Button variant="outline" size="sm" onClick={refreshCommits} disabled={isRefreshingCommits}>
                    {isRefreshingCommits ? "Refreshing..." : "Refresh commits"}
                </Button>
            </div>
            {syncSummary.length > 0 && (
                <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                    {syncSummary.map((entry) => (
                        <div key={entry}>{entry}</div>
                    ))}
                </div>
            )}
            {sortedEvents.map((event) => (
                <Card key={event.id} className="overflow-hidden w-full"> 
                    <CardHeader className="pb-2">
                        <div className="flex items-center justify-between w-full">
                            <div className="flex items-center gap-2">
                                <Badge variant={event.event_type === "push" ? "default" : "secondary"}>
                                    {event.event_type}
                                </Badge>
                                <span className="text-sm text-muted-foreground">
                                    {formatDistanceToNow(new Date(event.created), { addSuffix: true })}
                                </span>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => expandEventBehaviour(event.id)} className="h-8 w-8 p-0 shrink-0">
                                {expandedEventIds.includes(event.id) ? (
                                    <ChevronUp className="h-4 w-4" />
                                ) : (
                                    <ChevronDown className="h-4 w-4" />
                                )}
                            </Button>
                        </div>
                        <CardTitle className="text-base font-medium">
                            {event.repository}
                        </CardTitle>
                    </CardHeader>
                    <div className={getEventDetailsClassName(event.id)}>
                        <CardContent className="p-0 pt-6 pb-6">
                            {event.event_type === "push" ? (
                                <PushEventDetails payload={event.payload} />
                            ) : event.event_type === "commit" ? (
                                <CommitEventDetails payload={event.payload} repository={event.repository} />
                            ) : (
                                <pre className="text-xs bg-muted p-4 rounded overflow-auto">
                                    {JSON.stringify(event.payload, null, 2)}
                                </pre>
                            )}
                        </CardContent>
                    </div>
                </Card>
            ))}
        </div>
    );
}