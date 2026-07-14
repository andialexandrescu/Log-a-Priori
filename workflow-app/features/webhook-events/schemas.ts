import { z } from "zod";

export type WebhookEvent = {
    id: string;
    created: string;
    event_type?: string;
    repository?: string;
    payload?: unknown;
};

export function normalizeWebhookEvent(raw: unknown): WebhookEvent | null {
    if (!raw || typeof raw !== "object") {
        return null;
    }

    const record = raw as Record<string, unknown>;
    if (typeof record.id !== "string" || record.id.length === 0) {
        return null;
    }

    return {
        id: record.id,
        created: typeof record.created === "string" ? record.created : "",
        event_type: typeof record.event_type === "string" ? record.event_type : undefined,
        repository: typeof record.repository === "string" ? record.repository : undefined,
        payload: record.payload,
    };
}

export function normalizeWebhookEvents(raw: unknown): WebhookEvent[] {
    if (!Array.isArray(raw)) {
        return [];
    }

    return raw
        .map(normalizeWebhookEvent)
        .filter((event): event is WebhookEvent => event !== null);
}

export const webhookEventsSchema = z.object({
    event: z.string(),
    repo: z.string(),
    data: z.any(),
});