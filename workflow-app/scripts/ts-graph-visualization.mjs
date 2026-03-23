function fileOf(node) {
    return node.repoRelativePath || node.filePath || "unknown-file";
}

function toVisualizationNode(node) {
    return {
        key: node.id,
        name: node.name || node.simpleName || node.id,
        file: fileOf(node),
        line: typeof node.line === "number" ? node.line : 0,
    };
}

function makeEdgeRecord(edge) {
    return {
        from: edge.from,
        to: edge.to,
        scope: edge.scope || null,
        kind: edge.kind,
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
            const la = typeof a.line === "number" ? a.line : 0;
            const lb = typeof b.line === "number" ? b.line : 0;
            if (la !== lb) return la - lb;
            return (a.name || a.id).localeCompare(b.name || b.id);
        });

        for (let i = 0; i < groupedNodes.length; i += 1) {
            functionNodes.push(toVisualizationNode(groupedNodes[i]));
        }
    }

    // processing all valid edges and categorizing them
    const allEdges = edges.filter((edge) => typeof edge.from === "string" && typeof edge.to === "string" && !!edge.to).map((edge) => makeEdgeRecord(edge));

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
