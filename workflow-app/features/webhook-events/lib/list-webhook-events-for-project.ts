import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import {
    buildWebhookEventsProjectFilter,
    buildWebhookEventsProjectFilterWithRepos,
} from "./project-scope";

function repositoryKey(credential: RecordModel): string | null {
    const keys = credential.api_keys as { owner?: string; repo?: string } | undefined;
    if (keys?.owner && keys?.repo) {
        return `${keys.owner}/${keys.repo}`;
    }
    return null;
}

export function normalizeRelationId(value: unknown): string | null {
    if (typeof value === "string" && value.length > 0) {
        return value;
    }
    if (value && typeof value === "object" && "id" in value) {
        const id = (value as { id?: unknown }).id;
        if (typeof id === "string" && id.length > 0) {
            return id;
        }
    }
    return null;
}

export function buildRepositoryToProjectMap(credentials: RecordModel[]): Map<string, string> {
    const map = new Map<string, string>();
    for (const credential of credentials) {
        const projectId = normalizeRelationId(credential.project);
        if (!projectId) {
            continue;
        }
        const repo = repositoryKey(credential);
        if (repo) {
            map.set(repo, projectId);
        }
    }
    return map;
}

export function repositoriesForProjectCredentials(
    credentials: RecordModel[],
    projectId: string
): Set<string> {
    const repos = new Set<string>();
    for (const credential of credentials) {
        if (normalizeRelationId(credential.project) !== projectId) {
            continue;
        }
        const repo = repositoryKey(credential);
        if (repo) {
            repos.add(repo);
        }
    }
    return repos;
}

export function eventBelongsToProject(
    event: RecordModel,
    projectId: string,
    projectRepositories: Set<string>,
    repositoryToProject: Map<string, string>,
    options: { allowLegacyRepositoryMatch: boolean }
): boolean {
    const eventProjectId = normalizeRelationId(event.project);
    const repo = typeof event.repository === "string" ? event.repository : "";

    if (projectRepositories.size > 0) {
        if (!repo || !projectRepositories.has(repo)) {
            return false;
        }
    }

    if (eventProjectId === projectId) {
        return true;
    }

    if (!options.allowLegacyRepositoryMatch) {
        return false;
    }

    const canonicalProject = repositoryToProject.get(repo);
    if (canonicalProject) {
        return canonicalProject === projectId;
    }

    return !eventProjectId;
}

function buildRepositoryOrFilter(repositories: Set<string>): string | null {
    const clauses = Array.from(repositories).map(
        (repo) => `repository = "${repo.replace(/"/g, '\\"')}"`
    );
    if (clauses.length === 0) {
        return null;
    }
    return `(${clauses.join(" || ")})`;
}

function mergeEventsById(events: RecordModel[]): RecordModel[] {
    const byId = new Map<string, RecordModel>();
    for (const event of events) {
        byId.set(event.id, event);
    }
    return Array.from(byId.values());
}

async function fetchWebhookEvents(
    eventsPb: PocketBase,
    filter: string
): Promise<RecordModel[]> {
    try {
        return await eventsPb.collection("webhook_events").getFullList({
            filter,
            sort: "-created",
        });
    } catch (error) {
        console.warn("[webhook-events] PocketBase query failed:", filter, error);
        return [];
    }
}

export type ListWebhookEventsOptions = {
    repository?: string;
    eventType?: string;
    allowLegacyRepositoryMatch?: boolean;
};

export async function listWebhookEventsForProject(
    eventsPb: PocketBase,
    integrationUserId: string,
    projectId: string,
    options?: ListWebhookEventsOptions
): Promise<RecordModel[]> {
    const allowLegacy = options?.allowLegacyRepositoryMatch === true;

    const credentials = await eventsPb.collection("credentials").getFullList({
        filter: `user = "${integrationUserId}"`,
    }).catch((error) => {
        console.warn("[webhook-events] Failed to load credentials:", error);
        return [] as RecordModel[];
    });

    const projectRepositories = repositoriesForProjectCredentials(credentials, projectId);
    const repositoryToProject = buildRepositoryToProjectMap(credentials);

    const batches: RecordModel[][] = [];

    const projectFilter =
        projectRepositories.size > 0
            ? buildWebhookEventsProjectFilterWithRepos(
                  integrationUserId,
                  projectId,
                  projectRepositories
              )
            : buildWebhookEventsProjectFilter(integrationUserId, projectId);

    batches.push(await fetchWebhookEvents(eventsPb, projectFilter));

    const repoFilter = buildRepositoryOrFilter(projectRepositories);
    if (allowLegacy && repoFilter) {
        batches.push(
            await fetchWebhookEvents(
                eventsPb,
                `user = "${integrationUserId}" && ${repoFilter}`
            )
        );
    }

    let result = mergeEventsById(batches.flat()).filter((event) =>
        eventBelongsToProject(event, projectId, projectRepositories, repositoryToProject, {
            allowLegacyRepositoryMatch: allowLegacy,
        })
    );

    result.sort((a, b) => {
        const aTime = Date.parse(a.created ?? "") || 0;
        const bTime = Date.parse(b.created ?? "") || 0;
        return bTime - aTime;
    });

    if (options?.repository) {
        result = result.filter((event) => event.repository === options.repository);
    }
    if (options?.eventType) {
        result = result.filter((event) => event.event_type === options.eventType);
    }

    return result;
}
