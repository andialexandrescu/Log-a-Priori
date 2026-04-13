import { useMutation, useQueryClient } from "@tanstack/react-query";
import { InferRequestType, InferResponseType } from "hono";
import { client } from "@/lib/rpc";
import { toast } from "sonner";

type RawResponseType = InferResponseType<(typeof client.api.projects)[":projectId"]["members"][":memberId"]["credentials"][":credentialId"]["$patch"]>;
type SuccessResponseType = Extract<RawResponseType, { data: any }>;
type RequestType = InferRequestType<(typeof client.api.projects)[":projectId"]["members"][":memberId"]["credentials"][":credentialId"]["$patch"]>;

export type UpdateCredentialInput = {
    projectId: RequestType["param"]["projectId"];
    memberId: RequestType["param"]["memberId"];
    credentialId: RequestType["param"]["credentialId"];
    api_keys: RequestType["json"]["api_keys"];
    api_limitations?: RequestType["json"]["api_limitations"];
};

export const useUpdateCredential = () => {
    const queryClient = useQueryClient();

    const mutation = useMutation<SuccessResponseType, Error, UpdateCredentialInput>({
        mutationFn: async ({ projectId, memberId, credentialId, ...json }) => {
            const response = await fetch( // doing this manually since it's not be fully typed
                `/api/projects/${projectId}/members/${memberId}/credentials/${credentialId}`,
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

            return { data: result.data };
        },
        onSuccess: async (_data, variables) => {
            await queryClient.invalidateQueries({
                queryKey: ["projects", variables.projectId, "members", variables.memberId, "credentials"],
            });
            toast.success("Credential updated successfully");
        },
        onError: (error) => {
            console.error("Failed to update credential:", error.message);
            toast.error(error.message || "Failed to update credential");
        }
    });

    return mutation;
};
