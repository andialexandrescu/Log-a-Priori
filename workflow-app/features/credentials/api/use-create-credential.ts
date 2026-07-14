import { useMutation, useQueryClient } from "@tanstack/react-query";
import { InferRequestType, InferResponseType } from "hono";
import { client } from "@/lib/rpc";
import { toast } from "sonner";
type SuccessResponseType = { data: any };

export type CreateCredentialInput = {
    projectId: string;
    userId: string;
    api_keys: {
        token: string;
        owner: string;
        repo: string;
    };
    api_limitations?: Record<string, any>;
};

export const useCreateCredential = () => {
    const queryClient = useQueryClient();

    const mutation = useMutation<SuccessResponseType, Error, CreateCredentialInput>({
        mutationFn: async ({ projectId, userId, ...json }) => {
            try {
                const response = await client.api.projects[":projectId"]["users"][":userId"]["credentials"]["$post"]({
                    param: { projectId, userId },
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
                queryKey: ["projects", variables.projectId, "users", variables.userId, "credentials"],
            });
            await queryClient.invalidateQueries({
                queryKey: ["projects", variables.projectId, "users", variables.userId, "webhook-events"],
            });
            toast.success("GitHub connected successfully");
        },
        onError: (error) => {
            console.error("Failed to create credential:", error.message);
            toast.error(error.message || "Failed to create credential");
        }
    });
    return mutation;
};
