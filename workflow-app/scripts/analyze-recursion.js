const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { buildVisualization } = require("./graph-visualization.js");
const { analyzeCommitDirectory: tsAnalyzeCommit, analyzeFullProject: tsAnalyzeFullProject, loadFullBaseline, saveFullBaseline, buildFullBaselineIndexPath, sortCommitsChronologically } = require('./ts-ast-tree.js');
const { buildFunctionHistory, saveFunctionHistory } = require('./build-function-history.js');

function parseRoot(argv) {
    const args = {
        root: "",
        projectId: null,
    };

    if (argv[2]) {
        args.root = argv[2];
    }

    if (!args.root) {
        throw new Error("Missing required root path argument");
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

async function analyzeCommitDirectory(commitDirectory, options = {}) { // wrapper that forwards options to tsAnalyzeCommit
    return await tsAnalyzeCommit(commitDirectory, options);
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

function getDesktopShellAppdataPath(projectId) {
    const appData = process.env.APPDATA?.trim();
    const baseDir = appData
        ? path.join(appData, "log-a-priori-desktop-shell", projectId)
        : path.join(os.homedir(), "AppData", "Roaming", "log-a-priori-desktop-shell", projectId);
    return baseDir;
}

function buildAppdataOutputPath(projectId) {
    const baseDir = getProjectAppdataPath(projectId);
    return path.join(baseDir, "analysis", "ts-code-graph.json");
}

function buildPerCommitFunctionIndexPath(projectId, sha) {
    const baseDir = getProjectAppdataPath(projectId);
    return path.join(baseDir, "analysis", `${sha}.json`);
}

async function deleteAnalysisFolder(projectId) {
    const baseDir = getProjectAppdataPath(projectId);
    const analysisPath = path.join(baseDir, "analysis");
    try {
        await fs.rm(analysisPath, { recursive: true, force: true });
        console.log(`Deleted analysis folder: ${analysisPath}`);
    } catch (err) {
        if (err.code !== 'ENOENT') {
            console.warn(`Could not delete analysis folder: ${err.message}`);
        }
    }
}

function removeIsolatedNodes(nodes, edges) {
    const connectedNodeIds = new Set();
    const nodeIdSet = new Set(nodes.map(n => n.id)); // track which ids actually exist as nodes

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

    if (edges.length === 0) { // if there are edges, filter out isolated nodes
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

async function findCommitDirectoryBySha(basePath, sha) { // helper to find a commit directory by sha, similar to route.ts
    const queue = [basePath];
    while (queue.length) {
        const current = queue.shift();
        if (!current) continue;
        try {
            const entries = await fs.readdir(current, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                const fullPath = path.join(current, entry.name);
                if (entry.name === sha) return fullPath;
                queue.push(fullPath);
            }
        } catch {}
    }
    return null;
}

async function run() {
    const args = parseRoot(process.argv);
    
    if (args.projectId) {
        console.log(`AST Analysis started for project id: ${args.projectId}`);
        await deleteAnalysisFolder(args.projectId);
    }
    
    const result = await analyzeFullProjectDirectory(args.root); // analyze the full project directory
    
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

    if (args.projectId) { // building per commit function indices from appdata
        console.log(`\nBuilding per commit function indices for projectId: ${args.projectId}`);
        const appdataBase = getProjectAppdataPath(args.projectId);
        const commitsBasePath = path.join(appdataBase, "commits");
        
        try {
            await fs.access(commitsBasePath); // finding all commit directories by recursively traversing the commits folder
            // commits/owner/repo/commits/commit_sha
            const queue = [commitsBasePath];
            const commitDirs = [];
            
            while (queue.length > 0) {
                const current = queue.shift();
                if (!current) continue;
                
                try {
                    const entries = await fs.readdir(current, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(current, entry.name);
                        if (entry.isDirectory()) {
                            try {
                                const subEntries = await fs.readdir(fullPath, { withFileTypes: true });
                                const hasCommitDirs = subEntries.some(e => 
                                    e.isDirectory() && ["added", "modified", "removed"].includes(e.name)
                                );
                                if (hasCommitDirs) {
                                    commitDirs.push(fullPath);
                                } else {
                                    queue.push(fullPath);
                                }
                            } catch {
                                queue.push(fullPath);
                            }
                        }
                    }
                } catch {
                }
            }
            
            console.log(`Found ${commitDirs.length} candidate directories`);
            
            if (commitDirs.length !== 0) {
                const sortedCommitDirs = await sortCommitsChronologically(commitDirs); // sorting chronologically

                let fullBaseline = await loadFullBaseline(args.projectId) || { // the full baseline: cumulative snapshot of all functions seen so far
                    generatedAt: new Date().toISOString(),
                    functions: [],
                    lastCommitSha: null,  // the continuity check
                };
                console.log(`\nLoaded baseline: ${fullBaseline.functions?.length || 0} functions`);
                if (fullBaseline.functions.length > 0 && !fullBaseline.lastCommitSha) {
                    console.warn("Legacy baseline without commit tracking detected. Resetting baseline.");
                    const baselinePath = buildFullBaselineIndexPath(args.projectId);
                    if (await exists(baselinePath)) await fs.unlink(baselinePath);
                    fullBaseline = {
                        generatedAt: new Date().toISOString(),
                        functions: [],
                        lastCommitSha: null,
                    };
                }
                // !continuity check: validate baseline continuity
                if (fullBaseline.lastCommitSha && sortedCommitDirs.length > 0) {
                    const lastCommitDir = await findCommitDirectoryBySha(commitsBasePath, fullBaseline.lastCommitSha);
                    let expectedNextSha = null;
                    if (lastCommitDir) {
                        try {
                            const manifestPath = path.join(lastCommitDir, "manifest.json");
                            const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
                            expectedNextSha = manifest.nextSha || null;
                        } catch (err) {
                            console.warn(`Could not read manifest for last commit ${fullBaseline.lastCommitSha}: ${err.message}`);
                        }
                    }
                    const firstCommitSha = path.basename(sortedCommitDirs[0]);
                    if (!expectedNextSha || firstCommitSha !== expectedNextSha) {
                        console.warn(`Baseline continuity check failed, expected next commit ${expectedNextSha}, got ${firstCommitSha}\nResetting baseline`);
                        const baselinePath = buildFullBaselineIndexPath(args.projectId);
                        if (await exists(baselinePath)) await fs.unlink(baselinePath);
                        fullBaseline = {
                            generatedAt: new Date().toISOString(),
                            functions: [],
                            lastCommitSha: null,
                        };
                    }
                }
                let indicesCreated = 0;
                for (const commitDir of sortedCommitDirs) {
                    const commitSha = path.basename(commitDir);
                    
                    let previousSha = null;
                    let nextSha = null;
                    let commitTimestamp = null;  
                    try {
                        const manifestPath = path.join(commitDir, "manifest.json"); // reading manifest to get previousSha and nextSha from chronological sorting
                        const manifestContent = await fs.readFile(manifestPath, "utf8");
                        const manifest = JSON.parse(manifestContent);
                        previousSha = manifest.previousSha || null; // used for timeline links, not for diff detection
                        nextSha = manifest.nextSha || null;
                        commitTimestamp = manifest.committer?.date || manifest.author?.date || null;
                        console.log(`Reading manifest links: prev=${previousSha ? previousSha.substring(0, 7) : 'none'}, next=${nextSha ? nextSha.substring(0, 7) : 'none'}`);
                    } catch (err) {
                        console.warn(`Could not read manifest for ${commitSha.substring(0, 7)}: ${err.message}`);
                    }
                    
                    // using fullBaseline for diff detection, not the sparse per commit index, since the per commit index.json contains only changed functions, not the full snapshot
                    // otherwise functions not in the sparse list would be marked as 'added'
                    const options = {
                        prevIndexData: fullBaseline && fullBaseline.functions && fullBaseline.functions.length > 0 ? fullBaseline : null,
                        previousSha: previousSha, // attaching timeline links to functions
                        nextSha: nextSha,
                    };
                    
                    const result = await analyzeCommitDirectory(commitDir, options);
                    
                    const allChangedFunctions = result.functionsWithBoundaries || []; // functionsWithBoundaries now includes all changed functions (added/ modified/ removed)
                    
                    for (const func of allChangedFunctions) {
                        func.previousSha = previousSha;
                        func.nextSha = nextSha;
                    }
                    
                    console.log(`\n[${result.sha}] commit details:`);
                    console.log(`\tTotal functions in commit: ${result.functionCount}`);
                    console.log(`\tChanged functions: ${result.changedFunctionCount}`);
                    console.log(`\tChange stats: added=${result.changeStats.added}, modified=${result.changeStats.modified}, removed=${result.changeStats.removed}, unchanged=${result.changeStats.unchanged}`);
                    
                    if (result.functionCount === 0) { // if there are no typescript/ javacsript functions at all in this commit
                        console.log(`[${result.sha}] No functions found – updating baseline continuity only`);
                        fullBaseline.lastCommitSha = result.sha; // !continuity check: update lastCommitSha to keep continuity
                        await saveFullBaseline(args.projectId, fullBaseline, result.sha);
                        // no index written, no changes to baseline functions
                        continue;
                    }
                    if (allChangedFunctions.length > 0) {
                        const indexPath = buildPerCommitFunctionIndexPath(args.projectId, result.sha);
                        const indexData = {
                            sha: result.sha,
                            generatedAt: new Date().toISOString(),
                            timestamp: commitTimestamp,
                            changeStats: result.changeStats,
                            previousSha: previousSha,
                            nextSha: nextSha,
                            functions: allChangedFunctions.map(f => ({ // functions array is sparse, meaning contains only changed functions in this commit
                                name: f.name,
                                file: f.file || f.repoRelativePath,
                                simpleName: f.simpleName,
                                kind: f.kind,
                                changeType: f.changeType, // added/ modified/ removed
                                startLine: f.startLine || f.line,
                                startColumn: f.startColumn || f.column,
                                endLine: f.endLine,
                                endColumn: f.endColumn,
                                previousSha: f.previousSha || null,
                                nextSha: f.nextSha || null,
                            })),
                        };
                        try {
                            await fs.mkdir(path.dirname(indexPath), { recursive: true });
                            await fs.writeFile(indexPath, JSON.stringify(indexData, null, 2), "utf8");
                            const changedCount = result.changedFunctionCount || result.functionsWithBoundaries.length;
                            console.log(`[${result.sha}] index written: ${changedCount}/ ${result.functionCount} functions changed`);
                            indicesCreated++;
                        } catch (err) {
                            console.error(`[${result.sha}] Failed to save function index: ${err}`);
                        }
                        
                        const baselineFunctionMap = new Map();
                        for (const func of fullBaseline.functions) { // updating the full baseline means merging all functions from this commit into the cumulative baseline
                            const key = `${func.repoRelativePath || func.file}::${func.simpleName}::${func.kind}`;
                            baselineFunctionMap.set(key, func);
                        }
                        
                        for (const func of result.allFunctions || []) { // adding/ updating all functions from current commit (but don't remove removed functions from baseline)
                            const key = `${func.repoRelativePath}::${func.simpleName}::${func.kind}`;
                            baselineFunctionMap.set(key, {
                                name: func.name,
                                file: func.file || func.repoRelativePath,
                                repoRelativePath: func.repoRelativePath,
                                simpleName: func.simpleName,
                                kind: func.kind,
                                startLine: func.startLine,
                                startColumn: func.startColumn,
                                endLine: func.endLine,
                                endColumn: func.endColumn,
                                contentHash: func.contentHash,
                            });
                        }
                        
                        for (const func of result.functionsWithBoundaries || []) { // removing functions that were marked as removed in changeStats
                            if (func.changeType === 'removed') {
                                const key = `${func.file}::${func.simpleName}::${func.kind}`;
                                baselineFunctionMap.delete(key);
                            }
                        }
                        
                        fullBaseline = { // rebuilding the baseline
                            generatedAt: new Date().toISOString(),
                            functions: Array.from(baselineFunctionMap.values()),
                            lastCommitSha: result.sha,  // !continuity check: store last processed sha
                        };
                        
                        if (args.projectId) {
                            await saveFullBaseline(args.projectId, fullBaseline, result.sha); // !continuity check: pass the sha to saveFullBaseline, but requires ts-ast-tree.js update
                            console.log(`Baseline updated: ${fullBaseline.functions.length} functions`);
                            console.log(`[${result.sha}] Baseline saved`);
                        }
                    } else {
                        // there are some unchanged functions in the commit, meaning it is still needed to update lastCommitSha and save baseline
                        fullBaseline.lastCommitSha = result.sha;
                        await saveFullBaseline(args.projectId, fullBaseline, result.sha);
                        console.log(`[${result.sha}] Baseline continuity updated (no changed functions)`);
                    }
                }
                
                if (args.projectId) {
                    const historyMap = await buildFunctionHistory(args.projectId); // rebuilding function history map after all commits are processed
                    await saveFunctionHistory(args.projectId, historyMap);
                    console.log(`Function history rebuilt: ${historyMap.size} unique functions tracked`);
                }
            }
        } catch (err) {
            console.error(`Error building per commit indices:`, err.message);
        }
    }

    // the full project analysis has already been done earlier in the script, that's what it is used for the main graph visualization and output
    console.log("Analysis completed");
}


run().catch(console.error);
