import { Hono } from "hono";
import PocketBase from 'pocketbase';
import { sessionMiddleware } from "@/lib/session-middleware";
import { webhookEventsSchema } from "../schemas";

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
            events = await pb.collection("webhook_events").getList(1, 20, {
                filter: `member = "${memberId}" && project = "${projectId}"`,
                sort: "-created",
            });
        } catch (error: any) {
            if (error?.status !== 400) {
                throw error;
            }

            events = await pb.collection("webhook_events").getList(1, 20, {
                filter: `member = "${memberId}"`,
                sort: "-created",
            });
        }

        return c.json({ data: events.items });
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
            const record = await pb.collection("webhook_events").create({
                member: memberId,
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