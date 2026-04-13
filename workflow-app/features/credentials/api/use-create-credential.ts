import { useMutation, useQueryClient } from "@tanstack/react-query";
import { InferRequestType, InferResponseType } from "hono";
import { client } from "@/lib/rpc";
import { toast } from "sonner";

type RawResponseType = InferResponseType<(typeof client.api.projects)[":projectId"]["members"][":memberId"]["credentials"]["$post"]>;
type SuccessResponseType = Extract<RawResponseType, { data: any }>;
type RequestType = InferRequestType<(typeof client.api.projects)[":projectId"]["members"][":memberId"]["credentials"]["$post"]>;

export type CreateCredentialInput = {
    projectId: RequestType["param"]["projectId"];
    memberId: RequestType["param"]["memberId"];
    api_keys: RequestType["json"]["api_keys"];
    api_limitations?: RequestType["json"]["api_limitations"];
};

export const useCreateCredential = () => {
    const queryClient = useQueryClient();

    const mutation = useMutation<SuccessResponseType, Error, CreateCredentialInput>({
        mutationFn: async ({ projectId, memberId, ...json }) => {
            try {
                const response = await client.api.projects[":projectId"]["members"][":memberId"]["credentials"]["$post"]({
                    param: { projectId, memberId },
                    json
                });
                const result = await response.json();

                if (!("data" in result)) {
                    const errorMessage = result.error || "Failed to create credential";
                    console.error("Credential creation error:", result);
                    throw new Error(errorMessage);
                }

                return result;
            } catch (error: any) {
                if (error instanceof Error && error.message) {
                    throw error;
                }
                
                const message = error?.message || "Failed to create credential";
                console.error("Credential mutation error:", error);
                throw new Error(message);
            }
        },
        onSuccess: async (_data, variables) => {
            await queryClient.invalidateQueries({
                queryKey: ["projects", variables.projectId, "members", variables.memberId, "webhook-events"],
            });
            toast.success("Credential created successfully");
        },
        onError: (error) => {
            console.error("Failed to create credential:", error.message);
            toast.error(error.message || "Failed to create credential");
        }
    });
    return mutation;
};