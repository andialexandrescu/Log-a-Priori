import fs from "node:fs/promises";
import path from "node:path";
import { createAdminClient } from "@/lib/pocketbase";
import { ProjectShareStatus } from "@/features/project-sharing/constants";
import { normalizeRelationId } from "@/features/webhook-events/lib/list-webhook-events-for-project";
import {
    getLegacyProjectDirectory,
    getProjectCommitsDirectory,
} from "@desktop-shell/shared/desktop-shell-paths";

const PROJECT_SHARES_COLLECTION = "project_shares";

type CollectProjectLocalDataUserIdsOptions = {
    // when true, includes recipients of deleted project shares (full project deletion)
    includeDeletedShareRecipients?: boolean;
};

// owner plus share recipients who may have local appdata
export async function collectProjectLocalDataUserIds( projectId: string, ownerUserId: string, options: CollectProjectLocalDataUserIdsOptions = {} ): Promise<Set<string>> {
    const admin = await createAdminClient();
    const userIds = new Set<string>([ownerUserId]);

    const shareFilter = options.includeDeletedShareRecipients
        ? `project = "${projectId}"`
        : `project = "${projectId}" && status != "${ProjectShareStatus.PROJECT_DELETED}"`;

    const shares = await admin.collection(PROJECT_SHARES_COLLECTION).getFullList({
        filter: shareFilter,
    });

    for (const share of shares) {
        const recipientId = normalizeRelationId(share.to_user);
        if (recipientId) {
            userIds.add(recipientId);
        }
    }

    return userIds;
}

async function clearCommitsDirectory(commitsDir: string): Promise<void> {
    await fs.rm(commitsDir, { recursive: true, force: true }).catch(() => undefined);
    await fs.mkdir(commitsDir, { recursive: true });
}

// removes only each user's commits subfolder under appdata
export async function clearProjectCommitsFolders( projectId: string, ownerUserId: string ): Promise<void> {
    const userIds = await collectProjectLocalDataUserIds(projectId, ownerUserId);

    await Promise.all(
        Array.from(userIds).map(async (userId) => {
            await clearCommitsDirectory(getProjectCommitsDirectory(userId, projectId));
        })
    );

    const legacyCommitsDir = path.join(getLegacyProjectDirectory(projectId), "commits");
    await clearCommitsDirectory(legacyCommitsDir);
}

// deletes all PocketBase webhook_events rows scoped
export async function deleteProjectWebhookEvents(projectId: string): Promise<number> {
    const admin = await createAdminClient();
    const webhookEvents = await admin.collection("webhook_events").getFullList({
        filter: `project = "${projectId}"`,
    });

    await Promise.all(
        webhookEvents.map((record) => admin.collection("webhook_events").delete(record.id))
    );

    return webhookEvents.length;
}

// resets commit integration artifacts before reconfiguring GitHub (edit credentials)
export async function clearProjectCommitIntegrationData( projectId: string, ownerUserId: string ): Promise<{ deletedWebhookEvents: number }> {
    await clearProjectCommitsFolders(projectId, ownerUserId);
    const deletedWebhookEvents = await deleteProjectWebhookEvents(projectId);
    return { deletedWebhookEvents };
}
