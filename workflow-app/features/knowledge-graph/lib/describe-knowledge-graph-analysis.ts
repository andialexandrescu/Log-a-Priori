export type KnowledgeGraphAnalysisPhase = "creating" | "scanning" | "complete" | "error";

export type AnalysisStepId = "clear" | "scan" | "build";

const STEP_ORDER: AnalysisStepId[] = ["clear", "scan", "build"];

export function resolveAnalysisStepFromLog(log: string): AnalysisStepId | null {
    const line = log.trim();
    if (!line) {
        return null;
    }

    if (line.includes("Deleted analysis folder") || line.includes("Could not delete analysis folder")) {
        return "clear";
    }

    if (line.includes("AST Analysis started")) {
        return "scan";
    }

    if (
        line.includes("Analysis completed") ||
        line.includes("Analyzed files:") ||
        line.includes("Report:") ||
        line.includes("Functions:") ||
        line.includes("Call edges:") ||
        line.includes("Uses edges:") ||
        line.includes("Total edges:") ||
        line.includes("Removed isolated nodes:") ||
        line.includes("Building per commit") ||
        line.includes("Function history rebuilt") ||
        (line.includes("Found ") && line.includes("candidate directories")) ||
        line.includes("Loaded baseline") ||
        line.includes("index written") ||
        line.includes("Baseline updated") ||
        line.includes("Baseline saved") ||
        line.includes("Baseline continuity") ||
        line.includes("commit details:") ||
        line.includes("Reading manifest links:")
    ) {
        return "build";
    }

    return null;
}

export function advanceAnalysisStep(current: AnalysisStepId, incoming: AnalysisStepId): AnalysisStepId {
    const currentIndex = STEP_ORDER.indexOf(current);
    const incomingIndex = STEP_ORDER.indexOf(incoming);
    return incomingIndex > currentIndex ? incoming : current;
}

export function describeAnalysisStep(stepId: AnalysisStepId): { title: string; description: string } {
    switch (stepId) {
        case "clear":
            return {
                title: "Preparing analysis workspace",
                description:
                    "Removing the previous analysis folder so the graph can be rebuilt from your updated project root",
            };
        case "scan":
            return {
                title: "Scanning your codebase",
                description:
                    "Walking the project root you selected and parsing TypeScript and JavaScript with the AST analyzer",
            };
        case "build":
            return {
                title: "Building knowledge graph",
                description:
                    "Writing ts-code-graph.json, indexing commit history, and rebuilding function history for this project",
            };
    }
}

export function describeKnowledgeGraphAnalysisState(options: { phase: KnowledgeGraphAnalysisPhase; currentStep?: AnalysisStepId | null; }): { title: string; description: string } {
    if (options.phase === "creating") {
        return {
            title: "Creating your project",
            description:
                "Saving the project and linking the folder you chose, code analysis starts right after this step",
        };
    }

    if (options.phase === "complete") {
        return {
            title: "Knowledge graph ready",
            description:
                "ts-code-graph.json was generated, you can explore the graph canvas and run cluster search next",
        };
    }

    if (options.phase === "error") {
        return {
            title: "Knowledge graph build failed",
            description: "Check the desktop shell logs and try again from the knowledge graph tab",
        };
    }

    if (options.currentStep) {
        return describeAnalysisStep(options.currentStep);
    }

    return {
        title: "Building knowledge graph in the background",
        description:
            "This runs in the desktop app: your project root is analyzed and ts-code-graph.json is created, the first run can take a few minutes on large repos",
    };
}
