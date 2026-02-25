"use client";

import { ReactNode } from 'react';
import { usePathname, useParams } from 'next/navigation';
import { UserButton } from "@/features/auth/components/user-button";
import { CreateProjectDialog } from "@/features/projects/components/create-project-dialog";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useState } from "react";
import { CreateCredentialDialog } from '@/features/credentials/components/create-credential-dialog';
import { useGetCurrentMemberByProject } from '@/features/members/api/use-get-current-member-by-project';

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

    return (
        <SidebarProvider>
            <Sidebar>
                <SidebarHeader>
                    <UserButton/>
                </SidebarHeader>

                <SidebarTrigger />

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
                {children}
            </main>

        </SidebarProvider>
    );
};

export default AuthLayout;