import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { sharingFetch } from "./sharing-fetch";
import type { ProjectRoleType } from "../constants";

type ShareProjectInput = {
    projectId: string;
    recipientUserId: string;
    role?: ProjectRoleType;
    message?: string;
};

export const useShareProject = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async ({ projectId, ...json }: ShareProjectInput) => {
            const { data } = await sharingFetch(`/projects/${projectId}/shares`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(json),
            });
            return data;
        },
        onSuccess: (_data, variables) => {
            toast.success("Project package sent. The recipient can accept it from their inbox.");
            queryClient.invalidateQueries({ queryKey: ["project-shares", "incoming"] });
            queryClient.invalidateQueries({ queryKey: ["projects", variables.projectId, "shares", "outgoing"] });
        },
        onError: (error: Error) => {
            toast.error(error.message || "Failed to share project");
        },
    });
};
