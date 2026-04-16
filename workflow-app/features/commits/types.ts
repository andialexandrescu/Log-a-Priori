export type CommitIndexEntry = {
    sha: string;
    authorDate: string;
    previousSha: string | null;
    nextSha: string | null;
    author: string;
    message: string;
    added: string[];
    modified: string[];
    removed: string[];
};

export type CommitIndexRecord = {
    id?: string;
    member: string;
    project: string;
    repository: string;
    commits: CommitIndexEntry[];
    lastIndexedAt: string;
};
