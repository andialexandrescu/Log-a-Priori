"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { CredentialStatus } from "./credential-status";
import { CreateCredentialDialog } from "./create-credential-dialog";
import { useGetUserCredential } from "../api/use-get-member-credential";
import { useCurrent } from "@/features/auth/api/use-current";

interface CredentialStatusContainerProps {
    projectId: string;
}

function CredentialStatusContainerComponent({ projectId }: CredentialStatusContainerProps) {
    const [isCredentialDialogOpen, setIsCredentialDialogOpen] = useState(false);
    const [credentialMode, setCredentialMode] = useState<"create" | "edit">("create");
    const { data: currentUser } = useCurrent();
    const { data: existingCredentialData } = useGetUserCredential(projectId, currentUser?.id ?? "");
    const existingCredential = existingCredentialData?.credential;
    const inheritedCredential = existingCredentialData?.inherited ?? false;

    const handleCredentialEdit = () => {
        if (inheritedCredential) {
            return;
        }
        setCredentialMode(existingCredential ? "edit" : "create");
        setIsCredentialDialogOpen(true);
    };

    if (!currentUser) {
        return null;
    }

    return (
        <>
            <CredentialStatus projectId={projectId} userId={currentUser.id} onEditClick={handleCredentialEdit} />
            <CreateCredentialDialog open={isCredentialDialogOpen} onOpenChange={setIsCredentialDialogOpen} projectId={projectId} userId={currentUser.id} mode={credentialMode}/>
        </>
    );
}

export const CredentialStatusContainer = dynamic(
    () => Promise.resolve({ default: CredentialStatusContainerComponent }),
    { ssr: false }
);
