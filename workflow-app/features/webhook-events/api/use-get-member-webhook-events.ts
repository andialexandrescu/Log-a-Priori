import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/rpc";
import { toast } from "sonner";
import { normalizeWebhookEvents, type WebhookEvent } from "../schemas";

export const useGetUserWebhookEvents = (projectId: string, userId: string) => {
    const query = useQuery({
        queryKey: ["projects", projectId, "users", userId, "webhook-events"],
        enabled: !!projectId && !!userId,
        refetchInterval: 5000, // calls the webhook-events endpoint every 5 seconds, in order to make webhook events appear without manual refresh (issue arose in inital 'create credential' commits backfill)
        refetchIntervalInBackground: true,
        queryFn: async (): Promise<WebhookEvent[]> => {
            try {
                const res = await client.api.projects[":projectId"].users[":userId"]["webhook-events"].$get({
                    param: { projectId, userId },
                });

                if (!res.ok) {
                    throw new Error(`Failed to get webhook events: ${res.status}`);
                }

                const body = (await res.json()) as { data?: unknown };
                return normalizeWebhookEvents(body.data);
            } catch (error) {
                toast.error("Failed to fetch webhook events");
                throw error;
            }
        },
    });

    return query;
};
