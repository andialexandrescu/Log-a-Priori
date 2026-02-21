import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { sessionMiddleware } from "@/lib/session-middleware";
import { createProjectSchema, createMemberSchema, bulkCreateMembersSchema } from "../schemas";
import type { ProjectsResponse, MembersResponse } from "@/pocketbase-types";
import { z } from "zod";

const app = new Hono()
    .post("/", sessionMiddleware, zValidator("json", createProjectSchema), async (c) => { // sessionMiddleware validates the token and sets user on the context
        const pb = c.get("pb");
        const account = c.get("account");
        const { name, description } = c.req.valid("json");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        const project = await pb.collection('projects').create({
            name,
            description: description || "",
            owner: account.id,
        });

        return c.json({ data: project });
    })
    // add a single member
    .post("/:projectId/member", sessionMiddleware, zValidator("json", createMemberSchema), async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const projectId = c.req.param("projectId");
        const { userId, role } = c.req.valid("json");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        const project = await pb.collection("projects").getOne(projectId);
        if (project.owner !== account.id) {
            return c.json({ error: "Forbidden" }, 403);
        }

        const membership = await pb.collection("members").create({
            project: projectId,
            user: userId,
            role,
        });

        return c.json({ data: membership }, 201);
    })
    // bulk add members
    .post("/:projectId/member/bulk", sessionMiddleware, zValidator("json", bulkCreateMembersSchema), async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const projectId = c.req.param("projectId");
        const { members } = c.req.valid("json");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        const project = await pb.collection("projects").getOne(projectId);
        if (project.owner !== account.id) {
            return c.json({ error: "Forbidden" }, 403);
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
    .get("/", sessionMiddleware, async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        type MembershipWithExpand = MembersResponse<{ project: ProjectsResponse }>;

        const memberships = await pb.collection('members').getFullList<MembershipWithExpand>({
            filter: `user = "${account.id}"`,
            expand: 'project',
        });

        const projects = memberships.map((membership) => membership.expand?.project);

        return c.json<{ data: ProjectsResponse[] }>({ data: projects });
    });


export default app;