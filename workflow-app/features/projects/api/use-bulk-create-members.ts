import { InferRequestType, InferResponseType } from "hono";
import { client } from "@/lib/rpc";
import { useMutation, useQueryClient } from "@tanstack/react-query";

type RawResponseType = InferResponseType<(typeof client.api.projects)[":projectId"]["member"]["bulk"]["$post"]>;
type SuccessResponseType = Extract<RawResponseType, { data: any }>; // extract the success branch, the one with a data property
type RequestType = InferRequestType<(typeof client.api.projects)[":projectId"]["member"]["bulk"]["$post"]>;

export type BulkCreateMembersInput = {
    projectId: string;
    members: RequestType["json"]["members"];
};

// receives both a project id and an array of users and their respective roles
export const bulkCreateMembers = async ({ projectId, members }: BulkCreateMembersInput): Promise<SuccessResponseType["data"]> => {
    const response = await client.api.projects[":projectId"]["member"]["bulk"]["$post"]({
        param: { projectId },
        json: { members },
    });

    const result = await response.json();

    if (!('data' in result)) {
        throw new Error((result as { error: string }).error || "Failed to create members");
    }

    return result.data;
};

export const useBulkCreateMembers = () => {
    const queryClient = useQueryClient();

    const mutation = useMutation({
        mutationFn: (params: BulkCreateMembersInput) => bulkCreateMembers(params),
        onSuccess: (data, variables) => {
            console.log("Created members:", data);
            queryClient.invalidateQueries({ queryKey: ["members", variables.projectId] });
        }
    });

    return mutation;
};