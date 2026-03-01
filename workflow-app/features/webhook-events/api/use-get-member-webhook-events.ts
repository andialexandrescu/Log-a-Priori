import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/rpc";
import { toast } from "sonner";

export const useGetMemberWebhookEvents = (projectId: string, memberId: string) => {
    const query = useQuery({
        queryKey: ["projects", projectId, "members", memberId, "webhook-events"],
        enabled: !!projectId && !!memberId,
        queryFn: async () => {
            try {
                const res = await client.api.projects[":projectId"].members[":memberId"]["webhook-events"].$get({
                    param: { projectId, memberId },
                });

                if (!res.ok) {
                    throw new Error(`Failed to get webhook events: ${res.status}`);
                }

                const { data } = await res.json();
                return data;
            } catch (error) {
                toast.error("Failed to fetch webhook events");
                throw error;
            }
        },
    });

    return query;
};
