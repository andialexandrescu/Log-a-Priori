"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useDeleteProject } from "../api/use-delete-project";

type Props = {
    projectId: string;
    projectName: string;
};

export function DeleteProjectDialog({ projectId, projectName }: Props) {
    const router = useRouter();
    const { mutateAsync: deleteProject, isPending } = useDeleteProject();
    const [open, setOpen] = useState(false);

    const handleDelete = async () => {
        try {
            await deleteProject(projectId);
            setOpen(false);
            router.push("/projects");
        } catch {
            // Toast is shown by useDeleteProject, keep dialog open for retry
        }
    };

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="w-full justify-start">
                    <Trash2 className="mr-2 size-4" />
                    Delete project
                </Button>
            </DialogTrigger>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Delete &ldquo;{projectName}&rdquo;?</DialogTitle>
                    <DialogDescription className="space-y-2">
                        <span className="block">
                            This permanently removes the project from the database, deletes GitHub
                            credentials and webhook events for it, and erases all on disk data under
                            your appdata folder for this project
                        </span>
                        <span className="block">
                            If you shared the project, teammates will see that you deleted it and their
                            local copies under their user folders will be removed as well
                        </span>
                    </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                        Cancel
                    </Button>
                    <Button disabled={isPending} onClick={() => void handleDelete()}>
                        {isPending ? "Deleting..." : "Delete permanently"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};
