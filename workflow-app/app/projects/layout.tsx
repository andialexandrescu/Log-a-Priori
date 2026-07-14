"use client";

import { Fragment, ReactNode } from "react";
import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Plus } from "lucide-react";
import { UserButton } from "@/features/auth/components/user-button";
import { CreateProjectDialog } from "@/features/projects/components/create-project-dialog";
import { IncomingSharesSidebar } from "@/features/project-sharing/components/incoming-shares-sidebar";
import { SenderShareUpdatesSidebar } from "@/features/project-sharing/components/sender-share-updates-sidebar";
import { RecipientDeletionSidebar } from "@/features/project-sharing/components/recipient-deletion-sidebar";
import {
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
    SidebarTrigger,
} from "@/components/ui/sidebar";
import { useState } from "react";
import { useGetProject } from "@/features/projects/api/use-get-project-by-id";
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbLink,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface ProjectsLayoutProps {
    children: ReactNode;
}

const ProjectsLayout = ({ children }: ProjectsLayoutProps) => {
    const pathname = usePathname();
    const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
    const showProjectsSidebar = pathname === "/projects";

    const params = useParams();
    const projectId = params.projectId as string | undefined;
    const { data: projectDetail } = useGetProject(projectId ?? "");

    const pathSegments = pathname.split("/").filter(Boolean);
    const breadcrumbItems = pathSegments.map((segment, index) => {
        const href = `/${pathSegments.slice(0, index + 1).join("/")}`;
        const isLast = index === pathSegments.length - 1;

        let label = segment;
        if (segment === "projects") {
            label = "Projects page";
        } else if (segment === projectId) {
            if (projectDetail?.status === "deleted") {
                label = projectDetail.deleted.projectName;
            } else if (projectDetail?.status === "ok") {
                label = (projectDetail.project.name as string) ?? `Project ${segment.slice(0, 8)}`;
            } else {
                label = `Project ${segment.slice(0, 8)}`;
            }
        } else {
            label = segment
                .split("-")
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join(" ");
        }

        return { href, isLast, label };
    });

    const mainContent = (
        <main className="min-h-svh min-w-0 flex-1 overflow-x-hidden bg-background">
            {showProjectsSidebar && (
                <div className="fixed bottom-3 left-3 z-50">
                    <SidebarTrigger />
                </div>
            )}

            <div className="border-b px-6 py-3">
                <Breadcrumb>
                    <BreadcrumbList>
                        {breadcrumbItems.map((item, index) => (
                            <Fragment key={item.href}>
                                {index > 0 && <BreadcrumbSeparator />}
                                <BreadcrumbItem>
                                    {item.isLast ? (
                                        <BreadcrumbPage>{item.label}</BreadcrumbPage>
                                    ) : (
                                        <BreadcrumbLink asChild>
                                            <Link href={item.href}>{item.label}</Link>
                                        </BreadcrumbLink>
                                    )}
                                </BreadcrumbItem>
                            </Fragment>
                        ))}
                    </BreadcrumbList>
                </Breadcrumb>
            </div>

            {children}
        </main>
    );

    if (!showProjectsSidebar) {
        return mainContent;
    }

    return (
        <SidebarProvider>
            <Sidebar>
                <SidebarHeader>
                    <UserButton />
                </SidebarHeader>

                <SidebarContent>
                    <SidebarGroup>
                        <SidebarGroupLabel>Projects</SidebarGroupLabel>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                <SidebarMenuItem>
                                    <SidebarMenuButton
                                        variant="outline"
                                        onClick={() => setIsProjectDialogOpen(true)}
                                    >
                                        <Plus />
                                        <span>Add project</span>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>

                    <IncomingSharesSidebar />
                    <RecipientDeletionSidebar />
                    <SenderShareUpdatesSidebar />
                </SidebarContent>
            </Sidebar>

            <CreateProjectDialog open={isProjectDialogOpen} onOpenChange={setIsProjectDialogOpen} />

            {mainContent}
        </SidebarProvider>
    );
};

export default ProjectsLayout;
