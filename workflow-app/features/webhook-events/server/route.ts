import { Hono } from "hono";
import PocketBase from 'pocketbase';
import { sessionMiddleware } from "@/lib/session-middleware";
import { webhookEventsSchema } from "../schemas";
import { syncCommitFilesToSelectedRoot, type EnrichedCommitPayload } from "../../commits/server/github-commits-utils";
import { resolveProjectIntegrationContext } from "@/features/project-sharing/lib/project-access";
import { getPocketBaseForIntegrationData } from "@/features/project-sharing/lib/integration-pocketbase";
import { buildCommitWebhookEventDedupFilter } from "../lib/project-scope";
import { listWebhookEventsForProject } from "../lib/list-webhook-events-for-project";
import {
    executeDedupeCommitEvents,
    planDedupeCommitEvents,
} from "../lib/dedupe-commit-events";

const webhookEventsApp = new Hono()
    .get("/", sessionMiddleware, async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const projectId = c.req.param("projectId");
        const userId = c.req.param("userId");

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

        let events;
        try {
            const eventsPb = await getPocketBaseForIntegrationData(
                pb,
                integration,
                account.id
            );

            events = await listWebhookEventsForProject(
                eventsPb,
                integration.integrationUserId,
                projectId,
                { allowLegacyRepositoryMatch: true }
            );
            console.log(
                `Found ${events.length} events for user=${integration.integrationUserId}, project=${projectId}, owner=${integration.isOwner}`
            );
        } catch (error: any) {
            console.error(`Error querying webhook events:`, error?.message);
            throw error;
        }

        return c.json({ data: events });
    })
    .post("/dedupe-commit-events", sessionMiddleware, async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const projectId = c.req.param("projectId");
        const userId = c.req.param("userId");

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

        if (!integration.isOwner) {
            return c.json(
                { error: "Only the project owner can clean duplicate commit records" },
                403
            );
        }

        const eventsPb = await getPocketBaseForIntegrationData(pb, integration, account.id);
        const events = await listWebhookEventsForProject(
            eventsPb,
            integration.integrationUserId,
            projectId,
            { allowLegacyRepositoryMatch: true }
        );

        const plan = planDedupeCommitEvents(events);

        if (plan.duplicateRecordCount === 0) {
            return c.json({
                data: {
                    commitRecordCount: plan.commitRecordCount,
                    uniqueCommitCount: plan.uniqueCommitCount,
                    duplicateRecordCount: 0,
                    deleted: 0,
                    failed: 0,
                },
            });
        }

        const { deleted, failed } = await executeDedupeCommitEvents(eventsPb, plan);

        return c.json({
            data: {
                commitRecordCount: plan.commitRecordCount,
                uniqueCommitCount: plan.uniqueCommitCount,
                duplicateRecordCount: plan.duplicateRecordCount,
                deleted,
                failed,
            },
        });
    })
    .post("/", async (c) => { // this endpoint no longer uses sessionMiddleware, since it's authenticated by the shared WEBHOOK_SECRET_TOKEN only
        const pb = new PocketBase(process.env.POCKETBASE_URL);
        pb.authStore.save(process.env.POCKETBASE_SERVICE_TOKEN!, null);

        const authHeader = c.req.header("Authorization");
        const token = authHeader?.replace("Bearer ", "");
        if (token !== process.env.WEBHOOK_SECRET_TOKEN) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        const rawBody = await c.req.text();
        console.log("Raw body:", rawBody);
        const body = JSON.parse(rawBody);
        const parsed = webhookEventsSchema.safeParse(body);
        if (!parsed.success) {
            console.log("Parse failed:", parsed.error);
            return c.json({ error: "Invalid payload" }, 400);
        }

        const { event, repo, data } = parsed.data;
        const projectId = c.req.param("projectId");
        const userId = c.req.param("userId");

        if (!userId) {
            return c.json({ error: "User is required" }, 400);
        }

        if (!projectId) {
            return c.json({ error: "Project is required" }, 400);
        }

        console.log(`Processing ${event} event for repo=${repo}, projectId=${projectId}, userId=${userId}`);

        try {
            if (event === "push" && Array.isArray(data.commits)) {
                console.log(`Processing push event with ${data.commits.length} commits`);
                // push payloads are normalized into commit records only to avoid duplicate push+commit entries as part of a previous commit bug
                const [owner, repoName] = repo.split("/");
                if (!owner || !repoName) {
                    return c.json({ error: "Invalid repository format" }, 400);
                }

                const credential = await pb.collection("credentials").getFirstListItem(
                    `user = "${userId}" && api_keys.owner = "${owner}" && api_keys.repo = "${repoName}"`
                );
                const credentialToken = (credential.api_keys as { token?: string } | undefined)?.token;
                if (!credentialToken) {
                    return c.json({ error: "Credential token not found" }, 400);
                }

                for (const commit of data.commits) {
                    const commitSha = typeof commit?.id === "string" ? commit.id : "";
                    if (!commitSha) {
                        continue;
                    }

                    const normalizedCommitPayload = {
                        ...commit,
                        sha: commitSha,
                        branch: data?.ref ? String(data.ref).replace("refs/heads/", "") : "Unknown",
                        pusher: data?.pusher?.name || data?.sender?.login,
                        sender_login: data?.sender?.login || commit?.author?.username || commit?.author?.name,
                        compare: data?.compare,
                    };

                    const existing = await pb.collection("webhook_events").getList(1, 1, {
                        filter: buildCommitWebhookEventDedupFilter(
                            userId,
                            projectId,
                            repo,
                            commitSha
                        ),
                    });

                    if (existing.totalItems === 0) {
                        const createPayload = {
                            user: userId,
                            project: projectId,
                            event_type: "commit",
                            repository: repo,
                            payload: normalizedCommitPayload,
                        };
                        const created = await pb.collection("webhook_events").create(createPayload);
                        console.log(`Created webhook event for commit ${commitSha}, record id=${created.id}`);
                    } else {
                        const updated = await pb.collection("webhook_events").update(existing.items[0].id, {
                            payload: normalizedCommitPayload,
                        });
                        console.log(`Updated webhook event for commit ${commitSha}, record id=${updated.id}`);
                    }

                    try {
                        await syncCommitFilesToSelectedRoot({
                            repository: repo,
                            token: credentialToken,
                            commit: normalizedCommitPayload as EnrichedCommitPayload,
                            userId,
                            projectId,
                        });
                    } catch (error) {
                        console.error(`Failed to export webhook commit files for ${commitSha}:`, error);
                    }
                }

                return c.json({ success: true, normalized: "push_to_commit" }, 201);
            }

            const record = await pb.collection("webhook_events").create({
                user: userId,
                project: projectId,
                event_type: event,
                repository: repo,
                payload: data,
            });

            return c.json({ success: true, id: record.id }, 201);
        } catch (error) {
            console.error("Failed to store webhook event:", error);
            return c.json({ error: "Failed to store event" }, 500);
        }
    });

export default webhookEventsApp;