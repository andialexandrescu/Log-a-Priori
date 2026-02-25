import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { sessionMiddleware } from "@/lib/session-middleware";
import { createMemberSchema, bulkCreateMembersSchema } from "../schemas";

const membersApp = new Hono()
    // add a single member
    // .post("/", sessionMiddleware, zValidator("json", createMemberSchema), async (c) => {
    //     const pb = c.get("pb");
    //     const account = c.get("account");
    //     const projectId = c.req.param("projectId");
    //     const { userId, role } = c.req.valid("json");

    //     if (!account) {
    //         return c.json({ error: "Unauthorized" }, 401);
    //     }

    //     const project = await pb.collection("projects").getOne(projectId);
    //     if (project.owner !== account.id) {
    //         return c.json({ error: "Forbidden" }, 403);
    //     }

    //     const membership = await pb.collection("members").create({
    //         project: projectId,
    //         user: userId,
    //         role,
    //     });

    //     return c.json({ data: membership }, 201);
    // })
    .get("/", sessionMiddleware, async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const projectId = c.req.param("projectId");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        await pb.collection("members").getFirstListItem(
            `user = "${account.id}" && project = "${projectId}"`
        );

        const members = await pb.collection("members").getFullList({
            filter: `project = "${projectId}"`,
            expand: "user",
        });

        // console.log("members expand:", members.map(m => m.expand?.user?.id));

        return c.json({ data: members });
    })
    // bulk add members
    .post("/bulk", sessionMiddleware, zValidator("json", bulkCreateMembersSchema), async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const projectId = c.req.param("projectId");
        const { members } = c.req.valid("json");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        if (!projectId) {
            return c.json({ error: "Project is required" }, 400);
        }


        const project = await pb.collection("projects").getOne(projectId);
        if (project.owner !== account.id) {
            return c.json({ error: "Forbidden" }, 403);
        }

        const existingMembers = await pb.collection("members").getFullList({
            filter: `project = "${projectId}"`,
        }); // this check is meant only after the project is created
        const existingUserIds = new Set(existingMembers.map((m) => m.user));

        for (const { userId } of members) {
            if (existingUserIds.has(userId)) {
                return c.json({ error: `User ${userId} already has a role in this project` }, 400);
            }
        }

        const createdMembers = [];
        for (const { userId, role } of members) {
            const membership = await pb.collection("members").create({
                project: projectId,
                user: userId,
                role,
            });
            createdMembers.push(membership);
        }

        return c.json({ data: createdMembers }, 201);
    })
    .get("/current", sessionMiddleware, async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const projectId = c.req.param("projectId");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        const member = await pb.collection("members").getFirstListItem(
            `project = "${projectId}" && user = "${account.id}"`
        );

        return c.json({ data: member });
    });

export default membersApp;