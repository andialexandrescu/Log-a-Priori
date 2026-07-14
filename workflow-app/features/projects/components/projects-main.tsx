"use client";

import { Loader } from "lucide-react";
import { useGetProjects } from "../api/use-get-projects";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { useCurrent } from "@/features/auth/api/use-current";

export const ProjectsMain = () => {
    const { data: projects, isLoading } = useGetProjects();
    const { data: currentUser } = useCurrent();
    const router = useRouter();

    return (
        <main className="flex-1 p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Projects page</h1>
        </div>

        {isLoading && projects === undefined && (
          <div className="flex items-center justify-center py-12">
            <Loader className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {projects && projects.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No projects yet, create your first project
          </div>
        )}

        {projects && projects.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project) => {
              const isOwned = project.owner === currentUser?.id;
              return (
              <div key={project.id} onClick={() => router.push(`/projects/${project.id}`)} className="border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-lg">{project.name}</h3>
                  <Badge variant={isOwned ? "default" : "secondary"} className="shrink-0 text-[10px]">
                    {isOwned ? "Owner" : "Shared"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {project.description}
                </p>
              </div>
            );
            })}
          </div>
        )}
      </main>
    );
};