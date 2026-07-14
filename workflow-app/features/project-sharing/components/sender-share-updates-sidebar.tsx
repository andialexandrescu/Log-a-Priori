"use client";

import { Bell, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarSeparator } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { SHARE_SIDEBAR_CARD_CLASS, SHARE_SIDEBAR_OUTLINE_BUTTON_CLASS } from "../lib/share-sidebar-styles";
import { useSenderShareUpdatesActions } from "../hooks/use-sender-share-updates-actions";
import { ProjectShareStatus } from "../constants";

function shareResponseLabel(status?: string) {
    if (status === ProjectShareStatus.ACCEPTED) {
        return { text: "Accepted", className: "text-emerald-700" };
    }
    if (status === ProjectShareStatus.DECLINED) {
        return { text: "Declined", className: "text-destructive" };
    }
    return { text: status ?? "Updated", className: "text-muted-foreground" };
}

export function SenderShareUpdatesSidebar() {
    const { updates, isLoading, isMarkingRead, markingId, dismiss } = useSenderShareUpdatesActions();

    if (isLoading) {
        return (
            <>
                <SidebarSeparator />
                <SidebarGroup>
                    <SidebarGroupLabel className="flex items-center gap-2">
                        <Bell className="size-4 shrink-0" />
                        <span>Share responses</span>
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                        <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                            <Loader2 className="size-3.5 animate-spin" />
                            Checking for package responses...
                        </div>
                    </SidebarGroupContent>
                </SidebarGroup>
            </>
        );
    }

    if (!updates?.length) {
        return null;
    }

    return (
        <>
            <SidebarSeparator />
            <SidebarGroup>
                <SidebarGroupLabel className="flex items-center gap-2">
                    <Bell className="size-4 shrink-0" />
                    <span>Share responses ({updates.length})</span>
                </SidebarGroupLabel>
                <SidebarGroupContent className="space-y-2">
                    <p className="px-2 text-xs leading-relaxed text-muted-foreground">
                        See whether recipients accepted or declined packages you sent, mark as read when
                        you&apos;re done reviewing
                    </p>

                    <SidebarMenu>
                        {updates.map((share) => {
                            const projectName = share.expand?.project?.name ?? share.project;
                            const recipient =
                                share.expand?.to_user?.email ||
                                share.expand?.to_user?.name ||
                                share.expand?.to_user?.username ||
                                share.to_user;
                            const response = shareResponseLabel(share.status);
                            const isThisMarking = markingId === share.id;

                            return (
                                <SidebarMenuItem key={share.id}>
                                    <div className={SHARE_SIDEBAR_CARD_CLASS}>
                                        <div className="space-y-0.5 text-xs">
                                            <p className="font-medium leading-snug">{projectName}</p>
                                            <p className="text-muted-foreground">To {recipient}</p>
                                            <p className={cn("font-medium capitalize", response.className)}>
                                                {response.text}
                                            </p>
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
                                        <Button size="sm" variant="outline" className={SHARE_SIDEBAR_OUTLINE_BUTTON_CLASS} disabled={isMarkingRead} onClick={() => void dismiss(share.id)} >
                                            {isThisMarking ? "Marking..." : "Mark as read"}
                                        </Button>
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
