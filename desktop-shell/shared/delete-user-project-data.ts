import fs from "node:fs/promises";
import {
    getDesktopSettingsFilePath,
    getLegacyProjectDirectory,
    getUserProjectDirectory,
} from "./desktop-shell-paths";

export async function clearProjectRootSettings(
    userId: string,
    projectId: string
): Promise<void> {
    const settingsPath = getDesktopSettingsFilePath();
    let settings: {
        projectRoots?: Record<string, string>;
        users?: Record<string, { projectRoots?: Record<string, string> }>;
    } = {};

    try {
        const raw = await fs.readFile(settingsPath, "utf8");
        settings = JSON.parse(raw);
    } catch {
        return;
    }

    let changed = false;

    if (settings.users?.[userId]?.projectRoots?.[projectId]) {
        delete settings.users[userId].projectRoots![projectId];
        changed = true;
    }

    if (settings.projectRoots?.[projectId]) {
        delete settings.projectRoots[projectId];
        changed = true;
    }

    if (changed) {
        await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8");
    }
}

/** Removes `%APPDATA%/log-a-priori-desktop-shell/{userId}/{projectId}` and legacy layout. */
export async function deleteUserProjectData(userId: string, projectId: string): Promise<void> {
    await clearProjectRootSettings(userId, projectId);

    const directories = [
        getUserProjectDirectory(userId, projectId),
        getLegacyProjectDirectory(projectId),
    ];

    await Promise.all(
        directories.map((dir) => fs.rm(dir, { recursive: true, force: true }).catch(() => undefined))
    );
}
