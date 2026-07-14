"use client";

import { useParams } from "next/navigation";
import { ProjectByIdMain } from "@/features/projects/components/project-by-id-main";
import { ProjectSharesAvatar } from "@/features/project-sharing/components/project-shares-avatar";
import { ProjectViewToggle } from "@/features/projects/components/project-view-toggle";
import { CredentialStatusContainer } from "@/features/credentials/components/credential-status-container";
import { ShareProjectDialog } from "@/features/project-sharing/components/share-project-dialog";
import { DeleteProjectDialog } from "@/features/projects/components/delete-project-dialog";
import { useGetProject } from "@/features/projects/api/use-get-project-by-id";
import { ProjectRightSidebarRule } from "@/features/projects/components/project-right-sidebar-rule";

export default function ProjectById() {
    const projectId = (useParams().projectId as string | undefined) ?? "";
    const { data } = useGetProject(projectId);

    const showWorkspace =
        data?.status === "ok" && data.access.permissions.canViewContent;

    return (
        <div className="flex min-w-0 max-w-full gap-0 overflow-x-hidden px-6 pb-6">
            <div className="min-w-0 flex-1 space-y-6 pr-6" data-project-main-workspace>
                <ProjectByIdMain projectId={projectId} />
                {showWorkspace && <ProjectViewToggle projectId={projectId} />}
            </div>
            {showWorkspace && (
                <>
                    <ProjectRightSidebarRule />
                    <aside
                        data-project-right-sidebar
                        className="w-64 shrink-0 space-y-4 pl-6 pt-8"
                    >
                    <ProjectSharesAvatar projectId={projectId} />
                    <ShareProjectDialog projectId={projectId} />
                    {data.access.permissions.canDeleteProject && (
                        <DeleteProjectDialog
                            projectId={projectId}
                            projectName={(data.project.name as string) ?? "Project"}
                        />
                    )}
                    <CredentialStatusContainer projectId={projectId} />
                    </aside>
                </>
            )}
        </div>
    );
}
