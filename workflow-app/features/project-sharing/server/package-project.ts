import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import AdmZip from "adm-zip";
import { ensureUserProjectDirectory, getUserProjectDirectory } from "@desktop-shell/shared/desktop-shell-paths";

export type ProjectPackageManifest = {
    version: 1;
    projectId: string;
    projectName: string;
    senderUserId: string;
    recipientUserId: string;
    exportedAt: string;
    includesProjectRootPath?: string | null;
};

export async function createProjectDataArchive(params: { senderUserId: string; projectId: string; projectName: string; recipientUserId: string; projectRootPath?: string | null; outputZipPath: string; }): Promise<ProjectPackageManifest> {
    try {
        console.log(`[createProjectDataArchive] Starting package creation for project ${params.projectId}, user ${params.senderUserId}`);
        
        const projectDir = await ensureUserProjectDirectory(params.senderUserId, params.projectId);
        console.log(`[createProjectDataArchive] Project directory: ${projectDir}`);

        if (params.projectRootPath) {
            await mergeAnalysisFromProjectRoot(projectDir, params.projectRootPath);
        }

        // check if project directory exists and is accessible
        try {
            const stats = await fs.stat(projectDir);
            console.log(`[createProjectDataArchive] Project directory stats:`, stats);
        } catch (error) {
            console.error(`[createProjectDataArchive] Failed to access project directory: ${projectDir}`, error);
            throw new Error(`Project directory not accessible: ${projectDir}`);
        }

        const manifest: ProjectPackageManifest = {
            version: 1,
            projectId: params.projectId,
            projectName: params.projectName,
            senderUserId: params.senderUserId,
            recipientUserId: params.recipientUserId,
            exportedAt: new Date().toISOString(),
            includesProjectRootPath: params.projectRootPath ?? null,
        };

        await fs.mkdir(path.dirname(params.outputZipPath), { recursive: true });
        console.log(`[createProjectDataArchive] Output directory created for: ${params.outputZipPath}`);

        // create zip using AdmZip
        const zip = new AdmZip();
        
        console.log(`[createProjectDataArchive] Adding directory to archive: ${projectDir}`);
        zip.addLocalFolder(projectDir, "project-data");
        
        console.log(`[createProjectDataArchive] Adding manifest to archive`);
        zip.addFile("manifest.json", Buffer.from(JSON.stringify(manifest, null, 2)));

        if (params.projectRootPath) {
            console.log(`[createProjectDataArchive] Adding desktop settings to archive`);
            zip.addFile("desktop-settings.json", 
                Buffer.from(JSON.stringify({ projectRootPath: params.projectRootPath }, null, 2)));
        }
        
        console.log(`[createProjectDataArchive] Writing zip to disk`);
        zip.writeZip(params.outputZipPath);
        
        console.log(`[createProjectDataArchive] Package creation completed successfully`);
        return manifest;
    } catch (error) {
        console.error(`[createProjectDataArchive] Detailed package creation error:`, error);
        throw new Error(`Failed to create project share package: ${error instanceof Error ? error.message : String(error)}`);
    }
}

export async function extractProjectDataArchive(params: { recipientUserId: string; zipPath: string; }): Promise<ProjectPackageManifest> {
    const AdmZip = (await import("adm-zip")).default;
    const tempRoot = path.join(
        os.tmpdir(),
        "log-a-priori-import",
        params.recipientUserId,
        `${Date.now()}`
    );
    await fs.mkdir(tempRoot, { recursive: true });

    try {
        const zip = new AdmZip(params.zipPath);
        zip.extractAllTo(tempRoot, true);

        const manifestPath = path.join(tempRoot, "manifest.json");
        const manifestRaw = await fs.readFile(manifestPath, "utf8");
        const manifest = JSON.parse(manifestRaw) as ProjectPackageManifest;

        const sourceDataDir = path.join(tempRoot, "project-data");
        const targetDir = await ensureUserProjectDirectory(
            params.recipientUserId,
            manifest.projectId
        );

        await mergeDirectoryContents(sourceDataDir, targetDir);

        const desktopSettingsSnippet = path.join(tempRoot, "desktop-settings.json");
        try {
            const snippetRaw = await fs.readFile(desktopSettingsSnippet, "utf8");
            const snippet = JSON.parse(snippetRaw) as { projectRootPath?: string };
            if (snippet.projectRootPath) {
                manifest.includesProjectRootPath = snippet.projectRootPath;
            }
        } catch {
        }

        return manifest;
    } finally {
        await fs.rm(tempRoot, { recursive: true, force: true });
    }
}

async function mergeDirectoryContents(sourceDir: string, targetDir: string): Promise<void> {
    await fs.mkdir(targetDir, { recursive: true });
    const entries = await fs.readdir(sourceDir, { withFileTypes: true });

    for (const entry of entries) {
        const sourcePath = path.join(sourceDir, entry.name);
        const targetPath = path.join(targetDir, entry.name);

        if (entry.isDirectory()) {
            await mergeDirectoryContents(sourcePath, targetPath);
        } else if (entry.isFile()) {
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
            await fs.copyFile(sourcePath, targetPath);
        }
    }
}

async function mergeAnalysisFromProjectRoot(projectDir: string, projectRootPath: string): Promise<void> {
    const sourceAnalysisDir = path.join(projectRootPath, "analysis");
    const targetAnalysisDir = path.join(projectDir, "analysis");

    try {
        await fs.access(sourceAnalysisDir);
    } catch {
        return;
    }

    await mergeDirectoryContents(sourceAnalysisDir, targetAnalysisDir);
}
