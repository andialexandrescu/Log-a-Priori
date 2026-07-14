import type PocketBase from "pocketbase";
import type { RecordModel } from "pocketbase";
import { createAdminClient } from "@/lib/pocketbase";
import { normalizeRelationId } from "@/features/webhook-events/lib/list-webhook-events-for-project";
import type { ProjectIntegrationContext } from "./project-access";

export async function getPocketBaseForIntegrationData( userPb: PocketBase, integration: ProjectIntegrationContext, accountUserId: string ): Promise<PocketBase> {
    if (integration.integrationUserId === accountUserId) {
        return userPb;
    }
    return createAdminClient();
}

export function pickCredentialForProject( credentials: RecordModel[], projectId: string ): RecordModel | null {
    const exact = credentials.find(
        (record) => normalizeRelationId(record.project) === projectId
    );
    if (exact) {
        return exact;
    }

    const unscoped = credentials.filter(
        (record) => normalizeRelationId(record.project) === null
    );
    if (unscoped.length === 1) {
        return unscoped[0];
    }

    // one GitHub credential per user before project scoped records
    if (credentials.length === 1) {
        return credentials[0];
    }

    return null;
}

export async function resolveCredentialForProject( credentialPb: PocketBase, integrationUserId: string, projectId: string ): Promise<RecordModel | null> {
    try {
        return await credentialPb.collection("credentials").getFirstListItem(
            `user = "${integrationUserId}" && project = "${projectId}"`
        );
    } catch {
    }

    const credentials = await credentialPb.collection("credentials").getFullList({
        filter: `user = "${integrationUserId}"`,
    });

    return pickCredentialForProject(credentials, projectId);
}
