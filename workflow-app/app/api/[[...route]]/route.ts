import { Hono } from "hono";
import { handle } from "hono/vercel";
import auth from "@/features/auth/server/route";
import projects from "@/features/projects/server/route";
import membersApp from "@/features/members/server/route";
import credentialsApp from "@/features/credentials/server/route";
import webhookEventsApp from "@/features/webhook-events/server/route";

const app = new Hono().basePath("/api");

const routes = app
    .route("/auth", auth)
    .route("/projects", projects)
    .route("/projects/:projectId/members", membersApp)
    .route("/projects/:projectId/members/:memberId/credentials", credentialsApp)
    .route("/projects/:projectId/members/:memberId/webhook-events", webhookEventsApp);

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);

export type AppType = typeof routes;