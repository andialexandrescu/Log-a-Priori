"use client";

import { Loader } from "lucide-react";
import { useGetProjects } from "../api/use-get-projects";

export const DisplayProjects = () => {
    const { data: projects, isLoading } = useGetProjects();
    
    return (
        <main className="flex-1 p-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">Projects</h1>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}

        {projects && projects.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            No projects yet, create your first project.
          </div>
        )}

        {projects && projects.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {projects.map((project: any) => (
              <div 
                key={project.id} 
                className="border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow"
              >
                <h3 className="font-semibold text-lg">{project.name}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {project.description}
                </p>
              </div>
            ))}
          </div>
        )}
      </main>
    );
};