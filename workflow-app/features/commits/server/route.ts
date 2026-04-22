import { Hono } from "hono";
import { sessionMiddleware } from "@/lib/session-middleware";
import { zValidator } from "@hono/zod-validator";
import { getCommitsQuerySchema } from "../schemas";
import { enrichCommitWithDetails, getNextLinkUrl, githubHeaders, hasCommitFilesExport, syncCommitFilesToSelectedRoot, type GithubCommitSummary } from "./github-commits-utils";

const mapCommitPayload = (payload: any) => ({
    sha: payload?.sha,
    message: payload?.commit?.message,
    author_name: payload?.commit?.author?.name,
    author_email: payload?.commit?.author?.email,
    author_date: payload?.commit?.author?.date,
    url: payload?.html_url,
});


const commitsApp = new Hono()
    .get("/", sessionMiddleware, zValidator("query", getCommitsQuerySchema), async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const projectId = c.req.param("projectId");
        const memberId = c.req.param("memberId");
        const { repo, refresh } = c.req.valid("query");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        await pb.collection("members").getFirstListItem(
            `user = "${account.id}" && project = "${projectId}" && id = "${memberId}"`
        );

        const initialEvents = await pb.collection("webhook_events").getFullList({
            filter: `member="${memberId}" && repository="${repo}" && event_type="commit"`,
            sort: "-created",
        });
        
        const initialCount = initialEvents.length;
        let backfillInfo: any = null;
        let allEvents = initialEvents;

        if (refresh === "true") { // refresh=true, fetch new commits from github
            const [owner, repoName] = repo.split("/");
            const credential = await pb.collection("credentials").getFirstListItem(
                `member = "${memberId}" && api_keys.owner = "${owner}" && api_keys.repo = "${repoName}"`
            );
            const token = credential.api_keys.token;

            let defaultBranch: string | undefined;
            try {
                const repositoryRes = await fetch(`https://api.github.com/repos/${repo}`, {
                    headers: githubHeaders(token),
                });
                if (repositoryRes.ok) {
                    const repositoryData = await repositoryRes.json();
                    defaultBranch = repositoryData?.default_branch;
                }
            } catch {
                defaultBranch = undefined;
            }

            const existingEvents = await pb.collection("webhook_events").getFullList({
                filter: `member="${memberId}" && repository="${repo}" && event_type="commit"`,
                fields: "id,payload",
            });

            const existingBySha = new Map<string, string>();
            for (const event of existingEvents as any[]) {
                const existingSha = event?.payload?.sha;
                if (existingSha) {
                    existingBySha.set(existingSha, event.id);
                }
            }

            const githubPageSize = 100;
            let pagesFetched = 0;
            let nextUrl: string | null = `https://api.github.com/repos/${repo}/commits?per_page=${githubPageSize}&page=1`;
            const githubCommits: GithubCommitSummary[] = [];

            const knownShas = new Set<string>(existingBySha.keys());

            while (nextUrl) {
                const githubRes = await fetch(nextUrl, {
                    headers: githubHeaders(token),
                });
                pagesFetched += 1;

                if (!githubRes.ok) {
                    const error = await githubRes.text();
                    return c.json(
                        {
                            error: `Error: ${githubRes.status} - ${error}`,
                        },
                        githubRes.status as any
                    );
                }

                const commitsPage = await githubRes.json();
                if (!Array.isArray(commitsPage) || commitsPage.length === 0) {
                    break;
                }

                const missingCommitsInPage = commitsPage.filter((commitSummary: GithubCommitSummary) => {
                    const commitSha = commitSummary?.sha;
                    return !!commitSha && !knownShas.has(commitSha);
                });

                const existingCommitsInPage = commitsPage.filter((commitSummary: GithubCommitSummary) => {
                    const commitSha = commitSummary?.sha;
                    return !!commitSha && knownShas.has(commitSha);
                });

                for (const commitSummary of missingCommitsInPage) {
                    knownShas.add(commitSummary.sha);
                }

                githubCommits.push(...missingCommitsInPage); // adding to pocketbase only the missing commits

                for (const commitSummary of existingCommitsInPage) {
                    const commitSha = commitSummary?.sha;
                    if (!commitSha) {
                        continue;
                    }

                    const alreadyExported = await hasCommitFilesExport(repo, commitSha);
                    if (alreadyExported) {
                        continue;
                    }

                    try {
                        const normalizedCommit = await enrichCommitWithDetails({
                            owner,
                            repoName,
                            sha: commitSha,
                            summary: commitSummary,
                            token,
                            defaultBranch,
                        });

                        await syncCommitFilesToSelectedRoot({
                            repository: repo,
                            token,
                            commit: normalizedCommit,
                            projectId,
                        });
                    } catch (error) {
                        console.error(`Failed to reconcile local commit files for ${commitSha}:`, error);
                    }
                }

                if (missingCommitsInPage.length === 0 && knownShas.size > 0) {
                    break;
                }

                nextUrl = getNextLinkUrl(githubRes.headers.get("link"));
            }

            let createdCount = 0;

            for (const commitSummary of githubCommits) {
                const commitSha = commitSummary?.sha;
                if (!commitSha) {
                    continue;
                }

                const normalizedCommit = await enrichCommitWithDetails({
                    owner,
                    repoName,
                    sha: commitSha,
                    summary: commitSummary,
                    token,
                    defaultBranch,
                });

                await pb.collection("webhook_events").create({
                    member: memberId,
                    project: projectId,
                    event_type: "commit",
                    repository: repo,
                    payload: normalizedCommit,
                });

                try {
                    await syncCommitFilesToSelectedRoot({
                        repository: repo,
                        token,
                        commit: normalizedCommit,
                        projectId,
                    });
                } catch (error) {
                    console.error(`Failed to export refreshed commit files for ${commitSha}:`, error);
                }

                createdCount += 1;
            }

            backfillInfo = {
                newCommitsAdded: createdCount,
                pagesFetched,
            };

            allEvents = await pb.collection("webhook_events").getFullList({
                filter: `member="${memberId}" && repository="${repo}" && event_type="commit"`,
                sort: "-created",
            }); // refreshing allEvents after creating new entries
        }
        
        const commits = (allEvents as any[]).map((ev: any) => mapCommitPayload(ev.payload));

        const response: any = {
            data: commits,
            total: commits.length,
        };

        if (backfillInfo) {
            response.refreshInfo = {
                ...backfillInfo,
                newCommitsFound: backfillInfo.created,
                previousTotal: initialCount,
                currentTotal: commits.length,
            };
        }

        return c.json(response);
    });

export default commitsApp;