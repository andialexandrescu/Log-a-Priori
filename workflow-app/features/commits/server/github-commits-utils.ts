import { commitWebhookEventExists } from "@/features/webhook-events/lib/commit-sha";

export const githubHeaders = (token: string) => ({
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
});

export const getNextLinkUrl = (linkHeader: string | null) => {
    if (!linkHeader) {
        return null;
    }

    const links = linkHeader.split(",").map((part) => part.trim());
    for (const link of links) {
        const match = link.match(/<([^>]+)>;\s*rel="([^"]+)"/);
        if (match && match[2] === "next") {
            return match[1];
        }
    }

    return null;
};

export type GithubErrorPayload = {
    message?: string;
    documentation_url?: string;
    status?: string;
};

export const parseGithubErrorPayload = async (response: Response): Promise<GithubErrorPayload> => {
    try {
        const payload = await response.json();
        if (payload && typeof payload === "object") {
            return payload as GithubErrorPayload;
        }
    } catch {
    }

    try {
        const text = await response.text();
        return { message: text || undefined, status: String(response.status) };
    } catch {
        return { status: String(response.status) };
    }
};

export const mapGithubApiError = (responseStatus: number, payload: GithubErrorPayload) => {
    if (responseStatus === 401) {
        return { status: 401, message: "Invalid GitHub token" };
    }

    if (responseStatus === 404) {
        return {
            status: 404,
            message: "Repository not found or you do not have permission to configure webhooks or access this repository",
        };
    }

    return {
        status: 500,
        message: payload.message || "GitHub api request failed",
    };
};

export type GithubCommitFile = {
    status?: string;
    filename?: string;
};

export type GithubCommitSummary = {
    sha?: string;
    files?: GithubCommitFile[];
    parents?: Array<{
        sha?: string;
    }>;
    author?: {
        login?: string;
    };
    committer?: {
        login?: string;
    };
    commit?: {
        message?: string;
        author?: {
            name?: string;
            email?: string;
            date?: string;
        };
        committer?: {
            name?: string;
            email?: string;
            date?: string;
        };
    };
    [key: string]: unknown;
};

export type EnrichedCommitPayload = GithubCommitSummary & {
    branch: string;
    added: string[];
    modified: string[];
    removed: string[];
};

type EnrichAndStoreInitialCommitsInput = {
    pb: any;
    userId: string;
    repository: string;
    token: string;
    projectId?: string;
};

export type InitialBackfillResult = {
    fetchedFromGithub: number;
    created: number;
};

type EnrichCommitWithDetailsInput = {
    owner: string;
    repoName: string;
    sha: string;
    summary: GithubCommitSummary;
    token: string;
    defaultBranch?: string;
};

type SyncCommitFilesInput = {
    repository: string;
    token: string;
    commit: EnrichedCommitPayload;
    userId?: string;
    projectId?: string;
};

const getFileChangeArrays = (payload: GithubCommitSummary) => {
    const files = Array.isArray(payload?.files) ? payload.files : [];

    const added = files.filter((file) => file?.status === "added").map((file) => file?.filename).filter(Boolean);

    const modified = files.filter((file) => file?.status === "modified").map((file) => file?.filename).filter(Boolean);

    const removed = files.filter((file) => file?.status === "removed").map((file) => file?.filename).filter(Boolean);

    return {
        added: added as string[],
        modified: modified as string[],
        removed: removed as string[],
    };
};

const getPusherName = (payload: GithubCommitSummary) => {
    return (
        payload?.committer?.login ||
        payload?.author?.login ||
        payload?.commit?.committer?.name ||
        payload?.commit?.author?.name ||
        "Unknown"
    );
};

// per commit helper
export const enrichCommitWithDetails = async ({ owner, repoName, sha, summary, token, defaultBranch }: EnrichCommitWithDetailsInput): Promise<EnrichedCommitPayload> => {
    let detailedCommit: GithubCommitSummary = summary;
    try {
        const detailRes = await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/commits/${sha}`,
            { headers: githubHeaders(token) }
        );
        if (detailRes.ok) {
            const detailPayload: unknown = await detailRes.json();
            if (detailPayload && typeof detailPayload === "object") {
                detailedCommit = detailPayload as GithubCommitSummary;
            }
        }
    } catch {
        detailedCommit = summary;
    }

    const { added, modified, removed } = getFileChangeArrays(detailedCommit);
    const pusher = getPusherName(detailedCommit);

    return {
        ...detailedCommit,
        branch: defaultBranch || "Unknown",
        pusher,
        added,
        modified,
        removed,
    };
};

export const syncCommitFilesToSelectedRoot = async ({ repository, token, commit, userId, projectId }: SyncCommitFilesInput): Promise<void> => {
    const module = await import("./local-commit-file-sync");
    await module.syncCommitFilesToSelectedRoot({ repository, token, commit, userId, projectId });
};

export const hasCommitFilesExport = async (
    repository: string,
    sha: string,
    userId?: string,
    projectId?: string
): Promise<boolean> => {
    const module = await import("./local-commit-file-sync");
    return module.hasCommitFilesExport(repository, sha, userId, projectId);
};

// the backfill orchestrator calling enrichCommitWithDetails for each GithubCommitSummary
export const enrichAndStoreInitialCommits = async ({ pb, userId, repository, token, projectId }: EnrichAndStoreInitialCommitsInput): Promise<InitialBackfillResult> => {
    const [owner, repoName] = repository.split("/");
    console.log(`Starting initial backfill for ${repository}, projectId=${projectId}, userId=${userId}`);

    const githubCommits: GithubCommitSummary[] = [];

    let defaultBranch = "unknown";
    try {
        const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
            headers: githubHeaders(token),
        });
        if (repoRes.ok) {
            const repoData = await repoRes.json();
            defaultBranch = repoData?.default_branch || defaultBranch;
            console.log(`Fetched repo info, default branch=${defaultBranch}`);
        }
    } catch {
        defaultBranch = "unknown";
    }

    let nextUrl: string | null = `https://api.github.com/repos/${owner}/${repoName}/commits?per_page=100&page=1`;
    let pageCount = 0;
    while (nextUrl) {
        pageCount++;
        console.log(`Fetching commits page ${pageCount} from GitHub`);
        const commitsRes = await fetch(nextUrl, { headers: githubHeaders(token) });

        if (!commitsRes.ok) {
            throw new Error(`Initial 'create credential' commit backfill failed: ${commitsRes.status}`);
        }

        const commitsPage: unknown = await commitsRes.json();
        if (!Array.isArray(commitsPage) || commitsPage.length === 0) {
            break;
        }

        console.log(`Page ${pageCount} has ${(commitsPage as GithubCommitSummary[]).length} commits`);
        githubCommits.push(...(commitsPage as GithubCommitSummary[])); // initial credential backfill loads all previous commits
        nextUrl = getNextLinkUrl(commitsRes.headers.get("link"));
    }

    console.log(`Total commits fetched from GitHub: ${githubCommits.length}`);
    let createdCount = 0;

    for (const commitSummary of githubCommits) {
        const sha = commitSummary?.sha;
        if (!sha) {
            continue;
        }

        const normalizedCommit = await enrichCommitWithDetails({
            owner,
            repoName,
            sha,
            summary: commitSummary,
            token,
            defaultBranch,
        });

        try {
            const alreadyStored = await commitWebhookEventExists(
                pb,
                userId,
                repository,
                sha,
                projectId
            );

            if (!alreadyStored) {
                const createPayload: any = {
                    user: userId,
                    event_type: "commit",
                    repository,
                    payload: normalizedCommit,
                };

                if (projectId) {
                    createPayload.project = projectId;
                }

                const created = await pb.collection("webhook_events").create(createPayload);
                console.log(`Created webhook event for commit ${sha.substring(0, 7)}, record id=${created.id}`);
                createdCount += 1;
            } else {
                console.log(`Commit ${sha.substring(0, 7)} already exists, skipping`);
            }
        } catch (createError) {
            console.error(`Failed to create webhook event for ${sha}:`, createError);
            throw createError;
        }

        try {
            await syncCommitFilesToSelectedRoot({
                repository,
                token,
                commit: normalizedCommit,
                userId: userId,
                projectId,
            });
        } catch (error) {
            console.error(`Failed to export initial backfill commit files for ${sha}:`, error);
        }
    }

    console.log(`Initial backfill complete: created ${createdCount} webhook events`);
    return {
        fetchedFromGithub: githubCommits.length,
        created: createdCount,
    };
};