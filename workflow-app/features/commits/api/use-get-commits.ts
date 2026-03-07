import { useQuery } from "@tanstack/react-query";
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
        skippedExistingOrPush?: number;
        deletedAsPushDuplicates?: number;
        pagesFetched?: number;
        created?: number;
        updated?: number;
    };
};

export const fetchGetCommits = async ({ projectId, memberId, repo }: NormalizedGetCommitsInput): Promise<GetCommitsResult> => {
    const commitsEndpoint = client.api.projects[":projectId"].members[":memberId"].commits as any;
    const res = await commitsEndpoint.$get({
        param: { projectId, memberId },
        query: { repo },
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