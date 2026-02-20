import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { loginSchema, registerSchema } from "../schemas";
import { createAdminClient } from "@/lib/pocketbase";
import { deleteCookie, setCookie } from "hono/cookie";
import { sessionMiddleware } from "@/lib/session-middleware";

const app = new Hono()
    .get("/current", sessionMiddleware, async (c) => {
        const account = c.get("account");
        
        return c.json({ data: account }); // sessionMiddleware validates the token and sets user on the context
    })
    .post("/login", zValidator("json", loginSchema), async (c) => {
        try{
            const { email, password } = c.req.valid("json");

            const pb = await createAdminClient();

            const session = await pb.collection('users').authWithPassword(email, password);

            setCookie(c, "pb_auth", session.token, {
                httpOnly: true,
                path: "/",
                sameSite: "Lax",
                maxAge: 60 * 60 * 24 * 30,
                secure: process.env.NODE_ENV === "production",
            });

            return c.json({success: true});
        } catch (error) {
            console.error("Register error:", error);
            if (error instanceof Error && 'response' in error) {
                console.error("PocketBase response:", (error as any).response);
            }
            return c.json({ error: (error as Error).message }, 400);
        }
    })
    .post("/register", zValidator("json", registerSchema), async (c) => {
        try{
            const { username, email, password } = c.req.valid("json");

            const pb = await createAdminClient();
            
            const user = await pb.collection('users').create({
                username,
                email,
                password,
                passwordConfirm: password,
            });

            const session = await pb.collection('users').authWithPassword(email, password);

            setCookie(c, "pb_auth", session.token, {
                httpOnly: true,
                path: "/",
                sameSite: "Lax",
                maxAge: 60 * 60 * 24 * 30,
                secure: process.env.NODE_ENV === "production",
            });

            return c.json(user);
        } catch (error) {
            console.error("Register error:", error);
            if (error instanceof Error && 'response' in error) {
                console.error("PocketBase response:", (error as any).response);
            }
            return c.json({ error: (error as Error).message }, 400);
        }
    })
    .post("/logout", sessionMiddleware, async (c) => {
        const pb = c.get("pb");
        
        // this clears the authentication state and removes the cookie
        pb.authStore.clear();
        deleteCookie(c, "pb_auth");
        
        return c.json({success: true});
    })
    .post("/oauth/callback", async (c) => {
        try {
            const { token } = await c.req.json();

            setCookie(c, "pb_auth", token, {
                httpOnly: true,
                path: "/",
                sameSite: "Lax",
                maxAge: 60 * 60 * 24 * 30,
                secure: process.env.NODE_ENV === "production",
            });

            return c.json({ success: true });
        } catch (error) {
            return c.json({ error: "Failed to set cookie" }, 400);
        }
    });

export default app;