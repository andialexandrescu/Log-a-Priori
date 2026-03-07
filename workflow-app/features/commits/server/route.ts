import { Hono } from "hono";
import { sessionMiddleware } from "@/lib/session-middleware";
import { zValidator } from "@hono/zod-validator";
import { getCommitsQuerySchema } from "../schemas";
import { enrichCommitWithDetails, getNextLinkUrl, githubHeaders, type GithubCommitSummary } from "./github-commits-utils";

const getPushPayloadShas = (payload: any) => { // during refresh commits backfill the sha extraction aims to help in filtering out existing stored push/ commit (event_type) payloads
    const shas: string[] = [];

    if (payload?.head_commit?.id) {
        shas.push(payload.head_commit.id);
    }

    if (Array.isArray(payload?.commits)) {
        for (const commit of payload.commits) {
            const sha = commit?.id || commit?.sha;
            if (sha) {
                shas.push(sha);
            }
        }
    }

    return shas;
};

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
        const { repo } = c.req.valid("query");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        await pb.collection("members").getFirstListItem(
            `user = "${account.id}" && project = "${projectId}" && id = "${memberId}"`
        );

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

        const existingCommitEvents = await pb.collection("webhook_events").getFullList({
            filter: `member="${memberId}" && repository="${repo}" && event_type="commit"`,
            fields: "id,payload",
        });

        const pushEvents = await pb.collection("webhook_events").getFullList({
            filter: `member="${memberId}" && repository="${repo}" && event_type="push"`,
            fields: "payload",
        });

        const pushShas = new Set<string>();
        for (const pushEvent of pushEvents as any[]) {
            for (const sha of getPushPayloadShas(pushEvent?.payload)) {
                pushShas.add(sha);
            }
        }

        let deletedAsPushDuplicates = 0;
        for (const commitEvent of existingCommitEvents as any[]) {
            const existingSha = commitEvent?.payload?.sha;
            if (existingSha && pushShas.has(existingSha)) {
                await pb.collection("webhook_events").delete(commitEvent.id); // cleanup historical duplicates from older behavior: commit events whose sha already exists in push payloads
                deletedAsPushDuplicates += 1;
            }
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

        const githubPageSize = 100; // represents internal github chunk size, clients still get all commits with no paging inputs
        let pagesFetched = 0;
        let nextUrl: string | null = `https://api.github.com/repos/${repo}/commits?per_page=${githubPageSize}&page=1`;
        const githubCommits: GithubCommitSummary[] = [];
        let skippedExistingOrPushCount = 0;

        const knownShas = new Set<string>([...pushShas, ...existingBySha.keys()]);

        while (nextUrl) {
            const githubRes = await fetch(nextUrl, {
                headers: githubHeaders(token),
            });
            pagesFetched += 1;

            if (!githubRes.ok) {
                const error = await githubRes.text();
                return c.json(
                    {
                        error: `GitHub API error: ${githubRes.status} - ${error}`,
                    },
                    githubRes.status as any
                );
            }

            const commitsPage = await githubRes.json();
            if (!Array.isArray(commitsPage) || commitsPage.length === 0) {
                break;
            }

            const skippedInPage = commitsPage.filter((commitSummary: GithubCommitSummary) => {
                const commitSha = commitSummary?.sha;
                return !!commitSha && knownShas.has(commitSha);
            }).length;
            skippedExistingOrPushCount += skippedInPage;

            const missingCommitsInPage = commitsPage.filter((commitSummary: GithubCommitSummary) => {
                const commitSha = commitSummary?.sha;
                return !!commitSha && !knownShas.has(commitSha);
            });

            for (const commitSummary of missingCommitsInPage) {
                knownShas.add(commitSummary.sha);
            }

            githubCommits.push(...missingCommitsInPage);

            if (missingCommitsInPage.length === 0 && knownShas.size > 0) {
                break; // stop once a full page contains only known shas
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
                event_type: "commit",
                repository: repo,
                payload: normalizedCommit,
            });
            createdCount += 1;
        }

        const allEvents = await pb.collection("webhook_events").getFullList({
            filter: `member="${memberId}" && repository="${repo}" && event_type="commit"`,
            sort: "-created",
        });
        const commits = (allEvents as any[]).map((ev: any) => mapCommitPayload(ev.payload));

        return c.json({
                data: commits,
                total: commits.length,
                backfill: {
                fetchedFromGithub: githubCommits.length,
                created: createdCount,
                updated: 0,
                skippedExistingOrPush: skippedExistingOrPushCount,
                deletedAsPushDuplicates,
                pagesFetched,
            },
        });
    });

export default commitsApp;