import { useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/rpc";
import { toast } from "sonner";

export type DedupeCommitEventsResult = {
    commitRecordCount: number;
    uniqueCommitCount: number;
    duplicateRecordCount: number;
    deleted: number;
    failed: number;
};

export const useDedupeCommitEvents = (projectId: string, userId: string) => {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (): Promise<DedupeCommitEventsResult> => {
            const res = await client.api.projects[":projectId"].users[":userId"]["webhook-events"][
                "dedupe-commit-events"
            ].$post({
                param: { projectId, userId },
            });

            const body = await res.json();
            if (!res.ok || !("data" in body)) {
                const message =
                    "error" in body && typeof body.error === "string"
                        ? body.error
                        : "Failed to clean duplicate commits";
                throw new Error(message);
            }

            return body.data as DedupeCommitEventsResult;
        },
        onSuccess: async (data) => {
            await queryClient.invalidateQueries({
                queryKey: ["projects", projectId, "users", userId, "webhook-events"],
            });
            await queryClient.invalidateQueries({
                queryKey: ["projects", projectId, "users", userId, "commits"],
            });

            if (data.deleted > 0) {
                toast.success(
                    `Removed ${data.deleted} duplicate commit record${data.deleted === 1 ? "" : "s"}. ${data.uniqueCommitCount} unique commits remain.`
                );
            } else {
                toast.success("No duplicate commit records to remove.");
            }
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : "Cleanup failed");
        },
    });
};
