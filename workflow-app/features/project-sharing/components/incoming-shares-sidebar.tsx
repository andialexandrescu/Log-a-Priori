"use client";

import { Inbox, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarSeparator } from "@/components/ui/sidebar";
import { BackgroundProcessPanel } from "@/components/ui/background-process-panel";
import { describeProjectShareImport } from "@/lib/background-process-messages";
import { SHARE_SIDEBAR_CARD_CLASS, SHARE_SIDEBAR_OUTLINE_BUTTON_CLASS } from "../lib/share-sidebar-styles";
import { useIncomingSharesActions } from "../hooks/use-incoming-shares-actions";

export function IncomingSharesSidebar() {
    const { shares, isLoading, isAccepting, isDeclining, acceptingId, accept, decline } =
        useIncomingSharesActions();

    if (isLoading) {
        return (
            <>
                <SidebarSeparator />
                <SidebarGroup>
                    <SidebarGroupLabel className="flex items-center gap-2">
                        <Inbox className="size-4 shrink-0" />
                        <span>Pending packages</span>
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                        <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                            <Loader2 className="size-3.5 animate-spin" />
                            Checking for shared packages...
                        </div>
                    </SidebarGroupContent>
                </SidebarGroup>
            </>
        );
    }

    if (!shares?.length) {
        return null;
    }

    const importPanel = describeProjectShareImport(acceptingId !== null);

    return (
        <>
            <SidebarSeparator />
            <SidebarGroup>
                <SidebarGroupLabel className="flex items-center gap-2">
                    <Inbox className="size-4 shrink-0" />
                    <span>Pending packages ({shares.length})</span>
                </SidebarGroupLabel>
                <SidebarGroupContent className="space-y-2">
                    <p className="px-2 text-xs leading-relaxed text-muted-foreground">
                        Accept to import shared analysis, documentation, and commit data into your local
                        appdata workspace
                    </p>

                    {acceptingId && (
                        <BackgroundProcessPanel status={importPanel.status} title={importPanel.title} description={importPanel.description} compact className="mx-0" />
                    )}

                    <SidebarMenu>
                        {shares.map((share) => {
                            const projectName = share.expand?.project?.name ?? share.project;
                            const sender =
                                share.expand?.from_user?.email ||
                                share.expand?.from_user?.name ||
                                share.expand?.from_user?.username ||
                                share.from_user;
                            const isThisAccepting = acceptingId === share.id;
                            const actionsDisabled = isAccepting || isDeclining;

                            return (
                                <SidebarMenuItem key={share.id}>
                                    <div className={SHARE_SIDEBAR_CARD_CLASS}>
                                        <div className="space-y-0.5 text-xs">
                                            <p className="font-medium leading-snug">{projectName}</p>
                                            <p className="text-muted-foreground">From {sender}</p>
                                            {share.role && (
                                                <p className="text-muted-foreground capitalize">
                                                    Role: {share.role}
                                                </p>
                                            )}
                                            {share.message && (
                                                <p className="italic text-muted-foreground">
                                                    &ldquo;{share.message}&rdquo;
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <Button size="sm" className="h-7 w-full" disabled={actionsDisabled} onClick={() => void accept(share.id)}>
                                                {isThisAccepting ? "Importing..." : "Accept"}
                                            </Button>
                                            <Button size="sm" variant="outline" className={SHARE_SIDEBAR_OUTLINE_BUTTON_CLASS} disabled={actionsDisabled} onClick={() => void decline(share.id)}>
                                                Decline
                                            </Button>
                                        </div>
                                    </div>
                                </SidebarMenuItem>
                            );
                        })}
                    </SidebarMenu>
                </SidebarGroupContent>
            </SidebarGroup>
        </>
    );
}
