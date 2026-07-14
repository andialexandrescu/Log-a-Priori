import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sharingFetch } from "./sharing-fetch";

export const useMarkProjectShareRead = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (shareId: string) => {
            await sharingFetch(`/project-shares/${shareId}/read`, { method: "POST" });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["project-shares", "sender-updates"] });
        },
    });
};
