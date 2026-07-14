import { useMutation, useQueryClient } from "@tanstack/react-query";
import { sharingFetch } from "./sharing-fetch";
import { toast } from "sonner";

export const useAcceptShare = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (shareId: string) => {
      const { data } = await sharingFetch(`/project-shares/${shareId}/accept`, {
        method: "POST",
      });
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-shares", "incoming"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project shared successfully!");
    },
    onError: () => {
      toast.error("Failed to accept share");
    },
  });
};
