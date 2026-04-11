const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { buildVisualization } = require("./graph-visualization.js");
const { analyzeCommitDirectory: tsAnalyzeCommit, analyzeFullProject: tsAnalyzeFullProject } = require('./ts-ast-tree.js');
console.log("ts-ast-tree.js loaded");

function parseRoot(argv) {
    const args = {
        root: "",
        fullProject: false,
        projectId: null,
    };

    if (argv[2]) {
        args.root = argv[2];
    }

    if (!args.root) {
        throw new Error("Missing required root path argument");
    }

    if (argv.includes("--full-project")) { // yet to implement the per commit analysis
        args.fullProject = true;
    }

    const projectIdIndex = argv.indexOf("--project-id"); // in order to be able save specific ts-code-analysis.json to project based subfolder inside appdata
    if (projectIdIndex !== -1 && argv[projectIdIndex + 1]) {
        args.projectId = argv[projectIdIndex + 1];
    }

    return args;
}


async function exists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function readJsonIfExists(filePath) {
    try {
        const raw = await fs.readFile(filePath, "utf8");
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

async function listDirectories(targetPath) {
    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(targetPath, entry.name));
}

async function isCommitDirectory(targetPath) {
    const added = path.join(targetPath, "added");
    const modified = path.join(targetPath, "modified");
    const removed = path.join(targetPath, "removed");
    return (await exists(added)) || (await exists(modified)) || (await exists(removed));
}

async function discoverCommitDirectories(rootPath) { // returns a list consisting of /path/to/owner/repo/commits/commit_sha
    const normalizedRoot = path.resolve(rootPath);
    const commitDirs = []

    // broad bfs search - up to commits folder
    const queue = [{ dir: normalizedRoot, depth: 0 }];
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current || current.depth >= 4) continue;

        if (path.basename(current.dir).toLowerCase() === "commits") {
            try { // check children of commits folder for actual commit dirs
                const children = await listDirectories(current.dir);
                for (const child of children) {
                    if (await isCommitDirectory(child)) {
                        commitDirs.push(child);
                    }
                }
            } catch {}
            continue;
        }

        try {
            const children = await listDirectories(current.dir);
            for (const child of children) {
                queue.push({ dir: child, depth: current.depth + 1 });
            }
        } catch {}
    }

    return commitDirs.sort();
}

async function getCommitSortInfo(commitDirectory) { // input from discoverCommitDirectories(), extracts commit timestamps for sorting commits based on date
    const manifestPath = path.join(commitDirectory, "manifest.json"); // the path to commit_sha subdir manifest file
    const manifest = await readJsonIfExists(manifestPath);
    const dateValue = manifest?.committer?.date || manifest?.author?.date || manifest?.exportedAt || null;
    const timestamp = dateValue ? Date.parse(dateValue) : Number.NaN;

    return {
        commitDirectory, // passes through unchanged
        sha: path.basename(commitDirectory),
        sortTime: Number.isNaN(timestamp) ? null : timestamp, // adding this for the sort condition
    };
}

async function analyzeCommitDirectory(commitDirectory) { // yet to include this after new approach
    return await tsAnalyzeCommit(commitDirectory);
}

async function analyzeFullProjectDirectory(projectRoot) {
    return await tsAnalyzeFullProject(projectRoot);
}

function buildDefaultOutputPath(rootPath, repoPath = "") {
    const normalizedRoot = path.resolve(rootPath);

    if (repoPath) {
        const repoSegments = repoPath.split(/[\\/]+/).filter(Boolean);
        return path.join(normalizedRoot, ...repoSegments, "analysis", "ts-code-graph.json");
    }

    if (path.basename(normalizedRoot).toLowerCase() === "commits") {
        return path.join(path.dirname(normalizedRoot), "analysis", "ts-code-graph.json");
    }

    return path.join(normalizedRoot, "analysis", "ts-code-graph.json");
}

function buildAppdataOutputPath(projectId) {
    const appData = process.env.APPDATA?.trim();
    const baseDir = appData 
        ? path.join(appData, "log-a-priori-desktop-shell", projectId)
        : path.join(os.homedir(), "AppData", "Roaming", "log-a-priori-desktop-shell", projectId);
    return path.join(baseDir, "analysis", "ts-code-graph.json");
}

function removeIsolatedNodes(nodes, edges) {
    const connectedNodeIds = new Set();
    const nodeIdSet = new Set(nodes.map(n => n.id)); // track which IDs actually exist as nodes

    for (const edge of edges) { // add both from and to, but only count as connected if they're actual nodes or if they're used as edge targets (functions used by modules)
        if (edge?.from && nodeIdSet.has(edge.from)) {
            connectedNodeIds.add(edge.from);
        }
        if (edge?.to && nodeIdSet.has(edge.to)) {
            connectedNodeIds.add(edge.to);
        }
        
        if (edge?.to && edge.to.startsWith('entity:') && nodeIdSet.has(edge.to)) { // if edge.to exists as a node, mark it as connected even if edge.from doesn't (module level code using a function)
            connectedNodeIds.add(edge.to);
        }
    }

    if (edges.length === 0) {  // if there are edges, filter out isolated nodes
        // for projects with no resolvable edges, keep all nodes
        return {
            nodes: nodes,
            edges: edges,
            removedCount: 0,
        };
    }

    const filteredNodes = nodes.filter((node) => connectedNodeIds.has(node.id));
    const filteredNodeIds = new Set(filteredNodes.map((node) => node.id));
    const filteredEdges = edges.filter((edge) => { // keeping edges where both sides match actual nodes or where edge.to exists as a node
        const fromExists = nodeIdSet.has(edge.from);
        const toExists = nodeIdSet.has(edge.to);
        return toExists && (filteredNodeIds.has(edge.from) || !edge.from.startsWith('entity:'));
    });

    return {
        nodes: filteredNodes,
        edges: filteredEdges,
        removedCount: nodes.length - filteredNodes.length,
    };
}

async function run() {
    const args = parseRoot(process.argv);
    
    console.log(`Full project mode: ${args.fullProject}`);
    if (args.projectId) {
        console.log(`Project ID: ${args.projectId}`);
    }
    
    if (args.fullProject) { // analyze the full project directory
        console.log(`Analyzing full project at: ${path.resolve(args.root)}`);
        const result = await analyzeFullProjectDirectory(args.root);
        
        const nodes = result.functions;
        const edges = result.edges;
        
        const prunedGraph = removeIsolatedNodes(nodes, edges);
        const finalNodes = prunedGraph.nodes;
        const finalEdges = prunedGraph.edges;
        const isolatedNodesRemoved = prunedGraph.removedCount;

        const callEdgesOnly = finalEdges.filter(e => e.kind === "CALLS");
        const usesEdgesOnly = finalEdges.filter(e => e.kind === "USES");
        const visualization = buildVisualization(finalNodes, finalEdges);

        const output = {
            generatedAt: new Date().toISOString(),
            input: {
                root: path.resolve(args.root),
                mode: "full-project",
                projectId: args.projectId || null,
            },
            summary: {
                filesAnalyzed: result.filesAnalyzed,
                functions: finalNodes.length,
                isolatedNodesRemoved,
                totalEdges: finalEdges.length,
                callEdges: callEdgesOnly.length,
                crossFileCallEdges: callEdgesOnly.filter(e => e.scope === "cross-file").length,
                inFileCallEdges: callEdgesOnly.filter(e => e.scope === "in-file").length,
                usesEdges: usesEdgesOnly.length,
                crossFileUsesEdges: usesEdgesOnly.filter(e => e.scope === "cross-file").length,
                inFileUsesEdges: usesEdgesOnly.filter(e => e.scope === "in-file").length,
            },
            graph: {
                nodes: finalNodes,
                edges: finalEdges,
            },
            visualization,
        };

        const outputPath = args.projectId ? path.resolve(buildAppdataOutputPath(args.projectId)) : path.resolve(buildDefaultOutputPath(args.root)) // appdata if projectId provided, otherwise default 
            
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");

        console.log("Analysis completed");
        console.log(`Analyzed files: ${output.summary.filesAnalyzed}`);
        console.log(`Functions: ${output.summary.functions}`);
        console.log(`Removed isolated nodes: ${output.summary.isolatedNodesRemoved}`);
        console.log(`Call edges: ${output.summary.callEdges} (cross-file: ${output.summary.crossFileCallEdges}, in-file: ${output.summary.inFileCallEdges})`);
        console.log(`Uses edges: ${output.summary.usesEdges} (cross-file: ${output.summary.crossFileUsesEdges}, in-file: ${output.summary.inFileUsesEdges})`);
        console.log(`Total edges: ${output.summary.totalEdges}`);
        console.log(`Report: ${outputPath}`);
    } else { // existing commit based analysis
        const commitDirs = await discoverCommitDirectories(args.root);
        if (commitDirs.length === 0) {
            throw new Error(`No commit directories found from root: ${path.resolve(args.root)}`);
        }

        const sortInfo = [];
        for (const dir of commitDirs) {
            sortInfo.push(await getCommitSortInfo(dir));
        }
        sortInfo.sort((a, b) => {
            if (a.sortTime != null && b.sortTime != null) return a.sortTime - b.sortTime;
            if (a.sortTime != null) return -1;
            if (b.sortTime != null) return 1;
            return a.sha.localeCompare(b.sha);
        });

        const selected = args.limit > 0 ? sortInfo.slice(0, args.limit) : sortInfo;
        const commitResults = [];

        for (const item of selected) {
            commitResults.push(await analyzeCommitDirectory(item.commitDirectory));
        }

        const nodes = [];
        const edges = [];
        const nodeSeen = new Set();
        for (const commit of commitResults) {
            for (const func of commit.functions) {
                if (!nodeSeen.has(func.id)) {
                    nodeSeen.add(func.id);
                    nodes.push(func);
                }
            }
            edges.push(...commit.edges);
        } // collecting all function nodes (deduplicate by id)

        const prunedGraph = removeIsolatedNodes(nodes, edges);
        const finalNodes = prunedGraph.nodes;
        const finalEdges = prunedGraph.edges;
        const isolatedNodesRemoved = prunedGraph.removedCount;

        const callEdgesOnly = finalEdges.filter(e => e.kind === "CALLS");
        const visualization = buildVisualization(finalNodes, finalEdges);

        const output = {
            generatedAt: new Date().toISOString(),
            input: {
                root: path.resolve(args.root),
                projectId: args.projectId || null,
            },
            summary: {
                commitsAnalyzed: commitResults.length,
                filesAnalyzed: commitResults.reduce((s, c) => s + c.filesAnalyzed, 0),
                functions: finalNodes.length,
                isolatedNodesRemoved,
                callEdges: callEdgesOnly.length,
                crossFileCallEdges: callEdgesOnly.filter(e => e.scope === "cross-file").length,
                inFileCallEdges: callEdgesOnly.filter(e => e.scope === "in-file").length,
            },
            graph: {
                nodes: finalNodes,
                edges: finalEdges,
            },
            visualization,
            commits: commitResults.map(c => ({
                sha: c.sha,
                commitDirectory: c.commitDirectory,
                filesAnalyzed: c.filesAnalyzed,
                functions: c.functionCount,
                callEdges: c.callEdges,
                crossFileCallEdges: c.crossFileCallEdges,
                inFileCallEdges: c.inFileCallEdges,
            })),
        };

        const outputPath = args.projectId ? path.resolve(buildAppdataOutputPath(args.projectId)) : path.resolve(buildDefaultOutputPath(args.root));
            
        await fs.mkdir(path.dirname(outputPath), { recursive: true });
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");

        console.log("Analysis completed");
        console.log(`Analyzed commits: ${output.summary.commitsAnalyzed}`);
        console.log(`Analyzed files: ${output.summary.filesAnalyzed}`);
        console.log(`Functions: ${output.summary.functions}`);
        console.log(`Removed isolated nodes: ${output.summary.isolatedNodesRemoved}`);
        console.log(`Call edges: ${output.summary.callEdges} (cross-file: ${output.summary.crossFileCallEdges}, in-file: ${output.summary.inFileCallEdges})`);
        console.log(`Report: ${outputPath}`);
    }
}

run().catch(console.error);
