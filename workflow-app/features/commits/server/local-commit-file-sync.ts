import fs from "node:fs/promises";
import path from "node:path";
import { githubHeaders, type EnrichedCommitPayload } from "./github-commits-utils";
import { getDesktopSettingsFilePath, getProjectCommitsDirectory } from "@desktop-shell/shared/desktop-shell-paths";

type FileOperation = "added" | "modified" | "removed";

type SyncCommitFilesInput = {
    repository: string;
    token: string;
    commit: EnrichedCommitPayload;
    userId?: string;
    projectId?: string;
};

type DesktopSettings = {
    githubFilesRoot?: string;
};

async function getSelectedRootDirectory(userId?: string, projectId?: string): Promise<string | null> {
    if (userId && projectId) {
        return getProjectCommitsDirectory(userId, projectId);
    }

    try {
        const raw = await fs.readFile(getDesktopSettingsFilePath(), "utf8");
        const parsed = JSON.parse(raw) as DesktopSettings;

        if (typeof parsed.githubFilesRoot === "string" && parsed.githubFilesRoot.trim()) {
            return parsed.githubFilesRoot;
        }
    } catch {
    }

    return null;
}

async function getCommitDirectoryIfConfigured(
    repository: string,
    sha: string,
    userId?: string,
    projectId?: string
): Promise<string | null> {
    const rootDirectory = await getSelectedRootDirectory(userId, projectId);

    if (!rootDirectory || !sha) {
        return null;
    }

    return getCommitDirectory(rootDirectory, repository, sha);
}

function sanitizePathSegments(value: string): string[] {
    return value
        .split(/[\\/]+/)
        .filter((segment) => !!segment && segment !== "." && segment !== "..");
}

function getCommitDirectory(rootDirectory: string, repository: string, sha: string): string {
    const repositorySegments = sanitizePathSegments(repository);
    return path.join(rootDirectory, ...repositorySegments, "commits", sha);
}

function getRelativeFilePath(filePath: string): string {
    const sanitizedSegments = sanitizePathSegments(filePath);
    return path.join(...sanitizedSegments);
}

async function fetchFileContent(params: { owner: string; repoName: string; filePath: string; ref: string; token: string; }): Promise<Buffer | null> {
    const encodedPath = params.filePath
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");

    const response = await fetch(
        `https://api.github.com/repos/${params.owner}/${params.repoName}/contents/${encodedPath}?ref=${encodeURIComponent(params.ref)}`,
        {
            headers: {
                ...githubHeaders(params.token),
                Accept: "application/vnd.github.raw",
            },
        }
    );

    if (!response.ok) {
        return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
}

async function writeCommitFile(params: { commitDirectory: string; operation: FileOperation; filePath: string; content: Buffer; }): Promise<void> {
    const relativeFilePath = getRelativeFilePath(params.filePath);
    const targetPath = path.join(params.commitDirectory, params.operation, relativeFilePath);

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, params.content);
}

async function writeRemovedPlaceholder(params: { commitDirectory: string; filePath: string; sha: string; }): Promise<void> {
    const relativeFilePath = `${getRelativeFilePath(params.filePath)}.removed.txt`;
    const targetPath = path.join(params.commitDirectory, "removed", relativeFilePath);

    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, `Removed in commit ${params.sha}\nOriginal path: ${params.filePath}\n`, "utf8");
}

async function writeManifest(params: { commitDirectory: string; repository: string; commit: EnrichedCommitPayload; }): Promise<void> {
    const manifestPath = path.join(params.commitDirectory, "manifest.json");
    const manifest = {
        repository: params.repository,
        sha: params.commit.sha,
        branch: params.commit.branch,
        message: params.commit.commit?.message,
        author: params.commit.commit?.author,
        committer: params.commit.commit?.committer,
        added: params.commit.added,
        modified: params.commit.modified,
        removed: params.commit.removed,
        exportedAt: new Date().toISOString(),
        previousSha: null as string | null, // will be populated after chronological sorting
        nextSha: null as string | null,
    };

    await fs.mkdir(params.commitDirectory, { recursive: true });
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
}

export async function syncCommitFilesToSelectedRoot({ repository, token, commit, userId, projectId }: SyncCommitFilesInput): Promise<void> {
    const rootDirectory = await getSelectedRootDirectory(userId, projectId);
    const sha = typeof commit.sha === "string" ? commit.sha : "";

    if (!rootDirectory || !sha) {
        return;
    }

    const [owner, repoName] = repository.split("/");
    if (!owner || !repoName) {
        return;
    }

    const commitDirectory = getCommitDirectory(rootDirectory, repository, sha);
    const parentSha = typeof commit.parents?.[0]?.sha === "string" ? commit.parents[0].sha : "";

    await writeManifest({ commitDirectory, repository, commit });

    for (const addedFile of commit.added) {
        const content = await fetchFileContent({ owner, repoName, filePath: addedFile, ref: sha, token });
        if (content) {
            await writeCommitFile({ commitDirectory, operation: "added", filePath: addedFile, content });
        }
    }

    for (const modifiedFile of commit.modified) {
        const content = await fetchFileContent({ owner, repoName, filePath: modifiedFile, ref: sha, token });
        if (content) {
            await writeCommitFile({ commitDirectory, operation: "modified", filePath: modifiedFile, content });
        }
    }

    for (const removedFile of commit.removed) {
        if (parentSha) {
            const content = await fetchFileContent({ owner, repoName, filePath: removedFile, ref: parentSha, token });
            if (content) {
                await writeCommitFile({ commitDirectory, operation: "removed", filePath: removedFile, content });
                continue;
            }
        }

        await writeRemovedPlaceholder({ commitDirectory, filePath: removedFile, sha });
    }
}

export async function hasCommitFilesExport(
    repository: string,
    sha: string,
    userId?: string,
    projectId?: string
): Promise<boolean> {
    const commitDirectory = await getCommitDirectoryIfConfigured(repository, sha, userId, projectId);

    if (!commitDirectory) {
        return false;
    }

    try {
        await fs.access(path.join(commitDirectory, "manifest.json"));
        return true;
    } catch {
        return false;
    }
}