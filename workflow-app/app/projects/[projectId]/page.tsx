import { ProjectByIdMain } from "@/features/projects/components/project-by-id-main";
import { MembersAvatar } from "@/features/projects/components/members-avatar";
import { ProjectCreateMembersDialog } from "@/features/projects/components/project-create-members-dialog";

export default async function ProjectById({ params }: { params: { projectId: string } }) {
    const { projectId } = await params;
    return (
        <div className="flex gap-6">
            <div className="flex-1">
                <ProjectByIdMain projectId={projectId} />
            </div>
            <div className="w-64 shrink-0 space-y-4">
                <MembersAvatar projectId={projectId} />
                <ProjectCreateMembersDialog projectId={projectId}/>
            </div>
        </div>
    );
};