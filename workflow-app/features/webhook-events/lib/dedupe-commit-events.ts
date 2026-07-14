import type { RecordModel } from "pocketbase";
import { commitShaFromPayload } from "./commit-sha";
import { normalizeRelationId } from "./list-webhook-events-for-project";

export type CommitDuplicateGroup = {
    repository: string;
    sha: string;
    recordIds: string[];
    keepId: string;
    deleteIds: string[];
};

export type DedupeCommitEventsPlan = {
    commitRecordCount: number;
    uniqueCommitCount: number;
    duplicateRecordCount: number;
    duplicateGroupCount: number;
    groups: CommitDuplicateGroup[];
    deleteIds: string[];
};

function commitGroupKey(event: RecordModel): string | null {
    if (event.event_type !== "commit") {
        return null;
    }
    const sha = commitShaFromPayload(event.payload);
    const repo = typeof event.repository === "string" ? event.repository : "";
    if (!sha || !repo) {
        return null;
    }
    return `${repo}::${sha}`;
}

export function scoreCommitEventForKeep(event: RecordModel): number {
    let score = 0;
    if (normalizeRelationId(event.project)) {
        score += 1_000;
    }

    const payload = event.payload as { sha?: string; files?: unknown[] } | undefined;
    if (payload?.sha) {
        score += 100;
    }
    if (Array.isArray(payload?.files) && payload.files.length > 0) {
        score += 50;
    }

    const created = Date.parse(event.created ?? "") || 0;
    return score * 1e13 + created;
}

export function planDedupeCommitEvents(events: RecordModel[]): DedupeCommitEventsPlan {
    const byKey = new Map<string, RecordModel[]>();

    for (const event of events) {
        const key = commitGroupKey(event);
        if (!key) {
            continue;
        }
        const group = byKey.get(key) ?? [];
        group.push(event);
        byKey.set(key, group);
    }

    const groups: CommitDuplicateGroup[] = [];
    const deleteIds: string[] = [];

    for (const [, records] of byKey) {
        if (records.length <= 1) {
            continue;
        }

        const sorted = [...records].sort(
            (a, b) => scoreCommitEventForKeep(b) - scoreCommitEventForKeep(a)
        );
        const keep = sorted[0];
        const sha = commitShaFromPayload(keep.payload) ?? "";
        const repo = typeof keep.repository === "string" ? keep.repository : "";
        const toDelete = sorted.slice(1).map((r) => r.id);

        groups.push({
            repository: repo,
            sha,
            recordIds: sorted.map((r) => r.id),
            keepId: keep.id,
            deleteIds: toDelete,
        });
        deleteIds.push(...toDelete);
    }

    const commitRecordCount = events.filter((e) => e.event_type === "commit").length;

    return {
        commitRecordCount,
        uniqueCommitCount: commitRecordCount - deleteIds.length,
        duplicateRecordCount: deleteIds.length,
        duplicateGroupCount: groups.length,
        groups,
        deleteIds,
    };
}

type EventsPb = {
    collection: (name: string) => {
        delete: (id: string) => Promise<boolean>;
    };
};

export async function executeDedupeCommitEvents(
    pb: EventsPb,
    plan: DedupeCommitEventsPlan
): Promise<{ deleted: number; failed: number }> {
    let deleted = 0;
    let failed = 0;

    for (const id of plan.deleteIds) {
        try {
            await pb.collection("webhook_events").delete(id);
            deleted += 1;
        } catch (error) {
            failed += 1;
            console.error(`[dedupe-commit-events] Failed to delete ${id}:`, error);
        }
    }

    return { deleted, failed };
}
