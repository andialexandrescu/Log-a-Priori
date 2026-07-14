"use client";

import { useCallback, useEffect, useMemo, useState, useRef, type MouseEvent, type PointerEvent } from "react";
import { usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, ChevronUp, Info, Search, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDistanceToNow } from "date-fns";
import { useGetUserWebhookEvents } from "../api/use-get-member-webhook-events";
import { cn } from "@/lib/utils";
import { CommitEventDetails } from "./commit-event-details";
import { fetchGetCommits } from "../../commits/api/use-get-commits";
import { toast } from "sonner";
import { useGetUserCredential } from "@/features/credentials/api/use-get-member-credential";
import { BackgroundProcessInfo, BackgroundProcessPanel } from "@/components/ui/background-process-panel";
import { commitSyncListeningInfo, commitExportReconcileInfo, commitImportInfo, commitRefreshInfo, describeCommitSyncResultSummary, describeCommitSyncResultToast, describeCommitSyncProcess, type CommitSyncMode, webhookEventsEmptyState } from "@/lib/background-process-messages";
import { isUserBrowsingProject } from "@/features/knowledge-graph/lib/graph-folder-sync-state";
import { notifyNewCommitsForProjectFolder } from "@/features/knowledge-graph/components/project-folder-sync-prompt";
import { getRepositoryFromCredential } from "@/features/webhook-events/lib/credential-repository";
import { commitShaFromPayload, countUniqueCommitShas } from "@/features/webhook-events/lib/commit-sha";
import { eventMatchesCommitSearch } from "@/features/webhook-events/lib/commit-message-search";
import { DuplicateCommitEventsCleanup } from "@/features/webhook-events/components/duplicate-commit-events-cleanup";
import { WebhookEventsPagination } from "@/features/webhook-events/components/webhook-events-pagination";
import type { WebhookEvent } from "@/features/webhook-events/schemas";

// folder pull is for recent pushes, not bulk history backfill
const FOLDER_PULL_PROMPT_MAX_NEW_COMMITS = 25;
const EVENTS_PAGE_SIZE = 20;

function eventListTitle(event: Pick<WebhookEvent, "event_type" | "repository" | "payload">): { label: string; title?: string; } {
    if (event.event_type === "ping") {
        const label = event.repository ?? "ping";
        return { label };
    }
    if (event.event_type === "commit") {
        const sha = commitShaFromPayload(event.payload);
        if (sha) {
            return { label: sha };
        }
    }
    const label = event.repository ?? event.event_type ?? "Event";
    return { label };
}

interface Props {
    projectId: string;
    userId: string;
    canRunDuplicateCleanup?: boolean;
    // called after a commit sync finishes and new commits were stored
    onCommitsSyncedWithNew?: (detail: { newCommitCount: number; repository?: string }) => void;
}

function ActionButtonWithInfo({
    label,
    activeLabel,
    isActive,
    disabled,
    onClick,
    info,
}: {
    label: string;
    activeLabel: string;
    isActive: boolean;
    disabled: boolean;
    onClick: () => void;
    info: { title: string; description: string };
}) {
    const stopAction = (event: MouseEvent | PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
    };

    return (
        <div
            className={cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "inline-flex items-stretch gap-0 overflow-hidden p-0",
                disabled && "pointer-events-none opacity-50"
            )}
        >
            <button
                type="button"
                disabled={disabled}
                onClick={onClick}
                className="inline-flex flex-1 items-center px-3 text-sm font-medium hover:bg-accent/50 disabled:pointer-events-none"
            >
                {isActive ? activeLabel : label}
            </button>
            <Tooltip>
                <TooltipTrigger
                    className="inline-flex items-center border-l border-input px-2 hover:bg-muted disabled:pointer-events-none"
                    aria-label={`Info: ${info.title}`}
                    onClick={stopAction}
                    onPointerDown={stopAction}
                    disabled={disabled}
                >
                    <Info className="size-3.5 opacity-70" />
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-sm">
                    <p>{info.description}</p>
                </TooltipContent>
            </Tooltip>
        </div>
    );
}

export function WebhookEventsList({ projectId, userId, canRunDuplicateCleanup = false, onCommitsSyncedWithNew }: Props) {
    const pathname = usePathname();
    const queryClient = useQueryClient();
    const { data: events, isLoading, isError } = useGetUserWebhookEvents(projectId, userId);
    const { data: credentialData, isLoading: isLoadingCredential } = useGetUserCredential(projectId, userId);
    const hasCredential = Boolean(credentialData?.credential);
    const inherited = credentialData?.inherited ?? false;
    const credentialRepo = getRepositoryFromCredential(credentialData?.credential);

    const safeEvents = events ?? [];
    const [messageSearch, setMessageSearch] = useState("");
    const [eventsPage, setEventsPage] = useState(1);
    const [expandedEventIds, setExpandedEventIds] = useState<string[]>([]);
    const [isRefreshingCommits, setIsRefreshingCommits] = useState(false);
    const [syncMode, setSyncMode] = useState<CommitSyncMode>("idle");
    const [syncSummary, setSyncSummary] = useState<string[]>([]);
    const [activeRepo, setActiveRepo] = useState<string | null>(null);
    const hasInitialRefreshed = useRef(false);
    const sessionScopeRef = useRef<string | null>(null);
    const knownCommitShasRef = useRef<Set<string>>(new Set());
    const commitEventsSeededRef = useRef(false);

    const commitSyncSessionKey = `${projectId}:${userId}`;

    const shouldPromptForKg = useCallback(() => {
        return pathname != null && isUserBrowsingProject(projectId);
    }, [pathname, projectId]);

    const promptKgAfterRepoSync = useCallback(
        (count: number, repository?: string) => {
            if (count <= 0 || !shouldPromptForKg()) {
                return;
            }
            notifyNewCommitsForProjectFolder(projectId, count, repository);
            onCommitsSyncedWithNew?.({ newCommitCount: count, repository });
        },
        [projectId, shouldPromptForKg, onCommitsSyncedWithNew]
    );

    const listening = commitSyncListeningInfo();

    const getEventGithubTimestamp = (event: Pick<WebhookEvent, "created" | "event_type" | "payload">) => {
        if (event?.event_type === "commit") {
            const payload = event.payload as {
                commit?: { author?: { date?: string } };
                author?: { date?: string };
                timestamp?: string;
            } | undefined;
            return (
                Date.parse(
                    payload?.commit?.author?.date ||
                        payload?.author?.date ||
                        payload?.timestamp ||
                        ""
                ) || 0
            );
        }

        return Date.parse(event?.created || "") || 0;
    };

    const sortedEvents = useMemo(
        () => [...safeEvents].sort((a, b) => getEventGithubTimestamp(b) - getEventGithubTimestamp(a)),
        [safeEvents]
    );

    const filteredEvents = useMemo(() => {
        const query = messageSearch.trim();
        if (!query) {
            return sortedEvents;
        }
        return sortedEvents.filter((event) => eventMatchesCommitSearch(event, query));
    }, [sortedEvents, messageSearch]);

    const totalPages = Math.max(1, Math.ceil(filteredEvents.length / EVENTS_PAGE_SIZE));
    const currentPage = Math.min(eventsPage, totalPages);

    const paginatedEvents = useMemo(() => {
        const start = (currentPage - 1) * EVENTS_PAGE_SIZE;
        return filteredEvents.slice(start, start + EVENTS_PAGE_SIZE);
    }, [filteredEvents, currentPage]);

    useEffect(() => {
        setEventsPage(1);
    }, [messageSearch, projectId]);

    const uniqueCommitCount = countUniqueCommitShas(safeEvents);
    const commitRecordCount = safeEvents.filter((e) => e.event_type === "commit").length;
    const duplicateCommitRecords = commitRecordCount - uniqueCommitCount;

    const expandEventBehaviour = (eventId: string) => {
        setExpandedEventIds((prev) =>
            prev.includes(eventId) ? prev.filter((id) => id !== eventId) : [...prev, eventId]
        );
    };

    const getEventDetailsClassName = (eventId: string) =>
        cn(
            "overflow-hidden transition-all duration-300 ease-in-out",
            expandedEventIds.includes(eventId)
                ? "max-h-96 opacity-100 pt-0"
                : "max-h-0 opacity-0 -mt-4"
        );

    const runCommitSync = useCallback(
        async (
            repositories: string[],
            options?: {
                silent?: boolean;
                auto?: boolean;
                isMount?: boolean;
                manual?: boolean;
                reconcile?: boolean;
                // first import from github when PocketBase had no events yet
                isFirstImport?: boolean;
            }
        ) => {
            if (repositories.length === 0) {
                if (!options?.silent) {
                    toast.error("No repository configured for this project");
                }
                return;
            }

            const mode: CommitSyncMode = options?.reconcile
                ? "reconcile"
                : options?.isMount
                  ? "mount"
                  : options?.auto
                    ? "auto"
                    : options?.manual
                      ? "manual"
                      : "idle";

            const showSyncPanel = mode !== "idle" && !(options?.silent && options?.auto);

            if (showSyncPanel) {
                setSyncMode(mode);
            }
            setIsRefreshingCommits(showSyncPanel);

            try {
                const nextSyncSummary: string[] = [];

                for (const repo of repositories) {
                    setActiveRepo(repo);
                    const result = await fetchGetCommits(
                        { projectId, userId, repo },
                        {
                            refresh: Boolean(
                                options?.isMount || options?.auto || options?.manual || options?.reconcile
                            ),
                            reconcile: Boolean(options?.reconcile),
                        }
                    );

                    if (result.refreshInfo) {
                        const info = result.refreshInfo;
                        const summary = describeCommitSyncResultSummary(info, {
                            reconcile: options?.reconcile,
                            isFirstImport: options?.isFirstImport,
                        });
                        nextSyncSummary.push(summary);

                        if (info.newCommitsFound > 0) {
                            if (
                                !options?.isMount &&
                                info.newCommitsFound > 0 &&
                                info.newCommitsFound <= FOLDER_PULL_PROMPT_MAX_NEW_COMMITS
                            ) {
                                promptKgAfterRepoSync(info.newCommitsFound, repo);
                            }
                        }

                        const shouldToast =
                            !options?.silent &&
                            !options?.auto &&
                            !options?.isMount &&
                            (options?.manual || options?.reconcile || options?.isFirstImport);

                        if (shouldToast) {
                            const toastResult = describeCommitSyncResultToast(info, {
                                reconcile: options?.reconcile,
                                isFirstImport: options?.isFirstImport,
                            });
                            if (toastResult.tone === "info") {
                                toast.info(toastResult.message);
                            } else {
                                toast.success(toastResult.message);
                            }
                        }
                    } else if (!options?.silent && (options?.manual || options?.reconcile)) {
                        const fallbackMessage = options?.reconcile
                            ? "Could not verify commit exports"
                            : "Could not refresh commits";
                        toast.error(fallbackMessage);
                    }
                }

                setSyncSummary(nextSyncSummary);
                await queryClient.invalidateQueries({
                    queryKey: ["projects", projectId, "users", userId, "webhook-events"],
                });
                await queryClient.invalidateQueries({
                    queryKey: ["projects", projectId, "users", userId, "commits"],
                });
            } catch (error) {
                if (!options?.silent && !options?.auto) {
                    toast.error(error instanceof Error ? error.message : "Failed to refresh commits");
                }
            } finally {
                setIsRefreshingCommits(false);
                setSyncMode("idle");
                setActiveRepo(null);
            }
        },
        [userId, projectId, queryClient, promptKgAfterRepoSync]
    );

    const refreshCommits = useCallback(
        async (options?: {
            silent?: boolean;
            auto?: boolean;
            isMount?: boolean;
            manual?: boolean;
            reconcile?: boolean;
            isFirstImport?: boolean;
        }) => {
            const repositories = credentialRepo ? [credentialRepo] : [];

            return runCommitSync(repositories, options);
        },
        [credentialRepo, runCommitSync]
    );

    const reconcileCommitExports = useCallback(async () => {
        return refreshCommits({ silent: false, reconcile: true });
    }, [refreshCommits]);

    useEffect(() => {
        const commitEvents = safeEvents.filter((event) => event.event_type === "commit");

        if (commitEvents.length === 0) {
            return;
        }

        for (const event of commitEvents) {
            const sha = commitShaFromPayload(event.payload);
            if (sha) {
                knownCommitShasRef.current.add(sha);
            }
        }
        commitEventsSeededRef.current = true;
    }, [safeEvents]);

    useEffect(() => {
        commitEventsSeededRef.current = false;
        knownCommitShasRef.current = new Set();
    }, [commitSyncSessionKey]);

    useEffect(() => {
        if (safeEvents.length === 0 || !hasCredential) {
            return;
        }

        const intervalId = window.setInterval(() => {
            if (isRefreshingCommits) {
                return;
            }

            void refreshCommits({ silent: true, auto: true });
        }, 60000);

        return () => {
            window.clearInterval(intervalId);
        };
    }, [hasCredential, isRefreshingCommits, refreshCommits, safeEvents.length]);

    useEffect(() => {
        if (sessionScopeRef.current !== commitSyncSessionKey) {
            sessionScopeRef.current = commitSyncSessionKey;
            hasInitialRefreshed.current = false;
        }
    }, [commitSyncSessionKey]);

    const runInitialSyncOnce = useCallback(
        (isFirstImport: boolean) => {
            if (hasInitialRefreshed.current) {
                return;
            }

            hasInitialRefreshed.current = true;

            const storageKey = `lap-commit-initial-sync:${commitSyncSessionKey}`;
            const alreadySyncedThisSession =
                typeof window !== "undefined" && sessionStorage.getItem(storageKey) === "1";

            if (alreadySyncedThisSession) {
                return;
            }

            void refreshCommits({ silent: false, isMount: true, isFirstImport })
                .then(() => {
                    try {
                        sessionStorage.setItem(storageKey, "1");
                    } catch {
                        // ignore
                    }
                })
                .catch(() => {
                    hasInitialRefreshed.current = false;
                });
        },
        [commitSyncSessionKey, refreshCommits]
    );

    // first visit with credential but no events yet, import history from github using the configured repo
    useEffect(() => {
        if (isLoadingCredential || isLoading || hasInitialRefreshed.current) {
            return;
        }
        if (!hasCredential || inherited || !credentialRepo) {
            return;
        }
        if (safeEvents.length > 0) {
            return;
        }

        runInitialSyncOnce(true);
    }, [
        isLoadingCredential,
        isLoading,
        hasCredential,
        inherited,
        credentialRepo,
        safeEvents.length,
        runInitialSyncOnce,
    ]);

    // first visit when events already exist, incremental github check
    useEffect(() => {
        if (isLoading || hasInitialRefreshed.current || safeEvents.length === 0) {
            return;
        }

        runInitialSyncOnce(false);
    }, [isLoading, safeEvents.length, runInitialSyncOnce]);

    const syncPanel = describeCommitSyncProcess({
        mode: syncMode,
        isActive: isRefreshingCommits,
        repository: activeRepo,
    });

    if (isLoading || isLoadingCredential) {
        return (
            <BackgroundProcessPanel
                status="active"
                title="Loading webhook events"
                description="Reading commit history and GitHub integration for this project"
            />
        );
    }

    if (isError) {
        return (
            <BackgroundProcessPanel
                status="error"
                title="Could not load events"
                description="Try refreshing the page or check that PocketBase is running in the desktop app"
            />
        );
    }

    if (safeEvents.length === 0) {
        const empty = webhookEventsEmptyState({ hasCredential, inherited });
        const canImportFromGitHub = hasCredential && !inherited && Boolean(credentialRepo);

        return (
            <div className="space-y-4">
                {isRefreshingCommits && syncMode !== "idle" ? (
                    <BackgroundProcessPanel status={syncPanel.status} title={syncPanel.title} description={syncPanel.description} detail={activeRepo ?? credentialRepo} />
                ) : (
                    <BackgroundProcessPanel status={canImportFromGitHub ? "idle" : "idle"} title={empty.title} description={empty.description} />
                )}

                {canImportFromGitHub && (
                    <div className="flex flex-wrap items-center gap-2">
                        <ActionButtonWithInfo
                            label={commitImportInfo().title}
                            activeLabel="Importing from GitHub..."
                            disabled={isRefreshingCommits}
                            isActive={isRefreshingCommits && syncMode === "manual"}
                            onClick={() =>
                                void refreshCommits({
                                    silent: false,
                                    manual: true,
                                    isFirstImport: true,
                                })
                            }
                            info={commitImportInfo()}
                        />
                        <ActionButtonWithInfo
                            label={commitExportReconcileInfo().title}
                            activeLabel="Repairing exports..."
                            disabled={isRefreshingCommits}
                            isActive={isRefreshingCommits && syncMode === "reconcile"}
                            onClick={() => void reconcileCommitExports()}
                            info={commitExportReconcileInfo()}
                        />
                    </div>
                )}

                {syncSummary.length > 0 && !isRefreshingCommits && (
                    <BackgroundProcessPanel status="complete" title="Last sync" description={syncSummary.join(" · ")} compact />
                )}
            </div>
        );
    }

    return (
        <div className="min-w-0 max-w-full space-y-4">
            <BackgroundProcessInfo title={listening.title} description={listening.description} />

            <DuplicateCommitEventsCleanup projectId={projectId} userId={userId} canRunCleanup={canRunDuplicateCleanup} commitRecordCount={commitRecordCount} uniqueCommitCount={uniqueCommitCount} duplicateRecordCount={duplicateCommitRecords} />

            {isRefreshingCommits && syncMode !== "idle" && (
                <BackgroundProcessPanel status={syncPanel.status} title={syncPanel.title} description={syncPanel.description} detail={activeRepo} />
            )}

            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                    <h2 className="text-2xl font-bold shrink-0">Recent webhook events</h2>
                    <Badge variant="outline" title="Unique commits by SHA">
                        {uniqueCommitCount} commit{uniqueCommitCount === 1 ? "" : "s"}
                        {duplicateCommitRecords > 0
                            ? ` (${commitRecordCount} records)`
                            : safeEvents.length > commitRecordCount
                              ? ` · ${safeEvents.length} events`
                              : ""}
                    </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <ActionButtonWithInfo
                        label={commitRefreshInfo().title}
                        activeLabel="Refreshing..."
                        disabled={isRefreshingCommits}
                        isActive={isRefreshingCommits && syncMode === "manual"}
                        onClick={() => void refreshCommits({ silent: false, manual: true })}
                        info={commitRefreshInfo()}
                    />
                    {hasCredential && credentialRepo && (
                        <ActionButtonWithInfo
                            label={commitExportReconcileInfo().title}
                            activeLabel="Repairing exports..."
                            disabled={isRefreshingCommits}
                            isActive={isRefreshingCommits && syncMode === "reconcile"}
                            onClick={() => void reconcileCommitExports()}
                            info={commitExportReconcileInfo()}
                        />
                    )}
                </div>
            </div>

            {syncSummary.length > 0 && !isRefreshingCommits && (
                <BackgroundProcessPanel status="complete" title="Last sync" description={syncSummary.join(" · ")} compact />
            )}

            <div className="relative">
                <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input variant="glass" value={messageSearch} onChange={(e) => setMessageSearch(e.target.value)} placeholder="Search by commit message or SHA..." className="pl-9 pr-9" />
                {messageSearch.length > 0 && (
                    <Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 p-0" onClick={() => setMessageSearch("")} aria-label="Clear search" >
                        <X className="size-4" />
                    </Button>
                )}
            </div>

            {messageSearch.trim().length > 0 && (
                <p className="text-sm text-muted-foreground">
                    {filteredEvents.length === 0
                        ? "No commits match your search"
                        : `${filteredEvents.length} matching commit${filteredEvents.length === 1 ? "" : "s"}`}
                </p>
            )}

            <WebhookEventsPagination page={currentPage} pageSize={EVENTS_PAGE_SIZE} totalItems={filteredEvents.length} onPageChange={setEventsPage} />

            {paginatedEvents.map((event) => {
                const title = eventListTitle(event);
                return (
                <Card key={event.id} className="min-w-0 w-full max-w-full overflow-hidden">
                    <CardHeader className="min-w-0 pb-2">
                        <div className="flex min-w-0 items-center justify-between gap-2 w-full">
                            <div className="flex min-w-0 items-center gap-2">
                                <Badge variant="secondary">{event.event_type}</Badge>
                                <span className="text-sm text-muted-foreground">
                                    fetched {formatDistanceToNow(new Date(event.created), { addSuffix: false })} ago
                                </span>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => expandEventBehaviour(event.id)} className="h-8 w-8 p-0 shrink-0" >
                                {expandedEventIds.includes(event.id) ? (
                                    <ChevronUp className="h-4 w-4" />
                                ) : (
                                    <ChevronDown className="h-4 w-4" />
                                )}
                            </Button>
                        </div>
                        <CardTitle
                            className={
                                event.event_type === "commit"
                                    ? "break-all font-mono text-sm font-medium"
                                    : "truncate text-base font-medium"
                            }
                        >
                            {title.label}
                        </CardTitle>
                    </CardHeader>
                    <div className={getEventDetailsClassName(event.id)}>
                        <CardContent className="p-0 pt-6 pb-6">
                            {event.event_type === "commit" ? (
                                <CommitEventDetails payload={event.payload} repository={event.repository ?? ""} />
                            ) : (
                                <pre className="max-w-full text-xs bg-muted p-4 rounded overflow-x-auto">
                                    {JSON.stringify(event.payload, null, 2)}
                                </pre>
                            )}
                        </CardContent>
                    </div>
                </Card>
            );
            })}

            <WebhookEventsPagination page={currentPage} pageSize={EVENTS_PAGE_SIZE} totalItems={filteredEvents.length} onPageChange={setEventsPage} />
        </div>
    );
}
