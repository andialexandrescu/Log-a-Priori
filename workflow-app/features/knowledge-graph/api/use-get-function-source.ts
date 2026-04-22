import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/rpc";
import { InferRequestType, InferResponseType } from "hono";
import { toast } from "sonner";

type RequestType = InferRequestType<(typeof client.api.projects)[":projectId"]["knowledge-graph"]["function-source"]["$get"]>;
type ResponseType = InferResponseType<(typeof client.api.projects)[":projectId"]["knowledge-graph"]["function-source"]["$get"], 200>;

type FunctionSourceResponse = {
    data: {
        sha: string;
        file: string;
        operation: string;
        startLine: number;
        endLine: number;
        sourceCode: string;
    } | null;
    message?: string;
};

export type FunctionSourceParams = {
    sha: string;
    file: string;
    startLine: number;
    endLine: number;
};

export const useGetFunctionSource = ( projectId: string, params: FunctionSourceParams | null ) => {
    return useQuery({
        queryKey: [
            "projects",
            projectId,
            "knowledge-graph",
            "function-source",
            params?.sha,
            params?.file,
            params?.startLine,
            params?.endLine,
        ],
        enabled: !!projectId && !!params?.sha && !!params?.file && !!params?.startLine && !!params?.endLine,
        queryFn: async (): Promise<ResponseType | FunctionSourceResponse> => {
            try {
                const reqParams: RequestType["param"] = { projectId };
                const query = new URLSearchParams({
                    sha: params!.sha,
                    file: params!.file,
                    startLine: String(params!.startLine),
                    endLine: String(params!.endLine),
                }).toString();
                const endpoint = client.api.projects[":projectId"]["knowledge-graph"]["function-source"].$url({
                    param: reqParams,
                });
                const res = await fetch(`${endpoint.pathname}?${query}`, { credentials: "include" });
                const json: unknown = await res.json();

                if (!res.ok) {
                    const message =
                        typeof json === "object" && json !== null && "error" in json
                            ? String((json as { error: unknown }).error)
                            : "Failed to load function source";
                    throw new Error(String(message));
                }

                return json as ResponseType | FunctionSourceResponse;
            } catch (error) {
                toast.error("Failed to load function source");
                throw error;
            }
        },
    });
};