import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { loginSchema, registerSchema } from "../schemas";
import { createAdminClient } from "@/lib/pocketbase";
import { deleteCookie, setCookie } from "hono/cookie";

const app = new Hono()
    .post("/login", zValidator("json", loginSchema), async (c) => {
        try{
            const { email, password } = c.req.valid("json");

            const pb = await createAdminClient();

            const session = await pb.collection('users').authWithPassword(email, password);

            setCookie(c, "pb_auth", session.token, {
                httpOnly: true,
                path: "/",
                sameSite: "strict",
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
                sameSite: "strict",
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
    .post("/logout", (c) => {
        deleteCookie(c, "pb_auth");

        return c.json({success: true});
    });

export default app;