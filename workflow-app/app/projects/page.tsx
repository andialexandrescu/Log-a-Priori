'use client';

import { useState } from "react";
import { CreateProjectDialog } from "@/features/projects/components/create-project-dialog";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { DisplayProjects } from "@/features/projects/components/display-projects";
import { UserButton } from "@/features/auth/components/user-button";

const CreateProjectPage = () => {
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
      
      <DisplayProjects />
    </SidebarProvider>
  );
};

export default CreateProjectPage;