"use client";

import { useState } from "react";
import { CreateMembersBulkSelect } from "./create-members-bulk-select";
import { Button } from "@/components/ui/button";
import { useBulkCreateMembers } from "../api/use-bulk-create-members";
import { ProjectRoleType } from "../constants";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface ProjectProps {
    projectId: string;
}

export const ProjectCreateMembersDialog = ({ projectId }: ProjectProps) => {
    const [membersToAdd, setMembersToAdd] = useState<{ userId: string; role: ProjectRoleType }[]>([]);
    const { mutateAsync, isPending } = useBulkCreateMembers();
    const [open, setOpen] = useState(false);

    const handleSave = async () => {
        if (membersToAdd.length === 0) return;
        try {
            await mutateAsync({ projectId, members: membersToAdd });
            setMembersToAdd([]);
            setOpen(false);
        } catch (error) {
            console.error("Failed to add members:", error);
        }
    };

    return (
        <div className="w-64 shrink-0 space-y-4">
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogTrigger asChild>
                    <Button variant="outline" className="w-full">
                        Add project members
                    </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Members</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <CreateMembersBulkSelect members={membersToAdd} setMembers={setMembersToAdd} />
                        {membersToAdd.length > 0 && (
                            <Button onClick={handleSave} className="w-full" disabled={isPending}>
                                {isPending ? "Saving..." : "Save Members"}
                            </Button>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};