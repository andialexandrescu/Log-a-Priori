export type GraphEdgeRelation = "call" | "reference" | "jsx-component" | "module-import";

export type GraphEdgeDetails = {
    from?: string;
    to?: string;
    kind?: string;
    scope?: string | null;
    relation?: GraphEdgeRelation | string | null;
    label?: string | null;
    filePath?: string | null;
    startLine?: number | null;
};

export function inferGraphEdgeRelation(edge: GraphEdgeDetails): GraphEdgeRelation {
    if (edge.relation === "call" || edge.relation === "reference" || edge.relation === "jsx-component" || edge.relation === "module-import") {
        return edge.relation;
    }

    if (edge.from?.startsWith("module:")) {
        return "module-import";
    }

    if ((edge.kind ?? "CALLS").toUpperCase() === "USES") {
        return "reference";
    }

    return "call";
}

export function formatGraphEdgeKindScope(edge: GraphEdgeDetails): string {
    const kind = (edge.kind ?? "CALLS").toUpperCase();
    const scope = edge.scope === "cross-file" ? "cross-file" : "in-file";
    return `${kind} · ${scope}`;
}

export function formatGraphEdgeRelation(edge: GraphEdgeDetails): string {
    switch (inferGraphEdgeRelation(edge)) {
        case "call":
            return "Direct call";
        case "reference":
            return "Reference / callback";
        case "jsx-component":
            return "JSX component";
        case "module-import":
            return "Module import usage";
        default:
            return "Unknown relation";
    }
}

export function formatGraphNodeKindLabel(kind?: string): string {
    switch (kind) {
        case "function":
            return "Top-level function";
        case "method":
            return "Class method";
        case "lambda":
            return "Arrow / function expression";
        case "module":
            return "Module import anchor";
        default:
            return kind ?? "function";
    }
}

export type GraphVisualizationNode = {
    key: string;
    name: string;
    file: string;
    line: number;
    kind?: string;
    simpleName?: string;
};

function moduleKeyToFilePath(moduleKey: string) {
    return moduleKey.startsWith("module:") ? moduleKey.slice("module:".length) : moduleKey;
}

export function createModuleVisualizationNode(moduleKey: string): GraphVisualizationNode {
    const filePath = moduleKeyToFilePath(moduleKey).split("\\").join("/");
    const fileName = filePath.split("/").pop() || filePath;
    return {
        key: moduleKey,
        name: `[module] ${fileName}`,
        file: filePath,
        line: 0,
        kind: "module",
        simpleName: fileName,
    };
}

function edgeIdentity(edge: GraphEdgeDetails) {
    return `${edge.from}|${edge.to}|${(edge.kind ?? "CALLS").toUpperCase()}|${edge.scope ?? ""}|${edge.startLine ?? ""}|${edge.label ?? ""}`;
}

function edgeLooseIdentity(edge: GraphEdgeDetails) {
    return `${edge.from}|${edge.to}|${(edge.kind ?? "CALLS").toUpperCase()}|${edge.scope ?? ""}`;
}

export function mergeGraphEdgeDetails(baseEdges: GraphEdgeDetails[], rawEdges: GraphEdgeDetails[] | undefined): GraphEdgeDetails[] {
    if (!rawEdges?.length) {
        return baseEdges;
    }

    const rawByIdentity = new Map(rawEdges.map((edge) => [edgeIdentity(edge), edge]));
    const rawByLoose = new Map<string, GraphEdgeDetails[]>();
    for (const edge of rawEdges) {
        const key = edgeLooseIdentity(edge);
        if (!rawByLoose.has(key)) {
            rawByLoose.set(key, []);
        }
        rawByLoose.get(key)!.push(edge);
    }

    return baseEdges.map((edge) => {
        const exact = rawByIdentity.get(edgeIdentity(edge));
        const raw = exact ?? rawByLoose.get(edgeLooseIdentity(edge))?.[0];
        if (!raw) {
            return edge;
        }
        return {
            ...edge,
            kind: edge.kind ?? raw.kind,
            scope: edge.scope ?? raw.scope,
            relation: edge.relation ?? raw.relation,
            label: edge.label ?? raw.label,
            filePath: edge.filePath ?? raw.filePath,
            startLine: edge.startLine ?? raw.startLine,
        };
    });
}

export function augmentVisualizationNodes(nodes: GraphVisualizationNode[], edges: GraphEdgeDetails[]): GraphVisualizationNode[] {
    const next = [...nodes];
    const existing = new Set(next.map((node) => node.key));

    for (const edge of edges) {
        if (!edge.from?.startsWith("module:") || existing.has(edge.from)) {
            continue;
        }
        next.push(createModuleVisualizationNode(edge.from));
        existing.add(edge.from);
    }

    return next;
}

export type GraphEdgeStats = {
    edges: number;
    callsInFile: number;
    callsCrossFile: number;
    usesInFile: number;
    usesCrossFile: number;
    callDirect: number;
    jsxComponent: number;
    reference: number;
    moduleImport: number;
};

export function computeGraphEdgeStats(edges: GraphEdgeDetails[]): GraphEdgeStats {
    const stats: GraphEdgeStats = {
        edges: edges.length,
        callsInFile: 0,
        callsCrossFile: 0,
        usesInFile: 0,
        usesCrossFile: 0,
        callDirect: 0,
        jsxComponent: 0,
        reference: 0,
        moduleImport: 0,
    };

    for (const edge of edges) {
        const kind = (edge.kind ?? "CALLS").toUpperCase();
        const isCrossFile = edge.scope === "cross-file";
        if (kind === "CALLS") {
            if (isCrossFile) stats.callsCrossFile += 1;
            else stats.callsInFile += 1;
        } else {
            if (isCrossFile) stats.usesCrossFile += 1;
            else stats.usesInFile += 1;
        }

        switch (inferGraphEdgeRelation(edge)) {
            case "call":
                stats.callDirect += 1;
                break;
            case "jsx-component":
                stats.jsxComponent += 1;
                break;
            case "reference":
                stats.reference += 1;
                break;
            case "module-import":
                stats.moduleImport += 1;
                break;
        }
    }

    return stats;
}
