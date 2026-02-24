"use client";

import { useState } from "react";
import { ProjectRole, ProjectRoleType } from "../constants";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface CreateMembersBulkSelectProps {
    members: { userId: string; role: ProjectRoleType }[];
    setMembers: (members: { userId: string; role: ProjectRoleType }[]) => void;
}

export const CreateMembersBulkSelect = ({ members, setMembers }: CreateMembersBulkSelectProps) => {
    const [memberUserId, setMemberUserId] = useState("");
    const [memberRole, setMemberRole] = useState<ProjectRoleType>(ProjectRole.VIEWER);
    const [duplicateError, setDuplicateError] = useState<string | null>(null);

    const addMember = () => {
        if (memberUserId && memberRole) {
            if (members.some(m => m.userId === memberUserId)) { // just to prevent the error before sending the request
                setDuplicateError(`User "${memberUserId}" is already in the list, remove the existing entry first if you want to change their role`); // instead of alert
                return;
            }
            setDuplicateError(null); // for previous duplicate errors
            setMembers([...members, { userId: memberUserId, role: memberRole }]);
            setMemberUserId(""); // reinit with previous values
            setMemberRole(ProjectRole.VIEWER);
        }
    };

    return (
        <div className="space-y-4">
            <div>
                <Label className="block text-sm mb-1">Add project members</Label>
                <div className="flex gap-2 items-end mb-4">
                <Input placeholder="userId" className="flex-1" value={memberUserId} onChange={(e) => { setMemberUserId(e.target.value); if (duplicateError) setDuplicateError(null); }}/>
                <Select value={memberRole} onValueChange={(value) => setMemberRole(value as ProjectRoleType)}>
                    <SelectTrigger className="w-32">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value={ProjectRole.VIEWER}>viewer</SelectItem>
                        <SelectItem value={ProjectRole.EDITOR}>editor</SelectItem>
                        <SelectItem value={ProjectRole.ADMIN}>admin</SelectItem>
                    </SelectContent>
                </Select>
                <Button type="button" onClick={addMember} size="sm" disabled={!memberUserId || !memberRole}>
                    Add
                </Button>
                </div>
                {duplicateError && (
                    <Alert variant="destructive" className="mt-2">
                        <AlertDescription>{duplicateError}</AlertDescription>
                    </Alert>
                )}
            </div>
            
            <div className="space-y-2 max-h-40 overflow-y-auto">
                {members.length === 0 ? (
                <p className="text-muted-foreground text-sm">No members added yet</p>
                ) : (
                members.map((member, i) => (
                        <div key={i} className="flex justify-between items-center p-2 border rounded">
                            <div className="flex items-center gap-2">
                                <span>{member.userId}</span>
                                <Badge variant={member.role === ProjectRole.ADMIN ? "destructive" : "secondary"}>
                                    {member.role}
                                </Badge>
                            </div>
                            <Button variant="ghost" size="sm" onClick={() => { setMembers(members.filter((_, idx) => idx !== i)); setDuplicateError(null); }}>
                                Remove
                            </Button>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};