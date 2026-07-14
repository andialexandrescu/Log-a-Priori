import { Hono } from "hono";
import { sessionMiddleware } from "@/lib/session-middleware";
import { zValidator } from "@hono/zod-validator";
import { getCommitsQuerySchema } from "../schemas";
import { enrichCommitWithDetails, getNextLinkUrl, githubHeaders, syncCommitFilesToSelectedRoot, type GithubCommitSummary } from "./github-commits-utils";
import { reconcileCommitExports } from "./reconcile-commit-exports";
import { resolveProjectIntegrationContext } from "@/features/project-sharing/lib/project-access";
import { getPocketBaseForIntegrationData } from "@/features/project-sharing/lib/integration-pocketbase";
import { listWebhookEventsForProject } from "@/features/webhook-events/lib/list-webhook-events-for-project";
import {
    commitWebhookEventExists,
    countUniqueCommitShas,
    indexCommitShasByEvent,
} from "@/features/webhook-events/lib/commit-sha";

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
        const userId = c.req.param("userId");
        const { repo, refresh, reconcile } = c.req.valid("query");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        if (!userId) {
            return c.json({ error: "User is required" }, 400);
        }

        if (!projectId) {
            return c.json({ error: "Project is required" }, 400);
        }

        if (userId !== account.id) {
            return c.json({ error: "Forbidden" }, 403);
        }

        const integration = await resolveProjectIntegrationContext(pb, projectId, account.id);
        if (!integration.ok) {
            return c.json({ error: integration.error }, integration.status);
        }

        const integrationUserId = integration.integrationUserId;
        const integrationPb = await getPocketBaseForIntegrationData(
            pb,
            integration,
            account.id
        );

        const initialEvents = await listWebhookEventsForProject(
            integrationPb,
            integrationUserId,
            projectId,
            {
                repository: repo,
                eventType: "commit",
                allowLegacyRepositoryMatch: true,
            }
        );
        
        const initialCount = countUniqueCommitShas(initialEvents as Array<{ payload?: unknown; event_type?: string }>);
        let backfillInfo: any = null;
        let allEvents = initialEvents;

        if (refresh === "true") { // refresh=true, fetch new commits from github
            const [owner, repoName] = repo.split("/");
            const credential = await integrationPb.collection("credentials").getFirstListItem(
                `user = "${integrationUserId}" && api_keys.owner = "${owner}" && api_keys.repo = "${repoName}"`
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

            const existingEvents = await listWebhookEventsForProject(
                integrationPb,
                integrationUserId,
                projectId,
                {
                    repository: repo,
                    eventType: "commit",
                    allowLegacyRepositoryMatch: true,
                }
            );

            const existingBySha = indexCommitShasByEvent(existingEvents as any[]);

            const githubPageSize = 100;
            let pagesFetched = 0;
            let nextUrl: string | null = `https://api.github.com/repos/${repo}/commits?per_page=${githubPageSize}&page=1`;
            const githubCommits: GithubCommitSummary[] = [];

            const knownShas = new Set<string>(existingBySha.keys());

            let createdCount = 0;
            let reconcileRepaired = 0;
            let reconcileFailures = 0;
            let reconcileAlreadyPresent = 0;
            let reconcileMissingRemaining = 0;
            let reconcileChecked = 0;
            let newCommitFilesExported = 0;
            let newCommitExportFailures = 0;

            if (reconcile === "true") {
                const reconcileResult = await reconcileCommitExports({
                    repository: repo,
                    owner,
                    repoName,
                    token,
                    defaultBranch,
                    userId: account.id,
                    projectId,
                    events: existingEvents as any[],
                });
                reconcileRepaired = reconcileResult.repaired;
                reconcileFailures = reconcileResult.failures;
                reconcileAlreadyPresent = reconcileResult.alreadyPresent;
                reconcileMissingRemaining = reconcileResult.missingRemaining;
                reconcileChecked = reconcileResult.checked;
            }

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

                for (const commitSummary of missingCommitsInPage) {
                    knownShas.add(commitSummary.sha);
                }

                githubCommits.push(...missingCommitsInPage);

                // already caught up with github, stopping after one page (avoids scanning full history)
                if (missingCommitsInPage.length === 0 && knownShas.size > 0) {
                    break;
                }

                nextUrl = getNextLinkUrl(githubRes.headers.get("link"));
            }

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

                const alreadyStored = await commitWebhookEventExists(
                    integrationPb,
                    integrationUserId,
                    repo,
                    commitSha,
                    projectId
                );

                if (!alreadyStored) {
                    await integrationPb.collection("webhook_events").create({
                        user: integrationUserId,
                        project: projectId,
                        event_type: "commit",
                        repository: repo,
                        payload: normalizedCommit,
                    });
                    createdCount += 1;
                }

                try {
                    await syncCommitFilesToSelectedRoot({
                        repository: repo,
                        token,
                        commit: normalizedCommit,
                        userId: account.id,
                        projectId,
                    });
                    newCommitFilesExported += 1;
                } catch (error) {
                    newCommitExportFailures += 1;
                    console.error(`Failed to export refreshed commit files for ${commitSha}:`, error);
                }
            }

            backfillInfo = {
                newCommitsAdded: createdCount,
                pagesFetched,
                created: createdCount,
                reconcileRepaired,
                reconcileFailures,
                reconcileAlreadyPresent,
                reconcileMissingRemaining,
                reconcileChecked,
                newCommitFilesExported,
                newCommitExportFailures,
            };

            allEvents = await listWebhookEventsForProject(
                integrationPb,
                integrationUserId,
                projectId,
                {
                    repository: repo,
                    eventType: "commit",
                    allowLegacyRepositoryMatch: true,
                }
            );
        }
        
        const commits = (allEvents as any[]).map((ev: any) => mapCommitPayload(ev.payload));
        const uniqueCommitCount = countUniqueCommitShas(allEvents as Array<{ payload?: unknown; event_type?: string }>);

        const response: any = {
            data: commits,
            total: commits.length,
            uniqueCommitCount,
        };

        if (backfillInfo) {
            response.refreshInfo = {
                ...backfillInfo,
                newCommitsFound: backfillInfo.newCommitsAdded ?? backfillInfo.created ?? 0,
                previousTotal: initialCount,
                currentTotal: uniqueCommitCount,
                fetched: backfillInfo.pagesFetched ?? 0,
                created: backfillInfo.newCommitsAdded ?? backfillInfo.created ?? 0,
                skipped: Math.max(0, initialCount),
                pagesFetched: backfillInfo.pagesFetched ?? 0,
                reconcileRepaired: backfillInfo.reconcileRepaired ?? 0,
                reconcileFailures: backfillInfo.reconcileFailures ?? 0,
                reconcileAlreadyPresent: backfillInfo.reconcileAlreadyPresent ?? 0,
                reconcileMissingRemaining: backfillInfo.reconcileMissingRemaining ?? 0,
                reconcileChecked: backfillInfo.reconcileChecked ?? 0,
                newCommitFilesExported: backfillInfo.newCommitFilesExported ?? 0,
                newCommitExportFailures: backfillInfo.newCommitExportFailures ?? 0,
            };
        }

        return c.json(response);
    });

export default commitsApp;