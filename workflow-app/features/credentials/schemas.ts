import { z } from "zod";

export type CredentialApiKeys = {
    token?: string;
    owner?: string;
    repo?: string;
    webhookSecret?: string;
};

export type CredentialRecord = {
    id: string;
    api_keys?: CredentialApiKeys;
    api_limitations?: Record<string, unknown>;
};

export type UserCredentialResult = {
    credential: CredentialRecord | null;
    inherited: boolean;
};

export function normalizeCredentialRecord(raw: unknown): CredentialRecord | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }

    const record = raw as Record<string, unknown>;
    if (typeof record.id !== "string" || record.id.length === 0) {
        return null;
    }

    const apiKeysRaw = record.api_keys;
    const api_keys =
        apiKeysRaw && typeof apiKeysRaw === "object"
            ? {
                  token: typeof (apiKeysRaw as CredentialApiKeys).token === "string"
                      ? (apiKeysRaw as CredentialApiKeys).token
                      : undefined,
                  owner: typeof (apiKeysRaw as CredentialApiKeys).owner === "string"
                      ? (apiKeysRaw as CredentialApiKeys).owner
                      : undefined,
                  repo: typeof (apiKeysRaw as CredentialApiKeys).repo === "string"
                      ? (apiKeysRaw as CredentialApiKeys).repo
                      : undefined,
                  webhookSecret:
                      typeof (apiKeysRaw as CredentialApiKeys).webhookSecret === "string"
                          ? (apiKeysRaw as CredentialApiKeys).webhookSecret
                          : undefined,
              }
            : undefined;

    const api_limitations =
        record.api_limitations && typeof record.api_limitations === "object"
            ? (record.api_limitations as Record<string, unknown>)
            : undefined;

    return {
        id: record.id,
        api_keys,
        api_limitations,
    };
}

export const createCredentialsSchema = z.object({
    api_keys: z.object({
        token: z.string().min(1, "GitHub token is required"),
        owner: z.string().min(1, "Repository owner is required"),
        repo: z.string().min(1, "Repository name is required"),
        // webhook is removed since it is generated server side
    }),
    api_limitations: z.record(z.string(), z.unknown()).optional(), // json limitations not yet known
    // no need to set the project id or member id, since they are part of the endpoint
});