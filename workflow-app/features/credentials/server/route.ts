import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { randomBytes } from "crypto";
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

            const webhookSecret = randomBytes(32).toString('hex');
            const credentials = await pb.collection("credentials").create({
                name: data.name,
                member: memberId,
                api_keys: {
                    ...data.api_keys,
                    webhookSecret, // add the generated secret
                },
                api_limitations: data.api_limitations,
            });

            const { token, owner, repo } = data.api_keys;
            const webhookUrl = process.env.AZURE_FUNCTION_URL;
            const githubRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks`, { // creates the webhook on github using the user's token and the generated secret
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: 'web',
                    active: true,
                    events: ['push', 'pull_request'],
                    config: {
                        url: webhookUrl,
                        content_type: 'json',
                        secret: webhookSecret,
                        insecure_ssl: '0',
                    },
                }),
            });

            if (!githubRes.ok) { // if the creation fails, the credential should be deleted
                const errorText = await githubRes.text();
                console.error('GitHub webhook creation failed:', errorText);
                await pb.collection("credentials").delete(credentials.id);
                return c.json({ error: "Failed to create GitHub webhook: " + errorText }, 500);
            }

            const webhookData = await githubRes.json();
            console.log('GitHub webhook created:', webhookData.id);

            return c.json({ data: credentials }, 201);
        } catch (error) {
            console.error("Failed to create credential:", error);
            return c.json({ error: "Failed to create credential" }, 500);
        }
    });

export default credentialsApp;