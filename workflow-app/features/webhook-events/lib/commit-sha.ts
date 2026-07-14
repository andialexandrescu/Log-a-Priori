import type { RecordModel } from "pocketbase";
import { buildCommitWebhookEventDedupFilter } from "./project-scope";

export function commitShaFromPayload(payload: unknown): string | null {
    if (!payload || typeof payload !== "object") {
        return null;
    }

    const record = payload as { sha?: unknown; id?: unknown };
    if (typeof record.sha === "string" && record.sha.length > 0) {
        return record.sha;
    }
    if (typeof record.id === "string" && record.id.length > 0) {
        return record.id;
    }

    return null;
}

export function countUniqueCommitShas(events: Array<{ payload?: unknown; event_type?: string }>): number {
    const shas = new Set<string>();
    for (const event of events) {
        if (event.event_type !== "commit") {
            continue;
        }
        const sha = commitShaFromPayload(event.payload);
        if (sha) {
            shas.add(sha);
        }
    }
    return shas.size;
}

type EventsPb = {
    collection: (name: string) => {
        getList: (page: number, perPage: number, opts: { filter: string }) => Promise<{ totalItems: number }>;
    };
};

export async function commitWebhookEventExists(
    pb: EventsPb,
    userId: string,
    repo: string,
    sha: string,
    projectId?: string
): Promise<boolean> {
    const filters = [
        `user="${userId}" && repository="${repo}" && event_type="commit" && payload.sha="${sha}"`,
        `user="${userId}" && repository="${repo}" && event_type="commit" && payload.id="${sha}"`,
    ];

    if (projectId) {
        filters.unshift(buildCommitWebhookEventDedupFilter(userId, projectId, repo, sha));
    }

    for (const filter of filters) {
        const existing = await pb.collection("webhook_events").getList(1, 1, { filter });
        if (existing.totalItems > 0) {
            return true;
        }
    }

    return false;
}

export function indexCommitShasByEvent(events: RecordModel[]): Map<string, string> {
    const bySha = new Map<string, string>();
    for (const event of events) {
        const sha = commitShaFromPayload(event.payload);
        if (sha && !bySha.has(sha)) {
            bySha.set(sha, event.id);
        }
    }
    return bySha;
}
