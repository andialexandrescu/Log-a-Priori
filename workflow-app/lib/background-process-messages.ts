import type { EmbeddingsProgress } from "@/features/knowledge-graph/lib/ensure-graph-embeddings";
import type { AnalysisStepId, KnowledgeGraphAnalysisPhase } from "@/features/knowledge-graph/lib/describe-knowledge-graph-analysis";
import { describeEmbeddingsPhase } from "@/features/knowledge-graph/lib/ensure-graph-embeddings";
import { describeKnowledgeGraphAnalysisState } from "@/features/knowledge-graph/lib/describe-knowledge-graph-analysis";

export type CommitSyncMode = "idle" | "mount" | "manual" | "auto" | "reconcile";

export function describeCommitSyncProcess(options: { mode: CommitSyncMode; isActive: boolean; repository?: string | null; summaryLine?: string | null; }): { title: string; description: string; status: "active" | "idle" } {
    const repo = options.repository ? ` (${options.repository})` : "";

    if (options.mode === "mount" && options.isActive) {
        return {
            status: "active",
            title: "Checking GitHub for new commits",
            description:
                `Comparing the latest commits on GitHub with your appdata${repo}, if you are already up to date, this usually finishes after a single page of results`,
        };
    }

    if (options.mode === "manual" && options.isActive) {
        return {
            status: "active",
            title: "Checking GitHub for new commits",
            description:
                `Fetching new commits from GitHub${repo} and saving any missing ones to your project folder in appdata`,
        };
    }

    if (options.mode === "auto" && options.isActive) {
        return {
            status: "active",
            title: "Checking for new commits",
            description: `Quick GitHub check${repo} for commits that may not have arrived via webhook yet`,
        };
    }

    if (options.mode === "reconcile" && options.isActive) {
        return {
            status: "active",
            title: "Repairing commit exports",
            description:
                `Checking PocketBase commits${repo} and re-exporting missing AppData files (up to 25 per run)`,
        };
    }

    if (options.summaryLine) {
        return {
            status: "idle",
            title: "Commit sync",
            description: options.summaryLine,
        };
    }

    return {
        status: "idle",
        title: "Commit sync",
        description: "Up to date",
    };
}

export function commitRefreshInfo(): { title: string; description: string } {
    return {
        title: "Refresh commits",
        description:
            "Fetches new commits from GitHub that are not in PocketBase yet, stores them as webhook events, and exports changed files to AppData, use this to catch up when webhooks were missed or after reconnecting GitHub",
    };
}

export function commitImportInfo(): { title: string; description: string } {
    return {
        title: "Import commits from GitHub",
        description:
            "Loads your repository's commit history from GitHub into PocketBase and exports file snapshots to AppData, this runs automatically the first time you open this tab, use the button to retry if the initial import did not finish",
    };
}

export function commitExportReconcileInfo(): { title: string; description: string } {
    return {
        title: "Repair exports",
        description:
            "Checks commits already stored in PocketBase and re-exports any missing files to AppData (added/ modified/ removed), use this when local snapshots were deleted or a previous export failed, it repairs up to 25 commits per run, click again if more are still missing",
    };
}

export type CommitSyncRefreshInfo = {
    newCommitsFound: number;
    currentTotal: number;
    previousTotal?: number;
    reconcileRepaired?: number;
    reconcileFailures?: number;
    reconcileMissingRemaining?: number;
    newCommitFilesExported?: number;
    newCommitExportFailures?: number;
};

export function describeCommitSyncResultSummary(
    info: CommitSyncRefreshInfo,
    options: { reconcile?: boolean; isFirstImport?: boolean }
): string {
    if (options.reconcile) {
        const repaired = info.reconcileRepaired ?? 0;
        const failures = info.reconcileFailures ?? 0;
        const remaining = info.reconcileMissingRemaining ?? 0;

        if (repaired > 0) {
            let message = `Repaired ${repaired} missing commit export${repaired === 1 ? "" : "s"}`;
            if (failures > 0) {
                message += ` (${failures} failed)`;
            }
            if (remaining > 0) {
                message += `, ${remaining} still missing, run Repair exports again`;
            }
            return message;
        }

        if (failures > 0) {
            return `Could not repair commit exports (${failures} failed)`;
        }

        return `All commit exports are already on disk (${info.currentTotal} in PocketBase)`;
    }

    if (info.newCommitsFound > 0) {
        const exported = info.newCommitFilesExported ?? 0;
        const failed = info.newCommitExportFailures ?? 0;
        let message = options.isFirstImport
            ? `Imported ${info.newCommitsFound} commit${info.newCommitsFound === 1 ? "" : "s"} from GitHub`
            : `Added ${info.newCommitsFound} new commit${info.newCommitsFound === 1 ? "" : "s"} from GitHub`;

        if (exported > 0 && failed === 0) {
            message += ` and exported file snapshots for ${exported}`;
        } else if (exported > 0 && failed > 0) {
            message += `, exported files for ${exported}, ${failed} export${failed === 1 ? "" : "s"} failed`;
        } else if (failed > 0) {
            message += `, file export failed for ${failed} commit${failed === 1 ? "" : "s"}`;
        }

        if (options.isFirstImport) {
            return `${message} (${info.currentTotal} total)`;
        }

        const previousTotal = info.previousTotal ?? info.currentTotal - info.newCommitsFound;
        return `${message} (${previousTotal} → ${info.currentTotal})`;
    }

    if (options.isFirstImport) {
        if (info.currentTotal > 0) {
            return `Commit history already imported (${info.currentTotal} commit${info.currentTotal === 1 ? "" : "s"} in PocketBase)`;
        }
        return "No commits found on GitHub for this repository";
    }

    return `Already up to date, no new commits on GitHub (${info.currentTotal} in PocketBase)`;
}

export function describeCommitSyncResultToast(
    info: CommitSyncRefreshInfo,
    options: { reconcile?: boolean; isFirstImport?: boolean }
): { message: string; tone: "success" | "info" } {
    const message = describeCommitSyncResultSummary(info, options);
    const nothingChanged = options.reconcile
        ? (info.reconcileRepaired ?? 0) === 0 && (info.reconcileFailures ?? 0) === 0
        : info.newCommitsFound === 0;

    return {
        message,
        tone: nothingChanged ? "info" : "success",
    };
}

export function commitSyncListeningInfo(): { title: string; description: string } {
    return {
        title: "How commits arrive while this app is open",
        description:
            "New pushes to your connected repo are sent by GitHub to our webhook (stored in PocketBase and copied to appdata), while this tab is open we also check GitHub periodically for any commits the webhook might have missed",
    };
}

export function webhookEventsEmptyState(options: {
    hasCredential: boolean;
    // true when viewing a shared project and using the owner's github integration
    inherited: boolean;
}): { title: string; description: string } {
    if (options.hasCredential) {
        return {
            title: "Importing commit history",
            description:
                "GitHub is connected, we are fetching existing commits from your repository into PocketBase and your local commit storage, this runs automatically the first time you open this tab",
        };
    }

    if (options.inherited) {
        return {
            title: "Waiting for the project owner's commits",
            description:
                "The project owner still needs to connect GitHub for this project, when they receive webhook events, shared commit history may appear here depending on your access",
        };
    }

    return {
        title: "No webhook events yet",
        description:
            "Set up GitHub integration for this project (sidebar), that registers a webhook on your repo and imports existing commits, after that, pushes appear here automatically",
    };
}

export function describeProjectShareImport(isActive: boolean): { title: string; description: string; status: "active" | "idle";} {
    if (isActive) {
        return {
            status: "active",
            title: "Importing shared project data",
            description:
                "Unpacking the project package into your appdata folder on this machine (graphs, commits, documentation, and settings scoped to your user)",
        };
    }
    return {
        status: "idle",
        title: "Project share",
        description: "Accept to import a teammate's packaged project into your local workspace",
    };
}

export function embeddingsToPanel(progress: EmbeddingsProgress | null, isActive: boolean) {
    const { title, description, percent } = describeEmbeddingsPhase(progress);
    return {
        title,
        description,
        progressPercent: percent,
        status: isActive ? ("active" as const) : ("idle" as const),
    };
}

export function knowledgeGraphAnalysisToPanel(
    phase: KnowledgeGraphAnalysisPhase,
    currentStep: AnalysisStepId | null,
    isActive: boolean
) {
    const { title, description } = describeKnowledgeGraphAnalysisState({
        phase: isActive && phase === "scanning" ? "scanning" : phase,
        currentStep: isActive && phase === "scanning" ? currentStep : null,
    });
    const status =
        phase === "error"
            ? ("error" as const)
            : phase === "complete"
              ? ("complete" as const)
              : isActive
                ? ("active" as const)
                : ("idle" as const);
    return { title, description, status };
}
