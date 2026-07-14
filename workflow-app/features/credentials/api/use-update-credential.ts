import { useMutation, useQueryClient } from "@tanstack/react-query";
import { InferRequestType, InferResponseType } from "hono";
import { client } from "@/lib/rpc";
import { toast } from "sonner";

type UpdateCredentialResponse = {
    data: unknown;
    backfill?: { fetchedFromGithub: number; created: number };
    reset?: { deletedWebhookEvents: number };
};
type RequestType = InferRequestType<(typeof client.api.projects)[":projectId"]["users"][":userId"]["credentials"][":credentialId"]["$patch"]>;
export type UpdateCredentialInput = {
    projectId: RequestType["param"]["projectId"];
    userId: RequestType["param"]["userId"];
    credentialId: RequestType["param"]["credentialId"];
    api_keys: RequestType["json"]["api_keys"];
    api_limitations?: RequestType["json"]["api_limitations"];
};

export const useUpdateCredential = () => {
    const queryClient = useQueryClient();

    const mutation = useMutation<UpdateCredentialResponse, Error, UpdateCredentialInput>({
        mutationFn: async ({ projectId, userId, credentialId, ...json }) => {
            const response = await fetch( // doing this manually since it's not be fully typed
                `/api/projects/${projectId}/users/${userId}/credentials/${credentialId}`,
                {
                    method: 'PATCH',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(json),
                }
            );

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || "Failed to update credential");
            }

            return result;
        },
        onSuccess: async (result, variables) => {
            await Promise.all([
                queryClient.invalidateQueries({
                    queryKey: ["projects", variables.projectId, "users", variables.userId, "credentials"],
                }),
                queryClient.invalidateQueries({
                    queryKey: ["projects", variables.projectId, "users", variables.userId, "webhook-events"],
                }),
                queryClient.invalidateQueries({
                    queryKey: ["projects", variables.projectId, "users", variables.userId, "commits"],
                }),
            ]);

            const created = result.backfill?.created;
            if (typeof created === "number") {
                toast.success(
                    `GitHub configuration updated. Imported ${created} commit${created === 1 ? "" : "s"} from the repository.`
                );
            } else {
                toast.success("GitHub configuration updated");
            }
        },
        onError: (error) => {
            console.error("Failed to update credential:", error.message);
            toast.error(error.message || "Failed to update credential");
        }
    });

    return mutation;
};
