import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { sharingFetch } from "./sharing-fetch";

export const useAcceptProjectShare = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (shareId: string) => {
            const { data } = await sharingFetch(`/project-shares/${shareId}/accept`, {
                method: "POST",
            });
            return data;
        },
        onSuccess: (result) => {
            toast.success("Project data imported to your local workspace");
            queryClient.invalidateQueries({ queryKey: ["project-shares", "incoming"] });
            queryClient.invalidateQueries({ queryKey: ["projects"] });
            const projectId = result?.manifest?.projectId;
            if (projectId) {
                queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
            }
        },
        onError: (error: Error) => {
            toast.error(error.message || "Failed to accept share");
        },
    });
};
