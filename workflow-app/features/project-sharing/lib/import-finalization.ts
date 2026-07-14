import fs from "node:fs/promises";
import { getProjectGraphFilePath } from "@desktop-shell/shared/desktop-shell-paths";
import { clearProjectRootSettings } from "@desktop-shell/shared/delete-user-project-data";

export async function clearRecipientProjectRoot( recipientUserId: string, projectId: string): Promise<void> {
    await clearProjectRootSettings(recipientUserId, projectId);
}

export async function finalizeImportedProjectData(params: { recipientUserId: string; projectId: string; senderProjectRootPath?: string | null; }): Promise<void> {
    await clearRecipientProjectRoot(params.recipientUserId, params.projectId);

    const graphPath = getProjectGraphFilePath(params.recipientUserId, params.projectId);
    try {
        const raw = await fs.readFile(graphPath, "utf8");
        const graph = JSON.parse(raw) as {
            input?: { root?: string };
            nodes?: Array<{ filePath?: string }>;
        };

        let changed = false;
        const senderRoot = params.senderProjectRootPath?.trim();

        if (graph.input?.root) {
            if (!senderRoot || graph.input.root === senderRoot) {
                delete graph.input.root;
                changed = true;
            }
        }

        if (senderRoot && Array.isArray(graph.nodes)) {
            for (const node of graph.nodes) {
                if (node.filePath?.startsWith(senderRoot)) {
                    node.filePath = node.filePath.slice(senderRoot.length).replace(/^[/\\]+/, "");
                    changed = true;
                }
            }
        }

        if (changed) {
            await fs.writeFile(graphPath, JSON.stringify(graph, null, 2), "utf8");
        }
    } catch {
        // graph file is optional until analysis has been run
    }
}
