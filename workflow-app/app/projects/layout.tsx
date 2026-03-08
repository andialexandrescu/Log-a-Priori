"use client";

import { Fragment, ReactNode } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { UserButton } from "@/features/auth/components/user-button";
import { CreateProjectDialog } from "@/features/projects/components/create-project-dialog";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useState } from "react";
import { CreateCredentialDialog } from '@/features/credentials/components/create-credential-dialog';
import { useGetCurrentMemberByProject } from '@/features/members/api/use-get-current-member-by-project';
import { useGetProject } from '@/features/projects/api/use-get-project-by-id';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/breadcrumb';

interface AuthLayoutProps {
    children: ReactNode;
}; // since a layout should be reusable, it becomes an interface so no override happens

const AuthLayout = ({children}: AuthLayoutProps) => {
    const pathname = usePathname();
    const [isProjectDialogOpen, setIsProjectDialogOpen] = useState(false);
    const [isCredentialDialogOpen, setIsCredentialDialogOpen] = useState(false);
    const [_, setCreatedProject] = useState(null);

    // fetch the member for the current user and current project
    const params = useParams();
    const projectId = params.projectId as string | undefined;
    const { data: member, isLoading: memberLoading } = useGetCurrentMemberByProject(projectId, { enabled: !!projectId }); // only runs when projectId is enabled, meaning only when i get redirected to the /projects/:projectId endpoint (logic included in ProjectsMain)
    const { data: project } = useGetProject(projectId ?? "");

    const pathSegments = pathname.split('/').filter(Boolean);
    const breadcrumbItems = pathSegments.map((segment, index) => {
        const href = `/${pathSegments.slice(0, index + 1).join('/')}`;
        const isLast = index === pathSegments.length - 1;

        let label = segment;
        if (segment === 'projects') {
            label = 'Projects';
        } else if (segment === projectId) {
            label = project?.name ?? `Project ${segment.slice(0, 8)}`;
        } else {
            label = segment
                .split('-')
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join(' ');
        }

        return { href, isLast, label };
    });

    return (
        <SidebarProvider>
            <Sidebar>
                <SidebarHeader>
                    <UserButton/>
                </SidebarHeader>

                <SidebarContent>
                    <SidebarGroup>
                        <SidebarGroupLabel>Projects</SidebarGroupLabel>
                        <SidebarGroupContent>
                            <SidebarMenu>
                                <SidebarMenuItem>
                                    <SidebarMenuButton onClick={() => setIsProjectDialogOpen(true)}>
                                        <span>Add project</span>
                                    </SidebarMenuButton>
                                </SidebarMenuItem>
                                {projectId && member && !memberLoading && (
                                    <SidebarMenuItem>
                                        <SidebarMenuButton onClick={() => setIsCredentialDialogOpen(true)}>
                                            <span>Add credential</span>
                                        </SidebarMenuButton>
                                    </SidebarMenuItem>
                                )}
                            </SidebarMenu>
                        </SidebarGroupContent>
                    </SidebarGroup>
                </SidebarContent>
            </Sidebar>

            <CreateProjectDialog open={isProjectDialogOpen} onOpenChange={setIsProjectDialogOpen} onSuccess={(project) => setCreatedProject(project)}/>
            
            {projectId && member && (
                <CreateCredentialDialog open={isCredentialDialogOpen} onOpenChange={setIsCredentialDialogOpen} projectId={projectId} memberId={member.id} />
            )}

            <main className="flex-1">
                <div className="fixed bottom-3 left-3 z-50">
                    <SidebarTrigger />
                </div>

                <div className="border-b px-6 py-3">
                    <Breadcrumb>
                        <BreadcrumbList>
                            <BreadcrumbItem>
                                <BreadcrumbLink asChild>
                                    <Link href="/">Home</Link>
                                </BreadcrumbLink>
                            </BreadcrumbItem>

                            {breadcrumbItems.map((item) => (
                                <Fragment key={item.href}>
                                    <BreadcrumbSeparator />
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

        </SidebarProvider>
    );
};

export default AuthLayout;