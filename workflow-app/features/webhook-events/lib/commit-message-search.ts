import { commitShaFromPayload } from "./commit-sha";

export function getCommitMessageFromPayload(payload: unknown): string {
    if (!payload || typeof payload !== "object") {
        return "";
    }

    const record = payload as {
        commit?: { message?: string };
        message?: string;
    };

    return (record.commit?.message ?? record.message ?? "").trim();
}

export function eventMatchesCommitSearch(
    event: { event_type?: string; payload?: unknown },
    query: string
): boolean {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
        return true;
    }

    if (event.event_type !== "commit") {
        return false;
    }

    const message = getCommitMessageFromPayload(event.payload).toLowerCase();
    const sha = (commitShaFromPayload(event.payload) ?? "").toLowerCase();

    return message.includes(normalized) || sha.includes(normalized);
}
