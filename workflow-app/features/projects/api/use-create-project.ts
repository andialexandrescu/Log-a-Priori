import { useMutation, useQueryClient } from "@tanstack/react-query";
import { InferRequestType, InferResponseType } from "hono";
import { client } from "@/lib/rpc";
import { bulkCreateMembers, BulkCreateMembersInput } from "../../members/api/use-bulk-create-members";
import { toast } from "sonner";

type RawResponseType = InferResponseType<typeof client.api.projects["$post"]>;
type SuccessResponseType = Extract<RawResponseType, { data: any }>; // extract the success branch, the one with a data property
type RequestType = InferRequestType<typeof client.api.projects["$post"]>;

export type CreateProjectPayload = { // extended payload, members use the exact type expected by bulkCreateMembers
    project: RequestType["json"];
    members?: BulkCreateMembersInput["members"];
};

export const useCreateProject = () => {
    const queryClient = useQueryClient();

    const mutation = useMutation<SuccessResponseType, Error, CreateProjectPayload>({
        mutationFn: async ({ project, members }) => {
            const projectResponse = await client.api.projects["$post"]({ json: project });
            const projectResult = await projectResponse.json();

            if (!('data' in projectResult)) {
                throw new Error(projectResult.error || "Failed to create project");
            }

            const newProject = projectResult.data; // typescript knows projectResult is the success type
            const projectId = newProject.id;

            if (members && members.length > 0) {
                try {
                    await bulkCreateMembers({ projectId, members });
                } catch (memberError) {
                    throw new Error(
                        memberError instanceof Error
                            ? memberError.message
                            : "Project created but failed to add members"
                    );
                }
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