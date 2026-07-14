import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { sharingFetch } from "./sharing-fetch";

export const useDeclineProjectShare = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (shareId: string) => {
            await sharingFetch(`/project-shares/${shareId}/decline`, { method: "POST" });
        },
        onSuccess: () => {
            toast.message("Share declined");
            queryClient.invalidateQueries({ queryKey: ["project-shares", "incoming"] });
        },
    });
};
