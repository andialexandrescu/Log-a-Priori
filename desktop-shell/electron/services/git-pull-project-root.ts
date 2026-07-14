import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export type GitPullResult =
    | { ok: true; message: string; stdout: string }
    | { ok: false; error: string };

function runGitPull(projectRoot: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
        const child = spawn("git", ["pull", "--ff-only"], {
            cwd: projectRoot,
            shell: process.platform === "win32",
            windowsHide: true,
        });

        let stdout = "";
        let stderr = "";

        child.stdout?.on("data", (chunk: Buffer) => {
            stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk: Buffer) => {
            stderr += chunk.toString();
        });

        child.on("close", (code) => {
            resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
        });

        child.on("error", (error) => {
            resolve({
                code: 1,
                stdout: "",
                stderr: error instanceof Error ? error.message : String(error),
            });
        });
    });
}

export async function pullLatestInProjectRoot(projectRoot: string): Promise<GitPullResult> {
    const resolvedRoot = path.resolve(projectRoot);

    if (!fs.existsSync(resolvedRoot)) {
        return { ok: false, error: "Project root folder does not exist on disk." };
    }

    const gitDir = path.join(resolvedRoot, ".git");
    if (!fs.existsSync(gitDir)) {
        return {
            ok: false,
            error: "Project root is not a git repository, pull your latest code manually, then re-run analysis",
        };
    }

    const { code, stdout, stderr } = await runGitPull(resolvedRoot);

    if (code === 0) {
        return {
            ok: true,
            message: stdout || "Project folder is up to date with the remote.",
            stdout,
        };
    }

    const detail = stderr || stdout || `git pull exited with code ${code ?? "unknown"}`;
    return {
        ok: false,
        error: detail.includes("CONFLICT") || detail.includes("conflict")
            ? "git pull failed due to merge conflicts, resolve them in your repo, then re-run analysis"
            : `git pull failed: ${detail}`,
    };
}
