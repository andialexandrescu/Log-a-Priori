import { Hono } from "hono";
import { sessionMiddleware } from "@/lib/session-middleware";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { ProjectRole } from "@/features/project-sharing/constants";
import { resolveProjectAccess } from "@/features/project-sharing/lib/project-access";

type ClusteringResponse = {
  clusterNodeIds: string[];
  clusterNodeNames: string[];
  seedNodeId: string;
  seedNodeName: string;
  clusterSize: number;
  semanticScore: number | null;
  metadata: {
    query: string | null;
    topKDGI: number;
    simThreshold: number | null;
    algorithm: string;
  };
};

export const clusteringRouter = new Hono();

clusteringRouter.use(sessionMiddleware);

function parseJsonOutput(stdout: string) {
  const trimmed = stdout.trim();
  if (!trimmed) {
    throw new Error("Empty clustering output");
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error(`Invalid clustering output: ${trimmed.slice(0, 200)}`);
  }
}

// raw ppr clustering
clusteringRouter.get("/raw-ppr", async (c) => {
  const DEFAULT_MAX_SCAN = 50;
  const DEFAULT_ITERATIONS = 30;

  const projectId = c.req.param("projectId");
  const pb = (c as any).get("pb");
  const account = (c as any).get("account");
  if (!account) return c.json({ error: "Unauthorized" }, 401);
  if (!projectId) return c.json({ error: "Missing projectId parameter" }, 400);

  const access = await resolveProjectAccess(pb, projectId, account.id, ProjectRole.VIEWER);
  if (!access.ok) {
    return c.json({ error: access.error }, access.status);
  }

  const query = c.req.query("query");
  if (!query) return c.json({ error: "Missing query parameter" }, 400);
  const safeProjectId = projectId;
  const safeQuery = query;

  const maxScan = parseInt(c.req.query("maxScan") || String(DEFAULT_MAX_SCAN), 10);
  const minK = parseInt(c.req.query("minK") || "1", 10);
  const alpha = parseFloat(c.req.query("alpha") || "0.85");
  const iterations = parseInt(c.req.query("iterations") || String(DEFAULT_ITERATIONS), 10);

  const scriptPath = path.resolve(process.cwd(), "scripts", "inference_raw_ppr.py");
  try {
    const result = spawnSync(
      "python",
      [scriptPath, safeProjectId, "query", safeQuery, String(maxScan), String(minK), String(alpha), String(iterations)],
      {
        encoding: "utf-8",
        cwd: path.dirname(scriptPath),
        env: {
          ...process.env,
          PROJECT_OWNER_USER_ID: access.userId,
        },
      }
    );

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      const errorOutput = (result.stderr || result.stdout || "").trim();
      throw new Error(errorOutput || "Failed to run clustering");
    }

    return c.json(parseJsonOutput(result.stdout), 200);
  } catch (error) {
    console.error("[RawPPR] Error:", error);
    return c.json({ error: "Failed to run clustering" }, 500);
  }
});

export default clusteringRouter;