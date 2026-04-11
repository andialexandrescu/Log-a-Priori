import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/rpc";
import { toast } from "sonner";

export const useGetMemberCredential = (projectId: string, memberId: string) => {
    const query = useQuery({
        queryKey: ["projects", projectId, "members", memberId, "credentials"],
        enabled: !!memberId,
        queryFn: async () => {
            try {
                const res = await client.api.projects[":projectId"]["members"][":memberId"]["credentials"]["$get"]({
                    param: { projectId, memberId },
                });

                if (!res.ok) {
                    throw new Error(`Failed to get credential: ${res.status}`);
                }

                const { data } = await res.json();
                return data;
            } catch (error) {
                console.error("Failed to fetch credential:", error);
                toast.error("Failed to fetch credential");
                throw error;
            }
        },
    });

    return query;
};
