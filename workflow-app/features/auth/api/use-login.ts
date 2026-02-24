import { useMutation, useQueryClient } from "@tanstack/react-query";
import { InferRequestType, InferResponseType } from "hono";
import { client } from "@/lib/rpc";
import { toast } from "sonner";

type ResponseType = InferResponseType<typeof client.api.auth.login["$post"]>;
type RequestType = InferRequestType<typeof client.api.auth.login["$post"]>;

export const useLogin = () => {
    const queryClient = useQueryClient();

    const mutation = useMutation<ResponseType, Error, RequestType>({
        mutationFn: async ({ json }) => {
            const response = await client.api.auth.login["$post"](
                { json },
                { init: { credentials: "include" } } // important for cookie auth
            );

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
