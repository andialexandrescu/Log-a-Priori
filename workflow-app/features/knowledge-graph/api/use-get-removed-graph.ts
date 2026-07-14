import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/rpc";
import { toast } from "sonner";
import { useDesktopUserId } from "@/lib/use-desktop-user-id";
import { useGetUserCredential } from "@/features/credentials/api/use-get-member-credential";

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
    reason?: "no_history" | "error";
};

function removedGraphErrorToastKey(projectId: string): string {
    return `removed-graph-error-toast:${projectId}`;
}

function showRemovedGraphErrorOnce(projectId: string, message: string): void {
    if (typeof window === "undefined") {
        return;
    }
    const key = removedGraphErrorToastKey(projectId);
    if (sessionStorage.getItem(key) === "1") {
        return;
    }
    sessionStorage.setItem(key, "1");
    toast.error(message);
}

// removed nodes come from commit history function-history.json, which requires github webhooks
export const useGetRemovedGraph = (projectId: string) => {
    const userId = useDesktopUserId();
    const { data: credentialData } = useGetUserCredential(projectId, userId ?? "");
    const hasCredential = Boolean(credentialData?.credential);

    return useQuery({
        queryKey: ["projects", projectId, "knowledge-graph", "removed"],
        enabled: Boolean(projectId && userId && hasCredential),
        refetchOnWindowFocus: false,
        retry: false,
        staleTime: 5 * 60 * 1000,
        queryFn: async (): Promise<RemovedGraphResponse> => {
            const endpoint = client.api.projects[":projectId"]["knowledge-graph"]["removed-graph"].$url({
                param: { projectId },
            });
            const res = await fetch(endpoint.pathname, { credentials: "include" });
            const json = await res.json() as RemovedGraphResponse;

            if (!res.ok) {
                showRemovedGraphErrorOnce(
                    projectId,
                    "error" in json && typeof (json as { error?: string }).error === "string"
                        ? (json as { error: string }).error
                        : "Failed to load removed functions graph"
                );
                throw new Error("Failed to load removed functions graph");
            }

            if (json.reason === "error") {
                showRemovedGraphErrorOnce(
                    projectId,
                    json.message ?? "Could not build removed nodes graph"
                );
            }

            return json;
        },
    });
};
