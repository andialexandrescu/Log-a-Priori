import { useMutation, useQueryClient } from "@tanstack/react-query";
import { InferRequestType, InferResponseType } from "hono";
import { client } from "@/lib/rpc";
import { toast } from "sonner";

type RawResponseType = InferResponseType<typeof client.api.projects["$post"]>;
type SuccessResponseType = Extract<RawResponseType, { data: any }>; // extract the success branch, the one with a data property
type RequestType = InferRequestType<typeof client.api.projects["$post"]>;

export type CreateProjectPayload = {
    project: RequestType["json"];
};

export const useCreateProject = () => {
    const queryClient = useQueryClient();

    const mutation = useMutation<SuccessResponseType, Error, CreateProjectPayload>({
        mutationFn: async ({ project }) => {
            const projectResponse = await client.api.projects["$post"]({ json: project });
            const projectResult = await projectResponse.json();

            if (!('data' in projectResult)) {
                throw new Error(projectResult.error || "Failed to create project");
            }

            return projectResult; // the full project data, including all fields
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["projects"] });
        },
        onError: () => {
            toast.error("Failed to create project");
        }
    });

    return mutation;
};