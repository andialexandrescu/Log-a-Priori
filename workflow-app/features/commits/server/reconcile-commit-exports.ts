import type { RecordModel } from "pocketbase";
import { commitShaFromPayload } from "@/features/webhook-events/lib/commit-sha";
import {
    enrichCommitWithDetails,
    hasCommitFilesExport,
    syncCommitFilesToSelectedRoot,
    type EnrichedCommitPayload,
    type GithubCommitSummary,
} from "./github-commits-utils";

const RECONCILE_REPAIR_LIMIT = 25;

type ReconcileCommitExportsInput = {
    repository: string;
    owner: string;
    repoName: string;
    token: string;
    defaultBranch?: string;
    userId: string;
    projectId: string;
    events: RecordModel[];
};

export type ReconcileCommitExportsResult = {
    repaired: number;
    failures: number;
    alreadyPresent: number;
    missingRemaining: number;
    checked: number;
};

function payloadHasFileLists(payload: unknown): payload is EnrichedCommitPayload {
    if (!payload || typeof payload !== "object") {
        return false;
    }

    const record = payload as { added?: unknown; modified?: unknown; removed?: unknown };
    return (
        Array.isArray(record.added) &&
        Array.isArray(record.modified) &&
        Array.isArray(record.removed)
    );
}

async function resolveCommitForExport(
    input: ReconcileCommitExportsInput,
    sha: string,
    payload: unknown
): Promise<EnrichedCommitPayload> {
    if (payloadHasFileLists(payload)) {
        return payload;
    }

    const summary = (payload && typeof payload === "object" ? payload : { sha }) as GithubCommitSummary;

    return enrichCommitWithDetails({
        owner: input.owner,
        repoName: input.repoName,
        sha,
        summary,
        token: input.token,
        defaultBranch: input.defaultBranch,
    });
}

export async function reconcileCommitExports(
    input: ReconcileCommitExportsInput
): Promise<ReconcileCommitExportsResult> {
    const seenShas = new Set<string>();
    const missing: Array<{ sha: string; payload: unknown }> = [];
    let alreadyPresent = 0;

    for (const event of input.events) {
        if (event.event_type !== "commit") {
            continue;
        }

        const sha = commitShaFromPayload(event.payload);
        if (!sha || seenShas.has(sha)) {
            continue;
        }

        seenShas.add(sha);

        const exported = await hasCommitFilesExport(
            input.repository,
            sha,
            input.userId,
            input.projectId
        );

        if (exported) {
            alreadyPresent += 1;
            continue;
        }

        missing.push({ sha, payload: event.payload });
    }

    const toRepair = missing.slice(0, RECONCILE_REPAIR_LIMIT);
    const missingRemaining = Math.max(0, missing.length - toRepair.length);

    let repaired = 0;
    let failures = 0;

    for (const item of toRepair) {
        try {
            const commit = await resolveCommitForExport(input, item.sha, item.payload);
            await syncCommitFilesToSelectedRoot({
                repository: input.repository,
                token: input.token,
                commit,
                userId: input.userId,
                projectId: input.projectId,
            });
            repaired += 1;
        } catch (error) {
            failures += 1;
            console.error(`Failed to reconcile local commit files for ${item.sha}:`, error);
        }
    }

    return {
        repaired,
        failures,
        alreadyPresent,
        missingRemaining,
        checked: seenShas.size,
    };
}
