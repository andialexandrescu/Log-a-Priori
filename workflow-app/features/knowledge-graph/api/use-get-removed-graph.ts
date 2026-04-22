import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/rpc";
import { toast } from "sonner";

type RemovedGraphResponse = {
    data: {
        graph: {
            nodes: any[];
            edges: any[];
        };
        visualization: {
            functionNodes: any[];
            edges: {
                calls: {
                    inFile: any[];
                    crossFile: any[];
                };
            };
            components: string[][];
        };
        summary: {
            functions: number;
            filesAnalyzed: number;
            totalEdges: number;
        };
    } | null;
    source?: {
        path: string;
        updatedAt: string;
    };
    message?: string;
};

// the need for this is motivated by the fact that analyze-recursion build the graph visualization for the existing nodes in the current project
// therefore removed nodes are only identified during build-function-history and won't be part of the final visualization unless the sets of nodes are merged together
export const useGetRemovedGraph = (projectId: string) => {
    return useQuery({
        queryKey: ["projects", projectId, "knowledge-graph", "removed"],
        enabled: !!projectId,
        queryFn: async (): Promise<RemovedGraphResponse> => {
            try {
                const endpoint = client.api.projects[":projectId"]["knowledge-graph"]["removed-graph"].$url({
                    param: { projectId },
                });
                const res = await fetch(endpoint.pathname, { credentials: "include" });
                const json = await res.json() as RemovedGraphResponse;

                if (!res.ok) {
                    throw new Error("Failed to load removed functions graph");
                }

                if (json.data === null) {
                    toast.error(json.message || "No removed functions found");
                }

                return json;
            } catch (error) {
                toast.error("Failed to load removed functions graph");
                throw error;
            }
        },
    });
};