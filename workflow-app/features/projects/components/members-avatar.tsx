"use client";

import { Loader, Users } from "lucide-react";
import { useGetProject } from "../api/use-get-project-by-id";
import { useGetProjectMembers } from "../api/use-get-project-members";
import { Avatar, AvatarFallback, AvatarImage, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";
import { useCurrent } from "@/features/auth/api/use-current";

export const MembersAvatar = ({ projectId }: { projectId: string }) => {
    const { data: project, isLoading: projectLoading } = useGetProject(projectId);
    const { data: members, isLoading: membersLoading } = useGetProjectMembers(projectId);
    // const currentUser = useCurrent();
    
    const isLoading = projectLoading || membersLoading;

    const avatarFallback = (name?: string, email?: string) => {
        if (name) {
            return name.charAt(0).toUpperCase();
        }
        if (email) {
            return email.charAt(0).toUpperCase();
        }
        return "U";
    };

    return (
        <main className="flex-1 p-6">
            {isLoading && (
                <div className="flex items-center justify-center py-12">
                    <Loader className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
            )}

            {project && members && (
                <div>
                    <h4 className="font-medium mb-3">Members</h4>

                    <AvatarGroup>
                        {members.slice(0, 3).map((member: any) => {
                            const user = member.expand?.user;
                            if (!user) {
                                return null;
                            }
                            return (
                                <Avatar key={member.id}>
                                    <AvatarImage src={user.avatarUrl} alt={user.name} />
                                    <AvatarFallback>{avatarFallback(user.name, user.email)}</AvatarFallback>
                                </Avatar>
                            );
                        })}

                        {members.length > 3 && (
                            <AvatarGroupCount>
                                {members.length - 3}
                            </AvatarGroupCount>
                        )}
                    </AvatarGroup>
                </div>
            )}
        </main>
    );
};