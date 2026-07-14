"use client";

import { Loader, Users } from "lucide-react";
import { useGetProjectShares } from "../api/use-get-project-shares";
import { Avatar, AvatarFallback, AvatarImage, AvatarGroup, AvatarGroupCount } from "@/components/ui/avatar";

type AccessUser = {
    id: string;
    name?: string;
    email?: string;
    username?: string;
    avatar?: string;
    role?: string;
    isOwner?: boolean;
};

export const ProjectSharesAvatar = ({ projectId }: { projectId: string }) => {
    const { data: users, isLoading } = useGetProjectShares(projectId);

    const avatarFallback = (name?: string, email?: string) => {
        if (name) return name.charAt(0).toUpperCase();
        if (email) return email.charAt(0).toUpperCase();
        return "U";
    };

    const userList = (Array.isArray(users) ? users : []) as AccessUser[];

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-4">
                <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (userList.length === 0) {
        return null;
    }

    return (
        <div className="rounded-lg border p-3">
            <h4 className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Users className="size-4" />
                People with access
            </h4>

            <AvatarGroup className="mb-3">
                {userList.slice(0, 4).map((user) => (
                    <Avatar key={user.id} title={user.email || user.name}>
                        <AvatarImage src={user.avatar} alt={user.name} />
                        <AvatarFallback>{avatarFallback(user.name, user.email)}</AvatarFallback>
                    </Avatar>
                ))}

                {userList.length > 4 && <AvatarGroupCount>+{userList.length - 4}</AvatarGroupCount>}
            </AvatarGroup>

            <ul className="space-y-1 text-xs text-muted-foreground">
                {userList.slice(0, 5).map((user) => (
                    <li key={user.id} className="flex justify-between gap-2">
                        <span className="truncate">{user.name || user.email || user.username || user.id}</span>
                        <span className="shrink-0 capitalize">{user.isOwner ? "owner" : user.role}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
};
