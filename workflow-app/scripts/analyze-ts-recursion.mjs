import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from 'node:crypto';
import { Node, Project, SyntaxKind, ts } from "ts-morph";
import { buildVisualization } from "./ts-graph-visualization.mjs";

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".jsx"]);

function hashText(text) {
    return createHash('sha1').update(text).digest('hex');
}

function parseRoot(argv) {
    const args = {
        root: "",
    };

    if (argv[2]) {
        args.root = argv[2];
    }

    if (!args.root) {
        throw new Error("Missing required root path argument");
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

async function collectFilesRecursive(rootPath) { // called by collectTypeScriptFiles(), returns all absolute path for files from a dir and all subdir
    const output = [];
    const stack = [rootPath]; // owner/repo/commits/commit_sha/added or modified or removed

    while (stack.length > 0) { // dfs
        const current = stack.pop();
        if (!current) {
            continue;
        }

        let entries = [];
        try {
            entries = await fs.readdir(current, { withFileTypes: true });
        } catch {
            continue;
        }

        for (const entry of entries) {
            const absolutePath = path.join(current, entry.name); // absoulte path for a subdir inside added/ modified/ removed
            if (entry.isDirectory()) {
                stack.push(absolutePath); // queues the folder for further file absolute path extraction for output
            } else if (entry.isFile()) {
                output.push(absolutePath);
            }
        }
    }

    return output;
}

async function collectTypeScriptFiles(commitDirectory) {
    const operationNames = ["added", "modified", "removed"];
    const files = [];

    for (const operation of operationNames) {
        const operationPath = path.join(commitDirectory, operation); // owner/repo/commits/commit_sha/added or modified or removed
        if (!(await exists(operationPath))) {
            continue;
        }

        const candidates = await collectFilesRecursive(operationPath);
        for (const filePath of candidates) {
            const ext = path.extname(filePath).toLowerCase();
            if (TS_EXTENSIONS.has(ext)) {
                files.push(filePath);
            }
        }
    }

    return files;
}

function declarationKey(node) {
    return `${node.getSourceFile().getFilePath()}:${node.getStart()}`; // the file and the line it is first defined at
}

function getLocation(node) { // converts a ts-morph ast node into a location object
    const source = node.getSourceFile();
    const lc = source.getLineAndColumnAtPos(node.getStart());
    return {
        filePath: source.getFilePath(),
        line: lc.line,
        column: lc.column, // exact source code coord for each function entity
    };
}

function getRepoRelativePath(commitDirectory, sourceFilePath) {
    const relative = path.relative(commitDirectory, sourceFilePath);
    const segments = relative.split(path.sep);
    if (segments.length <= 1) {
        return relative;
    }
    return segments.slice(1).join("/");
}

function buildEntityId(sha, sourceFilePath, start, kind, name) {
    return `entity:${sha}:${sourceFilePath}:${start}:${kind}:${name}`;
}

function createProject() {
    return new Project({
        skipAddingFilesFromTsConfig: true,
        compilerOptions: {
            allowJs: true,
            checkJs: false,
            target: ts.ScriptTarget.ESNext,
            jsx: ts.JsxEmit.ReactJSX,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
        },
    });
}

function getFunctionDisplayName(node) { // converts raw ast nodes into strings
    if (Node.isFunctionDeclaration(node)) { // function
        return node.getName() || "<anonymous-function>";
    }

    if (Node.isMethodDeclaration(node)) { // class method
        const classNode = node.getFirstAncestorByKind(SyntaxKind.ClassDeclaration);
        const className = classNode?.getName() || "<anonymous-class>";
        return `${className}.${node.getName()}`;
    }

    if (Node.isArrowFunction(node) || Node.isFunctionExpression(node)) { // arrow/ function expression
        const variableDecl = node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
        if (variableDecl?.getName()) {
            return variableDecl.getName();
        }

        const propertyAssignment = node.getFirstAncestorByKind(SyntaxKind.PropertyAssignment);
        if (propertyAssignment) {
            return propertyAssignment.getName();
        }

        return "<anonymous-lambda>";
    }

    return "<unknown-function>";
}

function safeSignature(node) {
    return node.getText().replace(/\s+/g, " ").slice(0, 260);
}

function buildEntityContext(project, commitDirectory, sha) { // only collects functions, methods, lambdas
    const context = {
        functions: [], // list of function entities
        functionById: new Map(), // id and function entity
        functionByDeclarationKey: new Map(), // declaration key ("src/utils/helper.ts:200") and function entity
        functionsBySimpleName: new Map(), // simpleName and list (for resolving)
        functionsByFile: new Map(),   // filePath and list (for nested checks)
    };

    for (const sourceFile of project.getSourceFiles()) {
        const repoRelativePath = getRepoRelativePath(commitDirectory, sourceFile.getFilePath());

        const addFunction = (node, kind, name, simpleName) => {
            const loc = getLocation(node);
            const id = buildEntityId(sha, sourceFile.getFilePath(), node.getStart(), kind, name);
            const entity = {
                id,
                sha,
                kind,
                name,
                simpleName,
                repoRelativePath,
                filePath: loc.filePath,
                line: loc.line,
                column: loc.column,
                start: node.getStart(),
                end: node.getEnd(),
                signature: safeSignature(node),
                contentHash: hashText(node.getText()),
                code: node.getText(), // full source code of the function in order to produce meaningful embeddings
                node, // keep reference for call analysis (will be discarded after)
            };
            context.functions.push(entity);
            context.functionById.set(id, entity);
            context.functionByDeclarationKey.set(declarationKey(node), entity);
            if (!context.functionsBySimpleName.has(simpleName)) {
                context.functionsBySimpleName.set(simpleName, []);
            }
            context.functionsBySimpleName.get(simpleName).push(entity);
            if (!context.functionsByFile.has(loc.filePath)) {
                context.functionsByFile.set(loc.filePath, []);
            }
            context.functionsByFile.get(loc.filePath).push(entity);
        };

        for (const fn of sourceFile.getFunctions()) { // top-level functions
            const fnName = getFunctionDisplayName(fn);
            addFunction(fn, "function", fnName, fn.getName() || fnName);
        }

        for (const classNode of sourceFile.getClasses()) { // methods inside classes
            for (const method of classNode.getMethods()) {
                const methodName = getFunctionDisplayName(method);
                addFunction(method, "method", methodName, method.getName());
            }
        }

        for (const variableDecl of sourceFile.getVariableDeclarations()) { // arrow functions / function expressions assigned to variables
            const initializer = variableDecl.getInitializer();
            if (!initializer) continue;
            if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) continue;
            const name = variableDecl.getName();
            addFunction(initializer, "lambda", name, name);
        }
    }

    for (const [file, funcs] of context.functionsByFile.entries()) {
        funcs.sort((a, b) => a.start - b.start);
    }

    return context;
}

function resolveCallTarget(callExpression, context) { // resolves a call expression to a function entity
    const expr = callExpression.getExpression();
    const symbol = expr.getSymbol() || expr.getType().getSymbol();
    if (!symbol) return null;

    for (const decl of symbol.getDeclarations()) { // first try by declaration key
        const direct = context.functionByDeclarationKey.get(declarationKey(decl));
        if (direct) return direct;

        if (Node.isVariableDeclaration(decl)) { // if it's a variable declaration pointing to a function, get the initializer
            const initializer = decl.getInitializer();
            if (initializer && (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer))) {
                const resolved = context.functionByDeclarationKey.get(declarationKey(initializer));
                if (resolved) return resolved; // context.functionByDeclarationKey.get("src/utils/helper.ts:200") = entity
            }
        }
    }

    if (Node.isIdentifier(expr)) { // fallback
        const byName = context.functionsBySimpleName.get(expr.getText()) || [];
        if (byName.length === 1) {
            return byName[0];
        }
    }

    return null;
}

function extractCallEdges(context, edges) { // extracts CALLS edges between functions – both cross-file and in-file
    const dedupe = new Set();

    for (const func of context.functions) {
        const calls = func.node.getDescendantsOfKind(SyntaxKind.CallExpression);
        for (const callExpr of calls) {
            const target = resolveCallTarget(callExpr, context);
            if (!target) continue;

            const funcFilePath = func.filePath.split(path.sep).join("/");
            const targetFilePath = target.filePath.split(path.sep).join("/");
            const isCrossFile = funcFilePath !== targetFilePath;
            const loc = getLocation(callExpr);
            const edge = {
                kind: "CALLS",
                from: func.id,
                to: target.id,
                label: callExpr.getExpression().getText(),
                filePath: loc.filePath,
                line: loc.line,
                column: loc.column,
                resolved: true,
                scope: isCrossFile ? "cross-file" : "in-file",
                directed: true,
            };

            // deduplicate edges - same caller/ callee per file location
            const key = `${edge.kind}|${edge.from}|${edge.to}|${edge.line}|${edge.column}`;
            if (dedupe.has(key)) continue;
            dedupe.add(key);
            edges.push(edge);
        }
    }
}

function extractUsesEdges(context, edges) { // extracts jsx/component usage as CALLS edges
    const dedupe = new Set();

    for (const func of context.functions) {
        const jsxElements = [ // all jsx opening and closing elements
            ...func.node.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
            ...func.node.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
        ];

        for (const jsxElement of jsxElements) {
            const tagName = jsxElement.getTagNameNode();
            if (!tagName) continue;

            let fullName = tagName.getText(); // get component name
            
            let componentName = fullName;
            if (fullName.includes(".")) {
                const parts = fullName.split(".");
                componentName = parts[parts.length - 1];
            } // the component name is the part after the last dot if it is namespaced
            
            if (!componentName || !/^[A-Z]/.test(componentName)) continue;

            const candidates = context.functionsBySimpleName.get(componentName) || []; // tries to resolve to a component entity
            if (candidates.length === 0) continue;

            const target = candidates[0]; // first candidate
            if (!target) continue;

            const funcFilePath = func.filePath.split(path.sep).join("/");
            const targetFilePath = target.filePath.split(path.sep).join("/");
            const isCrossFile = funcFilePath !== targetFilePath;
            const loc = getLocation(jsxElement);

            const edge = {
                kind: "CALLS",
                from: func.id,
                to: target.id,
                label: componentName,
                filePath: loc.filePath,
                line: loc.line,
                column: loc.column,
                resolved: true,
                scope: isCrossFile ? "cross-file" : "in-file",
                directed: true,
            };

            // deduplicate edges
            const key = `${edge.kind}|${edge.from}|${edge.to}|${edge.line}|${edge.column}`;
            if (dedupe.has(key)) continue;
            dedupe.add(key);
            edges.push(edge);
        }
    }
}


async function analyzeCommitDirectory(commitDirectory) { // analyzes a single commit directory – functions and call edges
    // parses added, modified, and removed so that edges can reference functions from any operation directory

    const project = createProject();

    const sourceFiles = await collectTypeScriptFiles(commitDirectory);
    for (const file of sourceFiles) {
        project.addSourceFileAtPath(file);
    }

    const sha = path.basename(commitDirectory);
    const context = buildEntityContext(project, commitDirectory, sha);

    const edges = [];
    extractCallEdges(context, edges); // includes both cross-file and in-file
    extractUsesEdges(context, edges); // jsx/ component usage edges considered part of CALLS edges

    const functions = context.functions.map(f => {
        const { node, ...rest } = f;
        return { ...rest, type: "entity" }; // removes node references and adds required 'type' field
    });

    const callEdges = edges.filter(e => e.kind === "CALLS").length;
    const crossFileEdges = edges.filter(e => e.scope === "cross-file").length;
    const inFileEdges = edges.filter(e => e.scope === "in-file").length;

    const repoFiles = [...sourceFiles].map((file) => getRepoRelativePath(commitDirectory, file)).sort((a, b) => a.localeCompare(b));

    console.log(`\n[${sha}] analyzed files (${repoFiles.length})`);

    const relationCounts = new Map(); // edge and number of times the edge appears across commit
    for (const edge of edges) {
        const fromFn = context.functionById.get(edge.from); // caller
        const toFn = context.functionById.get(edge.to); // callee
        if (!fromFn || !toFn) {
            continue;
        }

        const fromLabel = `${fromFn.name} [${fromFn.repoRelativePath}]`;
        const toLabel = `${toFn.name} [${toFn.repoRelativePath}]`;
        const scope = edge.scope || "unknown";
        const key = `${scope}|${edge.kind}|${fromLabel}|${toLabel}`; // cross-file|CALLS|fromLabel []|toLabel []"
        relationCounts.set(key, (relationCounts.get(key) || 0) + 1); // ensure deduplication based on concatenated key
    }

    const sortedRelations = [...relationCounts.entries()].sort((a, b) => {
        if (b[1] !== a[1]) {
            return b[1] - a[1]; // highest count
        }
        return a[0].localeCompare(b[0]); // alphabetical
    });

    console.log(`[${sha}] function relationships (${sortedRelations.length})`);
    if (sortedRelations.length === 0) {
        console.log("  - none");
    } else {
        for (const [key, count] of sortedRelations) {
            const [scope, kind, fromLabel, toLabel] = key.split("|");
            console.log(`\t- ${fromLabel} -${kind}/${scope}-> ${toLabel}: ${count} repetitions for commit`);
        }
    }

    return {
        sha,
        commitDirectory,
        filesAnalyzed: sourceFiles.length,
        functionCount: functions.length,
        callEdges,
        totalEdges: edges.length,
        crossFileEdges,
        inFileEdges,
        functions,
        edges,
    };
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

function removeIsolatedNodes(nodes, edges) {
    const connectedNodeIds = new Set();

    for (const edge of edges) {
        if (edge?.from) connectedNodeIds.add(edge.from);
        if (edge?.to) connectedNodeIds.add(edge.to);
    }

    const filteredNodes = nodes.filter((node) => connectedNodeIds.has(node.id));
    const filteredNodeIds = new Set(filteredNodes.map((node) => node.id));
    const filteredEdges = edges.filter((edge) => filteredNodeIds.has(edge.from) && filteredNodeIds.has(edge.to));

    return {
        nodes: filteredNodes,
        edges: filteredEdges,
        removedCount: nodes.length - filteredNodes.length,
    };
}

async function run() {
    const args = parseRoot(process.argv);
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

    const outputPath = path.resolve(buildDefaultOutputPath(args.root));
    await fs.mkdir(path.dirname(outputPath), { recursive: true });
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");

    console.log(`Analyzed commits: ${output.summary.commitsAnalyzed}`);
    console.log(`Analyzed files: ${output.summary.filesAnalyzed}`);
    console.log(`Functions: ${output.summary.functions}`);
    console.log(`Removed isolated nodes: ${output.summary.isolatedNodesRemoved}`);
    console.log(`Call edges: ${output.summary.callEdges} (cross-file: ${output.summary.crossFileCallEdges}, in-file: ${output.summary.inFileCallEdges})`);
    console.log(`Report: ${outputPath}`);
}

run().catch(console.error);
