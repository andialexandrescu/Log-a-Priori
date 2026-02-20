import "server-only";
import PocketBase, { AuthRecord } from "pocketbase";
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";

type AdditionalContext = {
    Variables: {
        account: AuthRecord;
        pb: PocketBase;
    };
};

export const sessionMiddleware = createMiddleware<AdditionalContext>(
    async (c, next) => {
        const pb = new PocketBase(process.env.NEXT_PUBLIC_POCKETBASE_API_URL);

        const session = getCookie(c, "pb_auth");
        if (!session)
        {
            return c.json({ error: "Unauthorized" }, 401);
        }

        pb.authStore.save(session, null);

        try {
            await pb.collection("users").authRefresh();
        } catch {
            return c.json({ error: "Unauthorized" }, 401);
        }

        const account = pb.authStore.model;

        c.set("pb", pb);
        c.set("account", account);

        await next();
    },
);


