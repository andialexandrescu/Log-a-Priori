"use client";

import { Loader } from "lucide-react";
import { useGetProject } from "../api/use-get-project-by-id";
import { ProjectDeletedByOwner } from "./project-deleted-by-owner";
import { ProjectRoleAccessCard } from "./project-role-access-card";

export const ProjectByIdMain = ({ projectId }: { projectId: string }) => {
    const { data, isLoading } = useGetProject(projectId);

    if (isLoading) {
        return (
            <main className="flex-1 py-6 pr-6 pl-0">
                <div className="flex items-center justify-center py-12">
                    <Loader className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            </main>
        );
    }

    if (data?.status === "deleted") {
        return (
            <ProjectDeletedByOwner
                projectName={data.deleted.projectName}
                message={data.message}
            />
        );
    }

    if (data?.status === "error" || !data || data.status !== "ok") {
        return (
            <main className="flex-1 py-6 pr-6 pl-0">
                <p className="text-sm text-muted-foreground">
                    {data?.status === "error" ? data.message : "Project not found"}
                </p>
            </main>
        );
    }

    const { project, access } = data;
    const description = (project.description as string | undefined)?.trim();

    return (
        <main className="flex-1 space-y-4 py-6 pr-6 pl-0">
            <div>
                <h1 className="text-2xl font-semibold tracking-tight">{project.name as string}</h1>
                {description ? (
                    <p className="mt-2 text-sm text-muted-foreground">{description}</p>
                ) : null}
            </div>
            <ProjectRoleAccessCard access={access} />
        </main>
    );
};
