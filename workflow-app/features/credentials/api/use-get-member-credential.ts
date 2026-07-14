import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/rpc";
import { normalizeCredentialRecord, type UserCredentialResult } from "../schemas";

export const useGetUserCredential = (projectId: string, userId: string) => {
    const query = useQuery({
        queryKey: ["projects", projectId, "users", userId, "credentials"],
        enabled: !!projectId && !!userId,
        queryFn: async (): Promise<UserCredentialResult> => {
            const res = await client.api.projects[":projectId"].users[":userId"]["credentials"]["$get"]({
                param: { projectId, userId },
            });

            if (!res.ok) {
                throw new Error(`Failed to get credential: ${res.status}`);
            }

            const body = (await res.json()) as { data?: unknown; inherited?: boolean };
            return {
                credential: normalizeCredentialRecord(body.data),
                inherited: Boolean(body.inherited),
            };
        },
    });

    return query;
};
