import { useMutation, useQueryClient } from "@tanstack/react-query";
import { InferRequestType, InferResponseType } from "hono";
import { client } from "@/lib/rpc";
import { toast } from "sonner";

type ResponseType = InferResponseType<typeof client.api.auth.register["$post"]>;
type RequestType = InferRequestType<typeof client.api.auth.register["$post"]>;

export const useRegister = () => {
    const queryClient = useQueryClient();

    const mutation = useMutation<ResponseType, Error, RequestType>({
        mutationFn: async ({ json }) => {
            const response = await client.api.auth.register["$post"]({ json });
            return await response.json();
        },
        onSuccess: () => {
            window.location.href = "/";
            queryClient.invalidateQueries({ queryKey: ["current"]});
        },
        onError: () => {
            toast.error("Failed to authenticate current user");
        }
    });

    return mutation;
}