import { useQuery } from "@tanstack/react-query";
import { InferRequestType } from "hono";
import { client } from "@/lib/rpc";
import { CommitIndexRecord } from "@/features/commits/types";

type CommitIndexRequestType = InferRequestType<(typeof client.api.projects)[":projectId"]["members"][":memberId"]["commits"]["index"]["$get"]>;

export type UseGetCommitIndexInput = {
    projectId: CommitIndexRequestType["param"]["projectId"];
    memberId: CommitIndexRequestType["param"]["memberId"];
    repository: CommitIndexRequestType["query"]["repo"];
};

type NormalizedUseGetCommitIndexInput = {
    projectId: UseGetCommitIndexInput["projectId"] extends never ? string : UseGetCommitIndexInput["projectId"];
    memberId: UseGetCommitIndexInput["memberId"] extends never ? string : UseGetCommitIndexInput["memberId"];
    repository: UseGetCommitIndexInput["repository"] extends never ? string : UseGetCommitIndexInput["repository"];
};

export const useGetCommitIndex = ({ projectId, memberId, repository }: NormalizedUseGetCommitIndexInput) => { // fetching commit indexes in order to get chronologically ordered commits
    const query = useQuery({
        queryKey: ["projects", projectId, "commit-index", memberId, repository],
        enabled: !!projectId && !!memberId && !!repository,
        queryFn: async () => {
            try {
                const url = `/api/projects/${projectId}/members/${memberId}/commits/index?repo=${encodeURIComponent(repository)}`;

                const res = await fetch(url);

                if (!res.ok) {
                    const text = await res.text();
                    console.error(`Commit index fetch failed: ${res.status}`, text);
                    const json = (() => {
                        try {
                            return JSON.parse(text);
                        } catch {
                            return { error: text };
                        }
                    })();
                    const message = "error" in json ? json.error : `Failed to get commit index: ${res.status}`;
                    throw new Error(String(message));
                }

                const json = await res.json();

                if (!("data" in json)) {
                    throw new Error("Invalid commit index response");
                }

                return json.data as CommitIndexRecord;
            } catch (error) {
                console.error("Failed to fetch commit index:", error);
                throw error;
            }
        },
    });

    return query;
};

export const useGetProjectCommitIndices = (projectId: string) => { // all available commit indices for a project
    const query = useQuery({
        queryKey: ["projects", projectId, "commit-indices"],
        enabled: !!projectId,
        queryFn: async () => {
            try {
                const url = `/api/projects/${projectId}/commit-indices`;
                const res = await fetch(url);

                if (!res.ok) {
                    const text = await res.text();
                    console.error(`Commit indices fetch failed: ${res.status}`, text);
                    const json = (() => {
                        try {
                            return JSON.parse(text);
                        } catch {
                            return { error: text };
                        }
                    })();
                    const message = "error" in json ? json.error : `Failed to get commit indices: ${res.status}`;
                    throw new Error(String(message));
                }

                const json = await res.json();

                if (!("data" in json)) {
                    throw new Error("Invalid commit indices response");
                }

                return json.data as CommitIndexRecord[];
            } catch (error) {
                console.error("Failed to fetch commit indices:", error);
                throw error;
            }
        },
    });

    return query;
};
