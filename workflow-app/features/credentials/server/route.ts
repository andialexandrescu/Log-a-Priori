import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { randomBytes } from "crypto";
import { sessionMiddleware } from "@/lib/session-middleware";
import { createCredentialsSchema } from "../schemas";
import { githubHeaders, mapGithubApiError, parseGithubErrorPayload } from "../../commits/server/github-commits-utils";
import { resolveProjectIntegrationContext } from "@/features/project-sharing/lib/project-access";
import {
    getPocketBaseForIntegrationData,
    resolveCredentialForProject,
} from "@/features/project-sharing/lib/integration-pocketbase";
import { clearProjectCommitIntegrationData } from "@/features/projects/lib/clear-project-commit-integration";
import { enrichAndStoreInitialCommits } from "@/features/commits/server/github-commits-utils";

const credentialsApp = new Hono()
    .get("/", sessionMiddleware, async (c) => { // get the github webhook credential for a user
        const pb = c.get("pb");
        const account = c.get("account");
        const userId = c.req.param("userId");
        const projectId = c.req.param("projectId");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        if (!userId) {
            return c.json({ error: "User is required" }, 400);
        }

        if (!projectId) {
            return c.json({ error: "Project is required" }, 400);
        }

        const integration = await resolveProjectIntegrationContext(pb, projectId, account.id);
        if (!integration.ok) {
            return c.json({ error: integration.error }, integration.status);
        }

        if (userId !== account.id && userId !== integration.integrationUserId) {
            return c.json({ error: "You do not have access to this user's credentials" }, 403);
        }

        try {
            const credentialPb = await getPocketBaseForIntegrationData(
                pb,
                integration,
                account.id
            );

            const credential = await resolveCredentialForProject(
                credentialPb,
                integration.integrationUserId,
                projectId
            );

            return c.json({
                data: credential,
                inherited: integration.isSharedRecipient,
            }, 200);
        } catch (error: any) {
            console.error("Failed to fetch credential:", error);
            return c.json({ error: "Failed to fetch credential" }, 500);
        }
    })
    .post("/", sessionMiddleware, zValidator("json", createCredentialsSchema), async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const userId = c.req.param("userId");
        const data = c.req.valid("json");

        if (!account) {
            console.log(`No account found`);
            return c.json({ error: "Unauthorized" }, 401);
        }

        if (!userId) {
            console.log(`No userId provided`);
            return c.json({ error: "User is required" }, 400);
        }

        if (userId !== account.id) {
            console.log(`User not owned by account`);
            return c.json({ error: "You do not have access to this user's credentials" }, 403);
        }

        const projectId = c.req.param("projectId");
        if (projectId) {
            const integration = await resolveProjectIntegrationContext(pb, projectId, account.id);
            if (integration.ok && integration.isSharedRecipient) {
                return c.json({
                    error: "Shared projects use the project owner's GitHub credentials",
                }, 403);
            }
        }

        try {
            console.log(`Creating credential record in db`);
            const webhookSecret = randomBytes(32).toString('hex');
            console.log(`api_keys data:`, {
                token: data.api_keys.token ? "***" : "MISSING",
                owner: data.api_keys.owner,
                repo: data.api_keys.repo,
            });
            const credentials = await pb.collection("credentials").create({
                user: userId,
                project: c.req.param("projectId"),
                api_keys: {
                    ...data.api_keys,
                    webhookSecret, // add the generated secret
                },
                api_limitations: data.api_limitations,
            });
            console.log(`Credential created: ${credentials.id}`, {
                api_keys_keys: Object.keys(credentials.api_keys || {}),
            });

            const { token, owner, repo } = data.api_keys;
            const webhookUrl = process.env.AZURE_FUNCTION_URL;
            console.log(`WebhookUrl: ${webhookUrl}`);
            
            if (!webhookUrl) {
                throw new Error("AZURE_FUNCTION_URL is not configured");
            }
            
            console.log(`Creating github webhook for ${owner}/${repo} with url: ${webhookUrl}`);
            
            const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
                headers: githubHeaders(token),
            });
            if (!repoRes.ok) {
                const payload = await parseGithubErrorPayload(repoRes);
                const mapped = mapGithubApiError(repoRes.status, payload);
                await pb.collection("credentials").delete(credentials.id);
                return c.json(
                    {
                        error: mapped.message,
                        github: {
                            status: repoRes.status,
                            message: payload.message,
                            documentation_url: payload.documentation_url,
                        },
                    },
                    mapped.status as 401 | 404 | 500
                );
            }

            const githubRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/hooks`, { // creates the webhook on github using the user's token and the generated secret
                method: 'POST',
                headers: {
                    Authorization: `token ${token}`,
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
                console.log(`GitHub webhook creation failed: ${githubRes.status}`);
                const payload = await parseGithubErrorPayload(githubRes);
                console.error('GitHub webhook creation failed:', payload);
                await pb.collection("credentials").delete(credentials.id);
                
                let errorMessage = "Failed to create GitHub webhook";
                let statusCode: 400 | 401 | 404 | 500 = 500;
                
                if (githubRes.status === 422) {
                    errorMessage = "Webhook configuration invalid, verify the webhook url is accessible";
                    statusCode = 400;
                } else {
                    const mapped = mapGithubApiError(githubRes.status, payload);
                    errorMessage = mapped.message;
                    statusCode = mapped.status as 401 | 404 | 500;
                }
                
                return c.json(
                    {
                        error: errorMessage,
                        github: {
                            status: githubRes.status,
                            message: payload.message,
                            documentation_url: payload.documentation_url,
                        },
                    },
                    statusCode
                );
            }

            const webhookData = await githubRes.json();
            console.log('GitHub webhook created:', webhookData.id);

            // backfill will happen automatically via auto refresh when project mounts
            return c.json({ data: credentials }, 201);
        } catch (error: any) {
            console.error("Failed to create credential:", error);
            
            let errorMessage = "Failed to create credential";
            let statusCode: 400 | 401 | 404 | 500 = 500;
            
            if (error instanceof Error) {
                if (error.message.includes("404") || error.message.includes("not found")) {
                    errorMessage = "Repository not found, check the repository owner and name";
                    statusCode = 404;
                } else if (error.message.includes("401") || error.message.includes("unauthorized")) {
                    errorMessage = "Invalid GitHub token or insufficient permissions";
                    statusCode = 401;
                } else if (error.message.includes("validation")) {
                    errorMessage = error.message;
                    statusCode = 400;
                } else {
                    errorMessage = error.message || "Failed to create credential";
                }
            }
            
            return c.json({ error: errorMessage }, statusCode);
        }
    })
    .patch("/:credentialId", sessionMiddleware, zValidator("json", createCredentialsSchema), async (c) => {
        const pb = c.get("pb");
        const account = c.get("account");
        const userId = c.req.param("userId");
        const projectId = c.req.param("projectId");
        const credentialId = c.req.param("credentialId");
        const data = c.req.valid("json");

        if (!account) {
            return c.json({ error: "Unauthorized" }, 401);
        }

        if (!userId || !credentialId || !projectId) {
            return c.json({ error: "User, project, and credential are required" }, 400);
        }

        if (userId !== account.id) {
            return c.json({ error: "You do not have access to this user's credentials" }, 403);
        }

        const integration = await resolveProjectIntegrationContext(pb, projectId, account.id);
        if (!integration.ok) {
            return c.json({ error: integration.error }, integration.status);
        }

        if (!integration.isOwner) {
            return c.json({ error: "Only the project owner can update GitHub credentials" }, 403);
        }

        try {
            const credential = await pb.collection("credentials").getOne(credentialId);
            if (credential.user !== integration.integrationUserId) {
                return c.json({ error: "This credential does not belong to this user" }, 403);
            }

            if (credential.project && credential.project !== projectId) {
                return c.json({ error: "Credential does not belong to this project" }, 403);
            }

            const { token, owner, repo } = data.api_keys;
            const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
                headers: githubHeaders(token),
            });
            if (!repoRes.ok) {
                const payload = await parseGithubErrorPayload(repoRes);
                const mapped = mapGithubApiError(repoRes.status, payload);
                return c.json(
                    {
                        error: mapped.message,
                        github: {
                            status: repoRes.status,
                            message: payload.message,
                            documentation_url: payload.documentation_url,
                        },
                    },
                    mapped.status as 401 | 404 | 500
                );
            }

            const reset = await clearProjectCommitIntegrationData(
                projectId,
                integration.ownerUserId
            );

            const updated = await pb.collection("credentials").update(credentialId, {
                project: projectId,
                api_keys: {
                    ...credential.api_keys,
                    token,
                    owner,
                    repo,
                    webhookSecret: credential.api_keys.webhookSecret,
                },
                api_limitations: data.api_limitations,
            });

            const repository = `${owner}/${repo}`;
            let backfill = { fetchedFromGithub: 0, created: 0 };
            try {
                backfill = await enrichAndStoreInitialCommits({
                    pb,
                    userId: integration.integrationUserId,
                    repository,
                    token,
                    projectId,
                });
            } catch (backfillError) {
                console.error("Credential updated but commit backfill failed:", backfillError);
                return c.json(
                    {
                        error:
                            backfillError instanceof Error
                                ? backfillError.message
                                : "Credential saved but failed to import commits from GitHub",
                        data: updated,
                        reset,
                    },
                    500
                );
            }

            return c.json({ data: updated, reset, backfill }, 200);
        } catch (error: any) {
            console.error("Failed to update credential:", error);
            return c.json({ error: "Failed to update credential" }, 500);
        }
    });

export default credentialsApp;