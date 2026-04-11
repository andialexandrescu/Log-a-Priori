"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { CredentialStatus } from "./credential-status";
import { CreateCredentialDialog } from "./create-credential-dialog";
import { useGetCurrentMemberByProject } from "@/features/members/api/use-get-current-member-by-project";
import { useGetMemberCredential } from "../api/use-get-member-credential";

interface CredentialStatusContainerProps {
    projectId: string;
}

function CredentialStatusContainerComponent({ projectId }: CredentialStatusContainerProps) {
    const [isCredentialDialogOpen, setIsCredentialDialogOpen] = useState(false);
    const [credentialMode, setCredentialMode] = useState<"create" | "edit">("create");
    const { data: member, isLoading: memberLoading } = useGetCurrentMemberByProject(projectId, { enabled: !!projectId });
    const { data: existingCredential } = useGetMemberCredential(projectId, member?.id ?? "");

    const handleCredentialEdit = () => {
        setCredentialMode(existingCredential ? "edit" : "create");
        setIsCredentialDialogOpen(true);
    };

    if (memberLoading || !member) {
        return null;
    }

    return (
        <>
            <CredentialStatus projectId={projectId} memberId={member.id} onEditClick={handleCredentialEdit} />
            <CreateCredentialDialog open={isCredentialDialogOpen} onOpenChange={setIsCredentialDialogOpen} projectId={projectId} memberId={member.id} mode={credentialMode}/>
        </>
    );
}

export const CredentialStatusContainer = dynamic(
    () => Promise.resolve({ default: CredentialStatusContainerComponent }),
    { ssr: false }
);
