import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { sessionMiddleware } from "@/lib/session-middleware";
import { createCredentialsSchema } from "../schemas";

const credentialsApp = new Hono()
    .post("/", sessionMiddleware, zValidator("json", createCredentialsSchema), async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const memberId = c.req.param("memberId");
        const data = c.req.valid("json");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        if (!memberId) {
            return c.json({ error: "Member is required" }, 400);
        }

        try {
            const member = await pb.collection("members").getOne(memberId, { expand: "user,project" }); // the auth user is the member
            if (member.user !== account.id) {
                return c.json({ error: "You do not have access to this member's credentials" }, 403);
            }

            const credentials = await pb.collection("credentials").create({
                name: data.name,
                member: memberId,
                api_keys: data.api_keys,
                api_limitations: data.api_limitations,
            });

            return c.json({ data: credentials }, 201);
        } catch (error) {
            console.error("Failed to create credential:", error);
            return c.json({ error: "Failed to create credential" }, 500);
        }
    });

export default credentialsApp;