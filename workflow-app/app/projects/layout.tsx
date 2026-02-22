"use client";

import { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { UserButton } from "@/features/auth/components/user-button";
import { CreateProjectDialog } from "@/features/projects/components/create-project-dialog";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useState } from "react";

interface AuthLayoutProps {
    children: ReactNode;
}; // since a layout should be reusable, it becomes an interface so no override happens

const AuthLayout = ({children}: AuthLayoutProps) => {
    const pathname = usePathname();
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [_, setCreatedProject] = useState(null);

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
                  <SidebarMenuButton onClick={() => setIsDialogOpen(true)}>
                    <span>Add project</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>

      <SidebarTrigger />

      <CreateProjectDialog 
        open={isDialogOpen} 
        onOpenChange={setIsDialogOpen}
        onSuccess={(project) => setCreatedProject(project)}
      />

      <main className="flex-1">
        {children}
      </main>
      
    </SidebarProvider>
    );
};

export default AuthLayout;