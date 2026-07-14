import { useQuery, useQueryClient } from "@tanstack/react-query";
import { InferRequestType } from "hono";
import { client } from "@/lib/rpc";
import { toast } from "sonner";
import { describeCommitSyncResultToast } from "@/lib/background-process-messages";

type RequestType = InferRequestType<(typeof client.api.projects)[":projectId"]["users"][":userId"]["commits"]["$get"]>;

export type GetCommitsInput = { 
    projectId: RequestType["param"]["projectId"];
    userId: RequestType["param"]["userId"];
    repo: RequestType["query"]["repo"];
};

type NormalizedGetCommitsInput = { // handles edge case where RequestType becomes never
    projectId: GetCommitsInput["projectId"] extends never ? string : GetCommitsInput["projectId"];
    userId: GetCommitsInput["userId"] extends never ? string : GetCommitsInput["userId"];
    repo: GetCommitsInput["repo"] extends never ? string : GetCommitsInput["repo"];
};

export type GetCommitsResult = {
    data: unknown[];
    total?: number;
    backfill?: {
        fetchedFromGithub?: number;
        skippedExisting?: number;
        pagesFetched?: number;
        created?: number;
        updated?: number;
    };
    refreshInfo?: {
        newCommitsFound: number;
        previousTotal: number;
        currentTotal: number;
        fetched: number;
        created: number;
        skipped: number;
        pagesFetched: number;
        reconcileRepaired?: number;
        reconcileFailures?: number;
        reconcileMissingRemaining?: number;
        newCommitFilesExported?: number;
        newCommitExportFailures?: number;
    };
};

export type FetchCommitsOptions = {
    refresh?: boolean;
    // re-export on disk files for commits already stored, which is slow
    reconcile?: boolean;
};

export const fetchGetCommits = async (
    { projectId, userId, repo }: NormalizedGetCommitsInput,
    options: boolean | FetchCommitsOptions = false
): Promise<GetCommitsResult> => {
    const resolved =
        typeof options === "boolean"
            ? { refresh: options, reconcile: false }
            : { refresh: options.refresh ?? false, reconcile: options.reconcile ?? false };

    const commitsEndpoint = client.api.projects[":projectId"].users[":userId"].commits as any;
    const res = await commitsEndpoint.$get({
        param: { projectId, userId },
        query: {
            repo,
            refresh: resolved.refresh ? "true" : "false",
            reconcile: resolved.reconcile ? "true" : "false",
        },
    });

    const json = await res.json();

    if (!res.ok) {
        const message = "error" in json ? json.error : `Failed to get commits: ${res.status}`;
        throw new Error(String(message));
    }

    if (!("data" in json)) {
        throw new Error("Invalid commits response");
    }

    return {
        data: json.data,
        total: "total" in json ? json.total : undefined,
        backfill: "backfill" in json ? json.backfill : undefined,
        refreshInfo: "refreshInfo" in json ? json.refreshInfo : undefined,
    };
};

export const useGetCommits = ({ projectId, userId, repo }: NormalizedGetCommitsInput) => {
    const query = useQuery({
        queryKey: ["projects", projectId, "users", userId, "commits", repo],
        enabled: !!projectId && !!userId && !!repo,
        queryFn: async () => {
            try {
                return await fetchGetCommits({ projectId, userId, repo });
            } catch (error) {
                toast.error("Failed to fetch commits");
                throw error;
            }
        },
    });
    return query;
};

export const useRefreshCommits = () => {
    const queryClient = useQueryClient();

    const refreshCommits = async ({ projectId, userId, repo }: NormalizedGetCommitsInput) => {
        try {
            const result = await fetchGetCommits({ projectId, userId, repo }, { refresh: true, reconcile: false });
            
            await queryClient.invalidateQueries({
                queryKey: ["projects", projectId, "users", userId, "commits", repo],
            }); // invalidating the main query to refetch

            if (result.refreshInfo) {
                const toastResult = describeCommitSyncResultToast(result.refreshInfo, {});
                if (toastResult.tone === "info") {
                    toast.info(toastResult.message);
                } else {
                    toast.success(toastResult.message);
                }
            }

            return result;
        } catch (error) {
            console.error("Failed to refresh commits:", error);
            return null;
        }
    };

    return { refreshCommits };
};
