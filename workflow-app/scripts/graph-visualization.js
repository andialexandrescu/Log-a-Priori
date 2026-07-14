function fileOf(node) {
    return node.repoRelativePath || node.filePath || "unknown-file";
}

function moduleKeyToFilePath(moduleKey) {
    return moduleKey.startsWith("module:") ? moduleKey.slice("module:".length) : moduleKey;
}

function toVisualizationNode(node) {
    return {
        key: node.id,
        name: node.simpleName || node.name || node.id,
        file: fileOf(node),
        line: typeof node.startLine === "number" ? node.startLine : typeof node.line === "number" ? node.line : 0,
        kind: node.kind,
        simpleName: node.simpleName || node.name || node.id,
    };
}

function toModuleVisualizationNode(moduleKey) {
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

function makeEdgeRecord(edge) {
    return {
        from: edge.from,
        to: edge.to,
        scope: edge.scope || null,
        kind: edge.kind,
        relation: edge.relation || null,
        label: edge.label || null,
        filePath: edge.filePath || null,
        startLine: typeof edge.startLine === "number" ? edge.startLine : null,
    };
}

function computeConnectedComponents(nodes, edges) {
    const adjacency = new Map(); // adjancency for all nodes
    const keys = nodes.map((node) => node.key);

    for (const key of keys) {
        adjacency.set(key, new Set());
    }

    for (const edge of edges) {
        if (!adjacency.has(edge.from) || !adjacency.has(edge.to)) {
            continue; // skip edges with referencing nonexistent nodes
        }
        adjacency.get(edge.from).add(edge.to);
        adjacency.get(edge.to).add(edge.from);
    }

    const visited = new Set();
    const components = [];

    for (const key of keys) {
        if (visited.has(key)) {
            continue;
        }

        const stack = [key];
        const component = [];
        visited.add(key);

        while (stack.length > 0) {
            const current = stack.pop();
            if (!current) continue;
            component.push(current);

            for (const neighbor of adjacency.get(current) || []) { // add all unvisited neighbours
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    stack.push(neighbor);
                }
            }
        }

        components.push(component);
    }

    return components.sort((a, b) => b.length - a.length);
}

export function buildVisualization(nodes, edges) {
    const files = [...new Set(nodes.map((node) => fileOf(node)))].sort((a, b) => a.localeCompare(b)); // unique files

    const nodesPerFile = new Map();
    for (const node of nodes) {
        const file = fileOf(node);
        if (!nodesPerFile.has(file)) {
            nodesPerFile.set(file, []); // grouping nodes by file
        }
        nodesPerFile.get(file).push(node);
    }

    const functionNodes = [];
    for (const file of files) {
        const groupedNodes = (nodesPerFile.get(file) || []).sort((a, b) => { // sort by line number, then by name
            const la = typeof a.startLine === "number" ? a.startLine : typeof a.line === "number" ? a.line : 0;
            const lb = typeof b.startLine === "number" ? b.startLine : typeof b.line === "number" ? b.line : 0;
            if (la !== lb) return la - lb;
            return (a.name || a.id).localeCompare(b.name || b.id);
        });

        for (let i = 0; i < groupedNodes.length; i += 1) {
            functionNodes.push(toVisualizationNode(groupedNodes[i]));
        }
    }

    const allEdges = edges
        .filter((edge) => typeof edge.from === "string" && typeof edge.to === "string" && !!edge.to)
        .map((edge) => makeEdgeRecord(edge));

    const moduleKeys = new Set(
        allEdges
            .map((edge) => edge.from)
            .filter((from) => typeof from === "string" && from.startsWith("module:"))
    );
    const existingKeys = new Set(functionNodes.map((node) => node.key));
    for (const moduleKey of moduleKeys) {
        if (existingKeys.has(moduleKey)) continue;
        functionNodes.push(toModuleVisualizationNode(moduleKey));
        existingKeys.add(moduleKey);
    }

    const callsInFile = allEdges.filter((edge) => edge.scope !== "cross-file");
    const callsCrossFile = allEdges.filter((edge) => edge.scope === "cross-file");

    const components = computeConnectedComponents(functionNodes, [
        ...callsInFile,
        ...callsCrossFile,
    ]);

    return {
        functionNodes,
        edges: {
            calls: {
                inFile: callsInFile,
                crossFile: callsCrossFile,
            },
        },
        components,
    };
}
