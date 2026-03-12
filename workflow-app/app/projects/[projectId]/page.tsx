import { ProjectByIdMain } from "@/features/projects/components/project-by-id-main";
import { MembersAvatar } from "@/features/members/components/members-avatar";
import { ProjectCreateMembersDialog } from "@/features/members/components/project-create-members-dialog";
import { ProjectViewToggle } from "@/features/projects/components/project-view-toggle";

export default async function ProjectById({ params }: { params: { projectId: string } }) {
    const { projectId } = await params;
    return (
        <div className="flex gap-6">
            <div className="flex-1 space-y-6">
                <ProjectByIdMain projectId={projectId} />
                <ProjectViewToggle projectId={projectId} />
            </div>
            <div className="w-64 shrink-0 space-y-4">
                <MembersAvatar projectId={projectId} />
                <ProjectCreateMembersDialog projectId={projectId}/>
            </div>
        </div>
    );
};