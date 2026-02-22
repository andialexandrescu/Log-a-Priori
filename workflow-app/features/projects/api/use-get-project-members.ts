import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/rpc";

export const useGetProjectMembers = (projectId: string) => {
    const query = useQuery({
        queryKey: ["projects", projectId, "members"],
        enabled: !!projectId,
        queryFn: async () => {
            const res = await client.api.projects[":projectId"].members.$get({
                param: { projectId },
            });

            if (!res.ok) {
                throw new Error(`Failed to get members: ${res.status}`);
            }

            const { data } = await res.json();
            return data;
        },
    });

    return query;
};