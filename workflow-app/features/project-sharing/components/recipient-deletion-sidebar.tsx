"use client";

import { FolderX, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu, SidebarMenuItem, SidebarSeparator } from "@/components/ui/sidebar";
import { SHARE_SIDEBAR_CARD_CLASS, SHARE_SIDEBAR_OUTLINE_BUTTON_CLASS } from "../lib/share-sidebar-styles";
import { parseShareDeletionManifest } from "../lib/project-shares-pocketbase";
import { useDeletionNoticesActions } from "../hooks/use-deletion-notices-actions";

export function RecipientDeletionSidebar() {
    const { notices, isLoading, isDismissing, dismissingId, dismissNotice } =
        useDeletionNoticesActions();

    if (isLoading) {
        return (
            <>
                <SidebarSeparator />
                <SidebarGroup>
                    <SidebarGroupLabel className="flex items-center gap-2">
                        <FolderX className="size-4 shrink-0" />
                        <span>Removed projects</span>
                    </SidebarGroupLabel>
                    <SidebarGroupContent>
                        <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                            <Loader2 className="size-3.5 animate-spin" />
                            Checking for removed projects...
                        </div>
                    </SidebarGroupContent>
                </SidebarGroup>
            </>
        );
    }

    if (!notices?.length) {
        return null;
    }

    return (
        <>
            <SidebarSeparator />
            <SidebarGroup>
                <SidebarGroupLabel className="flex items-center gap-2">
                    <FolderX className="size-4 shrink-0" />
                    <span>Removed projects ({notices.length})</span>
                </SidebarGroupLabel>
                <SidebarGroupContent className="space-y-2">
                    <p className="px-2 text-xs leading-relaxed text-muted-foreground">
                        A project owner deleted a shared project, your local copy on this machine was
                        removed, mark as read when you&apos;re done reviewing
                    </p>

                    <SidebarMenu>
                        {notices.map((notice) => {
                            const manifest = parseShareDeletionManifest(notice.manifest);
                            const projectName =
                                notice.deleted_project_name ??
                                manifest?.projectName ??
                                "Shared project";
                            const owner =
                                notice.expand?.from_user?.email ||
                                notice.expand?.from_user?.name ||
                                notice.expand?.from_user?.username ||
                                notice.from_user;
                            const isThisDismissing = dismissingId === notice.id;

                            return (
                                <SidebarMenuItem key={notice.id}>
                                    <div className={SHARE_SIDEBAR_CARD_CLASS}>
                                        <div className="space-y-0.5 text-xs">
                                            <p className="font-medium leading-snug">{projectName}</p>
                                            <p className="text-muted-foreground">Removed by {owner}</p>
                                            {manifest?.deletedAt && (
                                                <p className="text-muted-foreground">
                                                    {new Date(manifest.deletedAt).toLocaleString()}
                                                </p>
                                            )}
                                        </div>
                                        <Button size="sm" variant="outline" className={SHARE_SIDEBAR_OUTLINE_BUTTON_CLASS} disabled={isDismissing} onClick={() => void dismissNotice(notice.id)} >
                                            {isThisDismissing ? "Marking..." : "Mark as read"}
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
