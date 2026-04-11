import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/rpc";
import { toast } from "sonner";
import { InferRequestType, InferResponseType } from "hono";

type RequestType = InferRequestType<(typeof client.api.projects)[":projectId"]["knowledge-graph"]["$get"]>;
type InferredResponseType = InferResponseType<(typeof client.api.projects)[":projectId"]["knowledge-graph"]["$get"], 200>;
type ResponseType = InferredResponseType | {
    data: null;
    source: {
        path: string;
        updatedAt: string | null;
    };
    message?: string;
};

export const useGetCodeGraph = (projectId: string) => {
    return useQuery({
        queryKey: ["projects", projectId, "knowledge-graph"],
        enabled: !!projectId,
        queryFn: async (): Promise<ResponseType> => {
            try {
                const params: RequestType["param"] = { projectId };
                const res = await client.api.projects[":projectId"]["knowledge-graph"].$get({
                    param: params,
                });

                const json = await res.json();

                if (!res.ok) {
                    const message = "error" in json ? json.error : "Failed to get knowledge graph";
                    throw new Error(String(message));
                }

                if (typeof json === "object" && json !== null && "data" in json && json.data === null) {
                    const notFoundMessage =
                        "message" in json && typeof json.message === "string"
                            ? json.message
                            : "Run the extractor first to generate analysis/ts-code-graph.json";
                    toast.error(notFoundMessage);
                }

                return json as ResponseType;
            } catch (error) {
                toast.error("Failed to load knowledge graph");
                throw error;
            }
        },
    });
};
