import { useQuery } from "@tanstack/react-query";
import { InferResponseType } from "hono";
import { client } from "@/lib/rpc";
import { toast } from "sonner";

export const useGetCurrentMemberByProject = (projectId?: string, options: { enabled?: boolean; } = {}) => {
    return useQuery({
        queryKey: ["current-member", projectId],
        enabled: !!projectId,
        queryFn: async () => {
            try {
                if (!projectId) return null;

                const res = await client.api.projects[":projectId"].members.current.$get({
                    param: { projectId },
                });

                if (!res.ok) return null;

                const { data } = await res.json();
                return data;
            } catch (error) {
                toast.error("Failed to fetch current project");
                throw error;
            }
        },
    });
};