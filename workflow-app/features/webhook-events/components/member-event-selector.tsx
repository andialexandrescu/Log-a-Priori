"use client";

import { useEffect, useState } from "react";
import { WebhookEventsList } from "./webhook-events-list";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetProjectMembers } from "@/features/members/api/use-get-project-members";

interface MemberSelectorProps {
    projectId: string;
}

export function MemberEventSelector({ projectId }: MemberSelectorProps) {
    const { data: members, isLoading, isError } = useGetProjectMembers(projectId);
    const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);

    useEffect(() => {
        if (!members || members.length === 0) {
            setSelectedMemberId(null);
            return;
        }

        setSelectedMemberId((current) => {
            if (current && members.some((member: any) => member.id === current)) {
                return current;
            }
            return members[0].id;
        });
    }, [members]);

    if (isLoading) {
        return <div>Loading members...</div>;
    }
    if (isError) {
        return <div className="text-red-500">Could not load members</div>;
    }
    if (!members || members.length === 0) {
        return <div>No members yet</div>;
    }

    return (
        <div className="space-y-4">
            <Select value={selectedMemberId || ""} onValueChange={setSelectedMemberId}>
                <SelectTrigger className="w-50">
                    <SelectValue placeholder="Select a member" />
                </SelectTrigger>
                <SelectContent>
                    {members.map((member) => (
                        <SelectItem key={member.id} value={member.id}>
                            {member.expand?.user?.name || member.expand?.user?.email || member.id}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>

        {selectedMemberId && <WebhookEventsList projectId={projectId} memberId={selectedMemberId} />}
        </div>
    );
}