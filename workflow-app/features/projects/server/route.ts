import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { sessionMiddleware } from "@/lib/session-middleware";
import { createProjectSchema, createMemberSchema, bulkCreateMembersSchema } from "../schemas";
import type { ProjectsResponse, MembersResponse } from "@/pocketbase-types";
import { ProjectRole } from "../constants";

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

        await pb.collection("members").create({
            project: project.id,
            user: account.id,
            role: ProjectRole.ADMIN,
        });

        return c.json({ data: project });
    })
    // add a single member
    // .post("/:projectId/create-member", sessionMiddleware, zValidator("json", createMemberSchema), async (c) => {
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
    .get("/:projectId/members", sessionMiddleware, async (c) => {
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
    .post("/:projectId/members/create-bulk", sessionMiddleware, zValidator("json", bulkCreateMembersSchema), async (c) => {
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

        const memberships = await pb.collection('members').getFullList({
            filter: `user = "${account.id}"`,
            expand: 'project',
        });

        const ownedProjects = await pb.collection('projects').getFullList({
            filter: `owner = "${account.id}"`,
        });

        const memberProjects = memberships.map((m) => m.expand?.project).filter(Boolean);
        const combined = [...ownedProjects, ...memberProjects];
        const unique = Array.from(new Map(combined.map(p => [p.id, p])).values());

        return c.json<{ data: ProjectsResponse[] }>({ data: unique });
        // return c.json({ data: unique });
    })
    .get("/:projectId", sessionMiddleware, async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const projectId = c.req.param("projectId");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        // const project = await pb.collection("projects").getOne<ProjectsResponse>(projectId);
        const project = await pb.collection("projects").getOne(projectId);
        if (!project) {
            return c.json({ error: "Not found" }, 404);
        }

        if (project.owner === account.id) {
            // return c.json<{ data: ProjectsResponse }>({ data: project });
            return c.json({ data: project });
        }

        try {
            await pb.collection("members").getFirstListItem(
                `user = "${account.id}" && project = "${projectId}"`
            );
            //return c.json<{ data: ProjectsResponse }>({ data: project });
            return c.json({ data: project });
        } catch {
            return c.json({ error: "Forbidden" }, 403);
        }
    });

export default app;