import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export const DESKTOP_SHELL_DIR_NAME = "log-a-priori-desktop-shell";
export const DESKTOP_SETTINGS_FILE_NAME = "desktop-settings.json";

/** PocketBase `users` record id — scopes on-disk project data per app user. */
export type AppUserId = string;
export type ProjectId = string;

export function getDesktopShellBaseDirectory(): string {
    const appData = process.env.APPDATA?.trim();
    if (appData) {
        return path.join(appData, DESKTOP_SHELL_DIR_NAME);
    }
    const userProfile = process.env.USERPROFILE?.trim();
    if (userProfile) {
        return path.join(userProfile, "AppData", "Roaming", DESKTOP_SHELL_DIR_NAME);
    }
    return path.join(os.homedir(), "AppData", "Roaming", DESKTOP_SHELL_DIR_NAME);
}

export function getDesktopSettingsFilePath(): string {
    return path.join(getDesktopShellBaseDirectory(), DESKTOP_SETTINGS_FILE_NAME);
}

/** Per-user project folder: `%APPDATA%/log-a-priori-desktop-shell/{userId}/{projectId}` */
export function getUserProjectDirectory(userId: AppUserId, projectId: ProjectId): string {
    return path.join(getDesktopShellBaseDirectory(), userId, projectId);
}

/** Legacy layout before per-user folders: `%APPDATA%/.../{projectId}` */
export function getLegacyProjectDirectory(projectId: ProjectId): string {
    return path.join(getDesktopShellBaseDirectory(), projectId);
}

export function getProjectAnalysisDirectory(userId: AppUserId, projectId: ProjectId): string {
    return path.join(getUserProjectDirectory(userId, projectId), "analysis");
}

export function getProjectGraphFilePath(userId: AppUserId, projectId: ProjectId): string {
    return path.join(getProjectAnalysisDirectory(userId, projectId), "ts-code-graph.json");
}

export function getProjectCommitsDirectory(userId: AppUserId, projectId: ProjectId): string {
    return path.join(getUserProjectDirectory(userId, projectId), "commits");
}

export function getProjectDocumentationPaths(userId: AppUserId, projectId: ProjectId) {
    const directory = getProjectAnalysisDirectory(userId, projectId);
    return {
        directory,
        baseMarkdown: path.join(directory, "documentation.md"),
        baseJson: path.join(directory, "documentation.json"),
        draftMarkdown: path.join(directory, "custom-documentation.md"),
        draftJson: path.join(directory, "custom-documentation.json"),
        seedHistoryJson: path.join(directory, "raw-ppr-seed-history.json"),
    };
}

function pathExistsSync(targetPath: string): boolean {
    try {
        fs.accessSync(targetPath);
        return true;
    } catch {
        return false;
    }
}

function directoryHasEntriesSync(targetPath: string): boolean {
    try {
        return fs.readdirSync(targetPath).length > 0;
    } catch {
        return false;
    }
}

async function pathExistsAsync(targetPath: string): Promise<boolean> {
    try {
        await fsPromises.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function directoryHasEntriesAsync(targetPath: string): Promise<boolean> {
    try {
        const entries = await fsPromises.readdir(targetPath);
        return entries.length > 0;
    } catch {
        return false;
    }
}

/**
 * Ensures the per-user project directory exists and migrates data from the legacy
 * `{shell}/{projectId}` layout when present (sync — Electron main).
 */
export function ensureUserProjectDirectorySync(userId: AppUserId, projectId: ProjectId): string {
    const targetDir = getUserProjectDirectory(userId, projectId);
    const legacyDir = getLegacyProjectDirectory(projectId);

    if (!pathExistsSync(targetDir) && pathExistsSync(legacyDir) && directoryHasEntriesSync(legacyDir)) {
        fs.mkdirSync(path.dirname(targetDir), { recursive: true });
        fs.renameSync(legacyDir, targetDir);
    } else {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    return targetDir;
}

/**
 * Ensures the per-user project directory exists and migrates legacy layout (async — Next.js server).
 */
export async function ensureUserProjectDirectory(
    userId: AppUserId,
    projectId: ProjectId
): Promise<string> {
    const targetDir = getUserProjectDirectory(userId, projectId);
    const legacyDir = getLegacyProjectDirectory(projectId);

    if (!(await pathExistsAsync(targetDir)) && (await directoryHasEntriesAsync(legacyDir))) {
        await fsPromises.mkdir(path.dirname(targetDir), { recursive: true });
        await fsPromises.rename(legacyDir, targetDir);
    } else {
        await fsPromises.mkdir(targetDir, { recursive: true });
    }

    return targetDir;
}

/** Ensures project + `commits` subfolder exist (Electron IPC). */
export function ensureProjectCommitsDirectory(userId: AppUserId, projectId: ProjectId): string {
    const projectPath = ensureUserProjectDirectorySync(userId, projectId);
    const commitsPath = path.join(projectPath, "commits");
    fs.mkdirSync(commitsPath, { recursive: true });
    return commitsPath;
}
