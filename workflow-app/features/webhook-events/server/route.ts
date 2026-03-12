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
        try {
            events = await pb.collection("webhook_events").getFullList({
                filter: `member = "${memberId}" && project = "${projectId}"`,
                sort: "-created",
            });
        } catch (error: any) {
            if (error?.status !== 400) {
                throw error;
            }

            events = await pb.collection("webhook_events").getFullList({
                filter: `member = "${memberId}"`,
                sort: "-created",
            });
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
            return c.json({ error: "Invalid payload" }, 400);
        }

        const { event, repo, data } = parsed.data;
        const projectId = c.req.param("projectId");
        const memberId = c.req.param("memberId");
        try {
            if (event === "push" && Array.isArray(data.commits)) {
                // push payloads are normalized into commit records only to avoid duplicate push+commit entries as part of a previous commit bug
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
                        await pb.collection("webhook_events").create({
                            member: memberId,
                            event_type: "commit",
                            repository: repo,
                            payload: normalizedCommitPayload,
                        });
                    } else {
                        await pb.collection("webhook_events").update(existing.items[0].id, {
                            payload: normalizedCommitPayload,
                        });
                    }

                    const [owner, repoName] = repo.split("/");
                    const credential = await pb.collection("credentials").getFirstListItem(
                        `member = "${memberId}" && api_keys.owner = "${owner}" && api_keys.repo = "${repoName}"`
                    );

                    try {
                        await syncCommitFilesToSelectedRoot({
                            repository: repo,
                            token: credential.api_keys.token,
                            commit: normalizedCommitPayload as EnrichedCommitPayload,
                        });
                    } catch (error) {
                        console.error(`Failed to export webhook commit files for ${commit.id}:`, error);
                    }
                }

                return c.json({ success: true, normalized: "push_to_commit" }, 201);
            }

            const record = await pb.collection("webhook_events").create({
                member: memberId,
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