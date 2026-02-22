"use client";

import { Loader } from "lucide-react";
import { useGetProject } from "../api/use-get-project-by-id";

export const ProjectByIdMain = ({ projectId }: { projectId: string }) => {
    const { data: project, isLoading } = useGetProject(projectId);

    return (
        <main className="flex-1 p-6">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold">Project</h1>
            </div>

            {isLoading && (
                <div className="flex items-center justify-center py-12">
                    <Loader className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}

            {project && (
                <div>
                    <h3 className="font-semibold text-lg">{project.name}</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                        {project.description}
                    </p>
                </div>
            )}
        </main>
    );
};