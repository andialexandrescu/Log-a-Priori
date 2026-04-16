"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { useGetMemberWebhookEvents } from "../api/use-get-member-webhook-events";
import { cn } from "@/lib/utils";
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
    const safeEvents = events ?? [];
    const [expandedEventIds, setExpandedEventIds] = useState<string[]>([]);
    const [isRefreshingCommits, setIsRefreshingCommits] = useState(false);
    const [syncSummary, setSyncSummary] = useState<string[]>([]);
    const hasInitialRefreshed = useRef(false);
    const currentMemberRef = useRef<string | null>(null);

    useEffect(() => { // for retrieving the initial 'create credential' commits backfill notice
        if (typeof window === "undefined") {
            return;
        }

        // initial backfill handling removed, refresh:true handles all backfilling now, otherwise duplication takes place
    }, [projectId, memberId]);

    const getEventGithubTimestamp = (event: any) => {
        if (event?.event_type === "commit") {
            return Date.parse(event?.payload?.commit?.author?.date || event?.payload?.author?.date || event?.payload?.timestamp || "") || 0;
        }

        return Date.parse(event?.created || "") || 0;
    };

    const sortedEvents = [...safeEvents].sort((a, b) => getEventGithubTimestamp(b) - getEventGithubTimestamp(a));

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

    const refreshCommits = useCallback(async (options?: { silent?: boolean; auto?: boolean; isMount?: boolean }) => {
        if (safeEvents.length === 0) {
            return;
        }

        const repositories = Array.from(
            new Set(safeEvents.map((event: any) => event.repository).filter(Boolean))
        );

        if (repositories.length === 0) {
            if (!options?.silent) {
                toast.error("No repository found to refresh commits");
            }
            return;
        }

        setIsRefreshingCommits(true);
        try {
            const nextSyncSummary: string[] = [];

            for (const repo of repositories) {
                const result = await fetchGetCommits({ projectId, memberId, repo }, options?.isMount === true); // using refresh=true only on initial mount, all other refreshes use refresh=false

                if (result.refreshInfo) { // checking for refreshInfo (new commits found)
                    const info = result.refreshInfo;
                    if (info.newCommitsFound > 0) {
                        nextSyncSummary.push(
                            `Found ${info.newCommitsFound} new commit${info.newCommitsFound > 1 ? 's' : ''} (${info.previousTotal} => ${info.currentTotal})`
                        );
                        if (!options?.silent && !options?.auto) {
                            toast.success(`Found ${info.newCommitsFound} new commit${info.newCommitsFound > 1 ? 's' : ''}`);
                        }
                    } else if (options?.isMount) {
                        nextSyncSummary.push(`All commits synced (${info.currentTotal} total)`);
                    }
                }
            }

            setSyncSummary(nextSyncSummary);
            await queryClient.invalidateQueries({
                queryKey: ["projects", projectId, "members", memberId, "commits"],
            });
            if (!options?.silent && !options?.isMount) {
                toast.success("Commits refreshed");
            }
        } catch (error) {
            if (!options?.silent && !options?.auto) {
                toast.error(error instanceof Error ? error.message : "Failed to refresh commits");
            }
        } finally {
            setIsRefreshingCommits(false);
        }
    }, [memberId, projectId, queryClient, safeEvents]);

    useEffect(() => {
        if (safeEvents.length === 0) {
            return;
        }

        const intervalId = window.setInterval(() => {
            if (isRefreshingCommits) {
                return;
            }

            void refreshCommits({ silent: true, auto: true });
        }, 15000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [isRefreshingCommits, refreshCommits, safeEvents]);

    useEffect(() => {
        if (currentMemberRef.current !== memberId) { // detecting when member changes and reset the refresh flag
            currentMemberRef.current = memberId;
            hasInitialRefreshed.current = false; // resetting for new member
        }
    }, [memberId]);

    useEffect(() => { // triggering initial refresh when component first mounts for this member/project
        if (safeEvents.length > 0 && !hasInitialRefreshed.current) {
            hasInitialRefreshed.current = true;
            void refreshCommits({ silent: false, isMount: true }); // // showing the refreshing state in the ui, not silent so user sees the button change
        }
    }, [safeEvents.length, memberId, refreshCommits]);

    if (isLoading) {
        return <div>Loading events...</div>;
    }
    if (isError) {
        return <div className="text-red-500">Could not load events</div>;
    }
    if (safeEvents.length === 0) {
        return <div>No webhook events yet</div>;
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-bold">Recent webhook events</h2>
                    <Badge variant="outline">{safeEvents.length}</Badge>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Auto-sync enabled</span>
                    <Button variant="outline" size="sm" onClick={() => void refreshCommits()} disabled={isRefreshingCommits}>
                        {isRefreshingCommits ? "Refreshing..." : "Refresh commits"}
                    </Button>
                </div>
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
                                <Badge variant="secondary">
                                    {event.event_type}
                                </Badge>
                                <span className="text-sm text-muted-foreground">
                                    fetched {formatDistanceToNow(new Date(event.created), { addSuffix: false })} ago
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
                            {event.event_type === "commit" ? (
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