import { createAdminClient } from "@/lib/pocketbase";
import { deleteUserProjectData } from "@desktop-shell/shared/delete-user-project-data";
import { ProjectShareStatus } from "@/features/project-sharing/constants";
import { PROJECT_SHARES_COLLECTION, getPocketBaseErrorMessage, markShareAsProjectDeleted, type ShareDeletionManifest } from "@/features/project-sharing/lib/project-shares-pocketbase";
import { collectProjectLocalDataUserIds, deleteProjectWebhookEvents } from "@/features/projects/lib/clear-project-commit-integration";

export async function deleteProjectAsOwner(projectId: string, ownerUserId: string): Promise<void> {
    const admin = await createAdminClient();
    const project = await admin.collection("projects").getOne(projectId);

    if (project.owner !== ownerUserId) {
        throw new Error("Only the project owner can delete this project");
    }

    const shares = await admin.collection(PROJECT_SHARES_COLLECTION).getFullList({
        filter: `project = "${projectId}"`,
    });

    const userIdsToClean = await collectProjectLocalDataUserIds(projectId, ownerUserId, {
        includeDeletedShareRecipients: true,
    });

    await Promise.all(
        Array.from(userIdsToClean).map((userId) => deleteUserProjectData(userId, projectId))
    );

    const deletionManifest: ShareDeletionManifest = {
        projectId,
        projectName: project.name as string,
        deletedAt: new Date().toISOString(),
        deletedBy: ownerUserId,
    };

    for (const share of shares) {
        const status = share.status as string | undefined;
        if (status === ProjectShareStatus.ACCEPTED) {
            try {
                await markShareAsProjectDeleted(admin, share.id, deletionManifest);
            } catch (error) {
                throw new Error(
                    `Failed to notify share recipient: ${getPocketBaseErrorMessage(error)} ` +
                        `Add status value "project_deleted" and optional fields to project_shares in PocketBase`
                );
            }
            continue;
        }

        try {
            await admin.collection(PROJECT_SHARES_COLLECTION).delete(share.id);
        } catch (error) {
            throw new Error(
                `Failed to delete project share ${share.id}: ${getPocketBaseErrorMessage(error)}`
            );
        }
    }

    try {
        const credentials = await admin.collection("credentials").getFullList({
            filter: `project = "${projectId}"`,
        });
        await Promise.all(
            credentials.map((record) => admin.collection("credentials").delete(record.id))
        );
    } catch (error) {
        throw new Error(`Failed to delete credentials: ${getPocketBaseErrorMessage(error)}`);
    }

    await deleteProjectWebhookEvents(projectId);

    try {
        const members = await admin.collection("members").getFullList({
            filter: `project = "${projectId}"`,
        });
        await Promise.all(members.map((record) => admin.collection("members").delete(record.id)));
    } catch {
        // members collection may be unused
    }

    try {
        await admin.collection("projects").delete(projectId);
    } catch (error) {
        throw new Error(`Failed to delete project: ${getPocketBaseErrorMessage(error)}`);
    }
}
