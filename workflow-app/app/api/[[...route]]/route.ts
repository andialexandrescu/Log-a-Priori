import { Hono } from "hono";
import { handle } from "hono/vercel";
import auth from "@/features/auth/server/route";
import projects from "@/features/projects/server/route";
import credentialsApp from "@/features/credentials/server/route";
import webhookEventsApp from "@/features/webhook-events/server/route";
import commitsApp from "@/features/commits/server/route";
import knowledgeGraphApp from "@/features/knowledge-graph/server/route";
import projectSharingApp from "@/features/project-sharing/server/route";
import incomingSharingApp from "@/features/project-sharing/server/incoming-route";

const app = new Hono().basePath("/api");

const routes = app
    .route("/auth", auth)
    .route("/projects", projects)
    .route("/project-shares", incomingSharingApp)
    .route("/projects/:projectId/users/:userId/credentials", credentialsApp)
    .route("/projects/:projectId/users/:userId/webhook-events", webhookEventsApp)
    .route("/projects/:projectId/users/:userId/commits", commitsApp)
    .route("/projects/:projectId/knowledge-graph", knowledgeGraphApp)
    .route("/projects/:projectId/shares", projectSharingApp);
    
export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);

export type AppType = typeof routes;