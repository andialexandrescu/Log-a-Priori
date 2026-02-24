import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/rpc";
import { toast } from "sonner";

export const useGetProjectMembers = (projectId: string) => {
    const query = useQuery({
        queryKey: ["members", projectId],
        enabled: !!projectId,
        queryFn: async () => {
            try {
                const res = await client.api.members[":projectId"].$get({
                    param: { projectId },
                });

                if (!res.ok) {
                    throw new Error(`Failed to get members: ${res.status}`);
                }

                const { data } = await res.json();
                return data;
            } catch (error) {
                toast.error("Failed to fetch current project members");
                throw error;
            }
        },
    });

    return query;
};