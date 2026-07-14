"use client";

import { useMemo, useState } from "react";
import { Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useGetProject } from "@/features/projects/api/use-get-project-by-id";
import { useCurrent } from "@/features/auth/api/use-current";
import { useShareProject } from "../api/use-share-project";
import { PROJECT_ROLE_LABELS, ProjectRole, type ProjectRoleType } from "../constants";

interface ShareProjectDialogProps {
    projectId: string;
}

export function ShareProjectDialog({ projectId }: ShareProjectDialogProps) {
    const [open, setOpen] = useState(false);
    const [recipientIdentifier, setRecipientIdentifier] = useState("");
    const [role, setRole] = useState<ProjectRoleType>(ProjectRole.VIEWER);
    const [message, setMessage] = useState("");
    const [isValidating, setIsValidating] = useState(false);

    const { data: currentUser } = useCurrent();
    const { data: projectDetail } = useGetProject(projectId);
    const { mutateAsync: shareProject, isPending } = useShareProject();

    const canShare = useMemo(() => {
        return projectDetail?.status === "ok" && projectDetail.access.permissions.canShareProject;
    }, [projectDetail]);

    const handleShare = async () => {
        if (!recipientIdentifier) return;
        setIsValidating(true);

        try {
            const res = await fetch(`/api/users/lookup?identifier=${encodeURIComponent(recipientIdentifier)}`);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || "User not found");
            }
            const { data } = await res.json();
            const recipientUserId = data.id;

            if (recipientUserId === currentUser?.id) {
                throw new Error("You cannot share a project with yourself");
            }

            await shareProject({ projectId, recipientUserId, role, message: message.trim() || undefined });
            setOpen(false);
            setMessage("");
            setRecipientIdentifier("");
            setRole(ProjectRole.VIEWER);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Failed to share project");
        } finally {
            setIsValidating(false);
        }
    };

    if (!canShare) {
        return null;
    }

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="w-full justify-start">
                    <Share2 className="mr-2 size-4" />
                    Share project
                </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Share project with a teammate</DialogTitle>
                    <DialogDescription>
                        Packages everything in your local workspace for this project: analysis graphs,
                        documentation, commit exports, and settings and sends it to another user
                        On accept, data is stored under their user folder on this machine
                        ({`AppData/log-a-priori-desktop-shell/{userId}/{projectId}`})
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="share-recipient">Recipient (username or email)</Label>
                        <Input id="share-recipient" placeholder="e.g. jane@example.com" value={recipientIdentifier} onChange={(e) => setRecipientIdentifier(e.target.value)} />
                    </div>

                    <div className="space-y-2">
                        <Label>Access role after accept</Label>
                        <Select value={role} onValueChange={(v) => setRole(v as ProjectRoleType)}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={ProjectRole.VIEWER}>{PROJECT_ROLE_LABELS.viewer}</SelectItem>
                                <SelectItem value={ProjectRole.EDITOR}>{PROJECT_ROLE_LABELS.editor}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="share-message">Message (optional)</Label>
                        <Textarea id="share-message" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What changed since your last sync?" rows={3} />
                    </div>

                    <Button className="w-full" disabled={!recipientIdentifier.trim() || isPending || isValidating} onClick={() => void handleShare()} >
                        {isPending || isValidating ? "Sending package..." : "Send project package"}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    );
}
