import { useQuery, useQueryClient } from "@tanstack/react-query";
import { InferRequestType } from "hono";
import { client } from "@/lib/rpc";
import { toast } from "sonner";

type RequestType = InferRequestType<(typeof client.api.projects)[":projectId"]["members"][":memberId"]["commits"]["$get"]>;

export type GetCommitsInput = { 
    projectId: RequestType["param"]["projectId"];
    memberId: RequestType["param"]["memberId"];
    repo: RequestType["query"]["repo"];
};

type NormalizedGetCommitsInput = { // handles edge case where RequestType becomes never
    projectId: GetCommitsInput["projectId"] extends never ? string : GetCommitsInput["projectId"];
    memberId: GetCommitsInput["memberId"] extends never ? string : GetCommitsInput["memberId"];
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
    };
};

export const fetchGetCommits = async ({ projectId, memberId, repo }: NormalizedGetCommitsInput, refresh: boolean = false): Promise<GetCommitsResult> => {
    const commitsEndpoint = client.api.projects[":projectId"].members[":memberId"].commits as any;
    const res = await commitsEndpoint.$get({
        param: { projectId, memberId },
        query: { repo, refresh: refresh ? "true" : "false" },
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

export const useGetCommits = ({ projectId, memberId, repo }: NormalizedGetCommitsInput) => {
    const query = useQuery({
        queryKey: ["projects", projectId, "members", memberId, "commits", repo],
        enabled: !!projectId && !!memberId && !!repo,
        queryFn: async () => {
            try {
                return await fetchGetCommits({ projectId, memberId, repo });
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

    const refreshCommits = async ({ projectId, memberId, repo }: NormalizedGetCommitsInput) => {
        try {
            const result = await fetchGetCommits({ projectId, memberId, repo }, true);
            
            await queryClient.invalidateQueries({
                queryKey: ["projects", projectId, "members", memberId, "commits", repo],
            }); // invalidating the main query to refetch

            if (result.refreshInfo && result.refreshInfo.newCommitsFound > 0) {
                toast.success(`Found ${result.refreshInfo.newCommitsFound} new commit${result.refreshInfo.newCommitsFound > 1 ? 's' : ''}!`);
            }

            return result;
        } catch (error) {
            console.error("Failed to refresh commits:", error);
            return null;
        }
    };

    return { refreshCommits };
};

export const useRefreshAllCommits = () => {
    const queryClient = useQueryClient();

    const refreshAllMemberCommits = async (projectId: string, members: Array<{ id: string }>) => { // for each member, there's no need to get their credentials and refresh but since we don't have credentials data in members, letting the webhook-events endpoint handle finding their repos is a solution
        try {
            const refreshPromises: Promise<any>[] = [];

            for (const member of members) { // fetch credentials for this member to get the repo
                try {
                    const credResponse = await fetch(`/api/projects/${projectId}/members/${member.id}/credentials`);
                    if (credResponse.ok) {
                        const { data: credential } = await credResponse.json();
                        if (credential?.api_keys?.owner && credential?.api_keys?.repo) {
                            const repo = `${credential.api_keys.owner}/${credential.api_keys.repo}`;
                            refreshPromises.push(
                                fetchGetCommits({ projectId, memberId: member.id, repo }, true)
                            );
                        }
                    }
                } catch (error) {
                    console.error(`Failed to get credentials for member ${member.id}:`, error);
                }
            }

            if (refreshPromises.length === 0) {
                return [];
            }

            const results = await Promise.allSettled(refreshPromises);
            
            await queryClient.invalidateQueries({
                queryKey: ["projects", projectId, "members"],
            });

            let totalNewCommits = 0;
            results.forEach(result => {
                if (result.status === "fulfilled" && result.value?.refreshInfo?.newCommitsFound) {
                    totalNewCommits += result.value.refreshInfo.newCommitsFound;
                }
            }); // counting new commits found

            if (totalNewCommits > 0) {
                toast.success(`Found ${totalNewCommits} new commit${totalNewCommits > 1 ? 's' : ''}`);
            }

            return results;
        } catch (error) {
            console.error("Failed to refresh all commits:", error);
            return [];
        }
    };

    return { refreshAllMemberCommits };
};