import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sharingFetch } from "./sharing-fetch";

export const useDismissDeletionNotice = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (shareId: string) => {
            await sharingFetch(`/project-shares/${shareId}/dismiss-deletion`, { method: "POST" });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["project-shares", "deletion-notices"] });
        },
    });
};
