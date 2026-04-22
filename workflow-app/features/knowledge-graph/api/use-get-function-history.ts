import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/rpc";
import { InferRequestType, InferResponseType } from "hono";
import { toast } from "sonner";

type RequestType = InferRequestType<(typeof client.api.projects)[":projectId"]["knowledge-graph"]["function-history"]["$get"]>;
type ResponseType = InferResponseType<(typeof client.api.projects)[":projectId"]["knowledge-graph"]["function-history"]["$get"], 200>;

type FunctionHistoryResponse = {
    data: FunctionHistoryEntry[];
    key?: string;
    source?: {
        path: string;
    };
    message?: string;
};

export type FunctionHistoryEntry = {
    sha: string;
    changeType: "added" | "modified" | "removed" | string;
    simpleName: string;
    kind: string;
    file: string;
    boundaries: {
        startLine?: number;
        endLine?: number;
        startColumn?: number;
        endColumn?: number;
    };
    previousSha?: string | null;
    nextSha?: string | null;
};

export const useGetFunctionHistory = ( projectId: string, params: { file: string; simpleName: string; kind: string } | null ) => {
    return useQuery({
        queryKey: ["projects", projectId, "knowledge-graph", "function-history", params?.file, params?.simpleName, params?.kind],
        enabled: !!projectId && !!params?.file && !!params?.simpleName && !!params?.kind,
        queryFn: async (): Promise<ResponseType | FunctionHistoryResponse> => {
            try {
                const reqParams: RequestType["param"] = { projectId };
                const query = new URLSearchParams({
                    file: params!.file,
                    simpleName: params!.simpleName,
                    kind: params!.kind,
                }).toString();
                const endpoint = client.api.projects[":projectId"]["knowledge-graph"]["function-history"].$url({
                    param: reqParams,
                });
                const res = await fetch(`${endpoint.pathname}?${query}`, { credentials: "include" });
                const json: unknown = await res.json();

                if (!res.ok) {
                    const message =
                        typeof json === "object" && json !== null && "error" in json
                            ? String((json as { error: unknown }).error)
                            : "Failed to load function history";
                    throw new Error(String(message));
                }

                return json as ResponseType | FunctionHistoryResponse;
            } catch (error) {
                toast.error("Failed to load function history");
                throw error;
            }
        },
    });
};
