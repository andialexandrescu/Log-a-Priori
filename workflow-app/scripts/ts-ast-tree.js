const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { Node, Project, SyntaxKind, ts } = require("ts-morph");

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".jsx", ".js"]);

function hashText(text) {
    return createHash('sha1').update(text).digest('hex');
}

async function exists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function collectFilesRecursive(rootPath) { // called by collectTypeScriptFiles(), returns all absolute path for files from a dir and all subdir
    const output = [];
    const stack = [rootPath]; // owner/repo/commits/commit_sha/added or modified or removed

    const excludeDirs = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.venv', '.pytest_cache', '.vscode', '__pycache__']); // common directories to exclude for full project analysis

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
            if (entry.isDirectory()) { // skipping excluded directories
                if (!excludeDirs.has(entry.name)) {
                    stack.push(absolutePath); // queues the folder for further file absolute path extraction for output
                }
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

async function collectTypeScriptFilesFromProject(projectRoot) {
    const files = [];
    const candidates = await collectFilesRecursive(projectRoot);
    for (const filePath of candidates) {
        const ext = path.extname(filePath).toLowerCase();
        if (TS_EXTENSIONS.has(ext)) {
            files.push(filePath);
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

        const topLevelFuncs = sourceFile.getFunctions();
        for (const fn of topLevelFuncs) { // top level functions
            const fnName = getFunctionDisplayName(fn);
            addFunction(fn, "function", fnName, fn.getName() || fnName);
        }

        const classNodes = sourceFile.getClasses();
        for (const classNode of classNodes) { // methods inside classes
            for (const method of classNode.getMethods()) {
                const methodName = getFunctionDisplayName(method);
                addFunction(method, "method", methodName, method.getName());
            }
        }

        const varDecls = sourceFile.getVariableDeclarations();
        for (const variableDecl of varDecls) { // arrow functions/ function expressions assigned to variables
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
    
    if (symbol) { // only if we have a symbol
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
    }

    if (Node.isIdentifier(expr)) { // fallback: try by name (works even when symbol resolution fails)
        // for CommonJs sometimes symbol resolution fails - name matching
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

function extractUsesEdges(context, edges) { // extracts function references (middleware, callbacks...)
    const dedupe = new Set();

    for (const func of context.functions) {
        const identifiers = func.node.getDescendantsOfKind(SyntaxKind.Identifier);
        
        for (const ident of identifiers) {
            const name = ident.getText();
            if (['if', 'else', 'for', 'while', 'return', 'const', 'let', 'var', 'function', 'async', 'await'].includes(name)) {
                continue;
            }

            const parent = ident.getParent();
            if (parent && Node.isVariableDeclaration(parent) && parent.getName() === name) {
                continue; // skipping variable declarations on the left side of assignment
            }

            const targetFuncs = context.functionsBySimpleName.get(name) || []; // name matching
            if (targetFuncs.length === 0) continue;

            for (const targetFunc of targetFuncs) {
                if (targetFunc.id === func.id) continue; // self references

                const loc = getLocation(ident);
                const funcFilePath = func.filePath.split(path.sep).join("/");
                const targetFilePath = targetFunc.filePath.split(path.sep).join("/");
                const isCrossFile = funcFilePath !== targetFilePath;

                const edge = {
                    kind: "USES",
                    from: func.id,
                    to: targetFunc.id,
                    label: name,
                    filePath: loc.filePath,
                    line: loc.line,
                    column: loc.column,
                    resolved: true,
                    scope: isCrossFile ? "cross-file" : "in-file",
                    directed: true,
                };

                // deduplicate - same usage per location
                const key = `${edge.kind}|${edge.from}|${edge.to}|${edge.line}|${edge.column}`;
                if (dedupe.has(key)) continue;
                dedupe.add(key);
                edges.push(edge);
            }
        }
    }
}

function extractModuleImportEdges(context, project, edges) { // for CommonJS when module imports and uses a function from another module
    const dedupe = new Set();
    let foundEdges = 0;

    for (const sourceFile of project.getSourceFiles()) {
        const filePath = sourceFile.getFilePath();
        
        const calls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression); // require() calls
        for (const call of calls) {
            const expr = call.getExpression();
            if (!Node.isIdentifier(expr) || expr.getText() !== 'require') continue;

            let parent = call.getParent(); // the identifier the require is assigned to
            let requiredName = null;

            // const name = require('...')
            if (parent && Node.isVariableDeclaration(parent)) {
                requiredName = parent.getName();
                parent = parent.getParent(); // get the parent of the declaration
            }
            // const { name } = require('...') (destructuring)
            else if (parent && Node.isCallExpression(parent)) {
                parent = parent.getParent();
                if (parent && Node.isVariableDeclaration(parent)) {
                    requiredName = parent.getName();
                }
            }

            if (!requiredName) continue;

            const identifiers = sourceFile.getDescendantsOfKind(SyntaxKind.Identifier).filter(id => id.getText() === requiredName); // references of this imported name in the file
            
            for (const usage of identifiers) {
                const idParent = usage.getParent();
                if (Node.isVariableDeclaration(idParent) && idParent.getName() === requiredName) continue;

                const targetFuncs = context.functionsBySimpleName.get(requiredName) || []; // name matching
                for (const targetFunc of targetFuncs) {
                    const loc = getLocation(usage);
                    const edge = {
                        kind: "USES",
                        from: `module:${filePath}`,
                        to: targetFunc.id,
                        label: requiredName,
                        filePath: loc.filePath,
                        line: loc.line,
                        column: loc.column,
                        resolved: true,
                        scope: filePath === targetFunc.filePath ? "in-file" : "cross-file",
                        directed: true,
                    };

                    const key = `${edge.kind}|${edge.from}|${edge.to}|${edge.line}|${edge.column}`;
                    if (dedupe.has(key)) continue;
                    dedupe.add(key);
                    edges.push(edge);
                    foundEdges++;
                }
            }
        }
    }
}

function extractJsxComponentUsesEdges(context, edges) { // original impl: extracts jsx/component usage as USES edges
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

// yet to integrate
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
    extractUsesEdges(context, edges); // function references (middleware, callbacks)
    extractModuleImportEdges(context, project, edges); // CommonJS module imports/ uses
    extractJsxComponentUsesEdges(context, edges); // jsx/ component usage edges

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

async function analyzeFullProject(projectRoot) { // analyzes the entire project directory – functions and call edges
    const project = createProject();

    const sourceFiles = await collectTypeScriptFilesFromProject(projectRoot);
    
    for (const file of sourceFiles) {
        try {
            project.addSourceFileAtPath(file);
        } catch (err) {
            console.error(`[ERROR] Failed to parse ${file}: ${err.message}`);
        }
    }

    const sha = "full-project";
    const context = buildEntityContext(project, projectRoot, sha);

    const edges = [];
    extractCallEdges(context, edges); // includes both cross-file and in-file
    extractUsesEdges(context, edges); // function references (middleware, callbacks)
    extractModuleImportEdges(context, project, edges); // CommonJS module imports/uses
    extractJsxComponentUsesEdges(context, edges); // jsx/ component usage edges

    const functions = context.functions.map(f => {
        const { node, ...rest } = f;
        return { ...rest, type: "entity" }; // removes node references and adds required 'type' field
    });

    const callEdges = edges.filter(e => e.kind === "CALLS").length;
    const crossFileEdges = edges.filter(e => e.scope === "cross-file").length;
    const inFileEdges = edges.filter(e => e.scope === "in-file").length;

    const getProjectRelativePath = (filePath) => {
        return path.relative(projectRoot, filePath).split(path.sep).join("/");
    };

    const repoFiles = sourceFiles.map(getProjectRelativePath).sort((a, b) => a.localeCompare(b));

    console.log(`\n[full-project] analyzed files (${repoFiles.length})`);

    const relationCounts = new Map(); // edge and number of times the edge appears
    for (const edge of edges) {
        const fromFn = context.functionById.get(edge.from); // caller
        const toFn = context.functionById.get(edge.to); // callee
        if (!fromFn || !toFn) {
            continue;
        }

        const fromLabel = `${fromFn.name} [${fromFn.repoRelativePath}]`;
        const toLabel = `${toFn.name} [${toFn.repoRelativePath}]`;
        const scope = edge.scope || "unknown";
        const key = `${scope}|${edge.kind}|${fromLabel}|${toLabel}`;
        relationCounts.set(key, (relationCounts.get(key) || 0) + 1);
    }

    const sortedRelations = [...relationCounts.entries()].sort((a, b) => {
        if (b[1] !== a[1]) {
            return b[1] - a[1]; // highest count
        }
        return a[0].localeCompare(b[0]); // alphabetical
    });

    console.log(`[full-project] function relationships (${sortedRelations.length})`);
    if (sortedRelations.length === 0) {
        console.log("  - none");
    } else {
        for (const [key, count] of sortedRelations) {
            const [scope, kind, fromLabel, toLabel] = key.split("|");
            console.log(`\t- ${fromLabel} -${kind}/${scope}-> ${toLabel}: ${count} repetitions`);
        }
    }

    return {
        sha,
        projectRoot,
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

module.exports = { analyzeCommitDirectory, analyzeFullProject };
