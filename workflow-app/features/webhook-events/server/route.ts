import { Hono } from "hono";
import PocketBase from 'pocketbase';
import { sessionMiddleware } from "@/lib/session-middleware";
import { webhookEventsSchema } from "../schemas";
import { syncCommitFilesToSelectedRoot, type EnrichedCommitPayload } from "../../commits/server/github-commits-utils";

const webhookEventsApp = new Hono()
    .get("/", sessionMiddleware, async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const projectId = c.req.param("projectId");
        const memberId = c.req.param("memberId");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        await pb.collection("members").getFirstListItem(
            `user = "${account.id}" && project = "${projectId}"`
        );

        let events;
        try { // querying without project field to avoid breaking if field doesn't exist on old records
            events = await pb.collection("webhook_events").getFullList({
                filter: `member = "${memberId}"`,
                sort: "-created",
            });
            console.log(`Found ${events.length} total events for member=${memberId}`);
            
            if (projectId) { // filtering to only this project in memory
                events = events.filter((e: any) => !e.project || e.project === projectId);
                console.log(`Filtered to ${events.length} events for project=${projectId}`);
            }
        } catch (error: any) {
            console.error(`Error querying webhook events:`, error?.message);
            throw error;
        }

        return c.json({ data: events });
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
        const memberId = c.req.param("memberId");
        console.log(`Processing ${event} event for repo=${repo}, projectId=${projectId}, memberId=${memberId}`);
        try {
            if (event === "push" && Array.isArray(data.commits)) {
                console.log(`Processing push event with ${data.commits.length} commits`);
                // push payloads are normalized into commit records only to avoid duplicate push+commit entries as part of a previous commit bug
                const [owner, repoName] = repo.split("/");
                const credential = await pb.collection("credentials").getFirstListItem(
                    `member = "${memberId}" && api_keys.owner = "${owner}" && api_keys.repo = "${repoName}"`
                );

                for (const commit of data.commits) {
                    const normalizedCommitPayload = {
                        ...commit,
                        sha: commit.id,
                        branch: data?.ref ? String(data.ref).replace("refs/heads/", "") : "Unknown",
                        pusher: data?.pusher?.name || data?.sender?.login,
                        sender_login: data?.sender?.login || commit?.author?.username || commit?.author?.name,
                        compare: data?.compare,
                    };

                    const existing = await pb.collection("webhook_events").getList(1, 1, {
                        filter: `member="${memberId}" && repository="${repo}" && event_type="commit" && payload.sha="${commit.id}"`,
                    });

                    if (existing.totalItems === 0) {
                        const createPayload: any = {
                            member: memberId,
                            event_type: "commit",
                            repository: repo,
                            payload: normalizedCommitPayload,
                        };
                        if (projectId) {
                            createPayload.project = projectId;
                        }
                        const created = await pb.collection("webhook_events").create(createPayload);
                        console.log(`Created webhook event for commit ${commit.id}, record id=${created.id}`);
                    } else {
                        const updated = await pb.collection("webhook_events").update(existing.items[0].id, {
                            payload: normalizedCommitPayload,
                        });
                        console.log(`Updated webhook event for commit ${commit.id}, record id=${updated.id}`);
                    }

                    try {
                        await syncCommitFilesToSelectedRoot({
                            repository: repo,
                            token: credential.api_keys.token,
                            commit: normalizedCommitPayload as EnrichedCommitPayload,
                            projectId,
                        });
                    } catch (error) {
                        console.error(`Failed to export webhook commit files for ${commit.id}:`, error);
                    }
                }

                return c.json({ success: true, normalized: "push_to_commit" }, 201);
            }

            const createPayload: any = {
                member: memberId,
                event_type: event,
                repository: repo,
                payload: data,
            };
            if (projectId) {
                createPayload.project = projectId;
            }
            const record = await pb.collection("webhook_events").create(createPayload);

            return c.json({ success: true, id: record.id }, 201);
        } catch (error) {
            console.error("Failed to store webhook event:", error);
            return c.json({ error: "Failed to store event" }, 500);
        }
    });

export default webhookEventsApp;