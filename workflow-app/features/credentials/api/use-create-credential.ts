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
    name: RequestType["json"]["name"];
    api_keys: RequestType["json"]["api_keys"];
    api_limitations?: RequestType["json"]["api_limitations"];
};

export const useCreateCredential = () => {
    const queryClient = useQueryClient();

    const mutation = useMutation<SuccessResponseType, Error, CreateCredentialInput>({
        mutationFn: async ({ projectId, memberId, ...json }) => {
            const response = await client.api.projects[":projectId"]["members"][":memberId"]["credentials"]["$post"]({
                param: { projectId, memberId },
                json
            });
            const result = await response.json();

            if (!("data" in result)) {
                throw new Error(result.error || "Failed to create credential");
            }

            return result;
        },
        onSuccess: (data) => {
            // queryClient.invalidateQueries({
            //     queryKey: 
            // });
            toast.success("Credential created successfully");
        },
        onError: () => {
            toast.error("Failed to create credential");
        }
    });
    return mutation;
};