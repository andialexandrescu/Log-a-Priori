import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/rpc";
import { toast } from "sonner";

export const useDeleteProject = () => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (projectId: string) => {
            const res = await client.api.projects[":projectId"].$delete({
                param: { projectId },
            });

            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(
                    (body as { error?: string }).error || `Failed to delete project (${res.status})`
                );
            }

            return res.json();
        },
        onSuccess: (_data, projectId) => {
            queryClient.invalidateQueries({ queryKey: ["projects"] });
            queryClient.removeQueries({ queryKey: ["projects", projectId] });
            toast.success("Project deleted");
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Failed to delete project");
        },
    });
};
