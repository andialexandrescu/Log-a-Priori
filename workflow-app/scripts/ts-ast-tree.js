const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { Node, Project, SyntaxKind, ts } = require("ts-morph");
const { diff } = require("@tdurieux/dinghy-diff");

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
            const absolutePath = path.join(current, entry.name); // absolute path for a subdir inside added/ modified/ removed
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

function getStartLocation(node) { // converts a ts-morph ast node's start/ end position into a location object
    const source = node.getSourceFile();
    const lc = source.getLineAndColumnAtPos(node.getStart()); // node.getStart()
    return {
        filePath: source.getFilePath(),
        line: lc.line,
        column: lc.column, // exact source code coord for each function entity
    };
}

function getEndLocation(node) { // get the end position of a node
    const source = node.getSourceFile();
    const lc = source.getLineAndColumnAtPos(node.getEnd()); // vs node.getEnd()
    return {
        filePath: source.getFilePath(),
        line: lc.line,
        column: lc.column,
    };
}

function getRepoRelativePath(commitDirectory, sourceFilePath) {
    const normalizedCommitDir = commitDirectory.replace(/\\/g, '/');
    const normalizedSourcePath = sourceFilePath.replace(/\\/g, '/');
    
    const relative = path.relative(normalizedCommitDir, normalizedSourcePath);
    const segments = relative.split(/[\\/]+/);
    
    if (segments.length <= 1) {
        return relative.replace(/\\/g, '/');
    }
    
    const isCommitOp = segments[0] === 'added' || segments[0] === 'modified' || segments[0] === 'removed';
    const skipFirst = isCommitOp ? 1 : 0;
    return segments.slice(skipFirst).join("/");
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

function computeStructuralHash(node) { // hash based on normalized ast structure, ignoring whitespace/ comments
    const text = node.getText();
    
    const normalized = text
        .replace(/\/\/.*$|^\/\*\*[\s\S]*?\*\//gm, '') // removing // and /** */ comments
        .replace(/\/\*[\s\S]*?\*\//g, '') // removing /* */ comments
        .replace(/\s+/g, ' ') // normalize whitespace
        .trim();
    const hash = hashText(normalized);
    return hash;
}

function createFunctionKey(func) { // identifier for a function across commits
    // key: repoRelativePath + name + kind
    return `${func.repoRelativePath}::${func.simpleName}::${func.kind}`;
}

function parseCodeToAST(sourceCode, fileName = 'temp.ts') { // parsing source code into ast for comparison
    try {
        const project = new Project();
        const sourceFile = project.createSourceFile(fileName, sourceCode, { overwrite: true });
        const nodes = sourceFile.getStatements();
        if (nodes.length === 0) return null;

        return nodes[0].compilerNode;
    } catch (err) {
        console.warn(`Failed to parse code: ${err.message}`);
        return null;
    }
}

function areFunctionsEqualAST(prevFunc, nextFunc) { // comparing two functions using ast structural diff
    if (!prevFunc?.code || !nextFunc?.code) {
        return prevFunc?.contentHash === nextFunc?.contentHash; // fall back to hash comparison if source not available
    }
    
    try {
        const prevAST = parseCodeToAST(prevFunc.code);
        const nextAST = parseCodeToAST(nextFunc.code);
        
        if (!prevAST || !nextAST) {
            return prevFunc.contentHash === nextFunc.contentHash;
        }
        
        const changes = diff(prevAST, nextAST); // structural diff
        
        const isEqual = changes.length === 0;
        
        if (!isEqual) {
            console.log(`Structural changes detected: ${changes.length} operations`);
        }
        
        return isEqual;
    } catch (err) {
        console.warn(`Comparison failed: ${err.message} – falling back to hash`);
        return prevFunc.contentHash === nextFunc.contentHash;
    }
}

function compareFunctionsBySha(prevFunc, nextFunc) { // compares two function versions using hash first, then ast diff for precision
    if (!prevFunc || !nextFunc) {
        return false;
    }
    
    if (prevFunc.contentHash === nextFunc.contentHash) {
        return true; // if hashes match, definitely unchanged
    }
    
    const astEqual = areFunctionsEqualAST(prevFunc, nextFunc); // not matching the hash: ast comparison to reduce false positive
    
    if (astEqual) {
        console.log(`Hash mismatch but ast equivalent (likely formatting change)`);
    }
    
    return astEqual;
}

function buildFullBaselineIndexPath(projectId) { // path to the cumulative full-index.json that tracks all functions ever seen
    const baseDir = getProjectAppdataPath(projectId);
    return path.join(baseDir, "analysis", "full-baseline.json");
}

function getProjectAppdataPath(projectId) { // get appdata path for a project
    const appData = process.env.APPDATA?.trim();
    const baseDir = appData 
        ? path.join(appData, "log-a-priori-desktop-shell", projectId)
        : path.join(os.homedir(), "AppData", "Roaming", "log-a-priori-desktop-shell", projectId);
    return baseDir;
}

async function loadFullBaseline(projectId) { // loads the cumulative full-baseline.json
    try {
        const baselinePath = buildFullBaselineIndexPath(projectId);
        const content = await fs.readFile(baselinePath, "utf8");
        const parsed = JSON.parse(content);
        if (!parsed.lastCommitSha) parsed.lastCommitSha = null;
        return parsed;
    } catch (err) {
        return null; // no baseline yet (first run)
    }
}

async function saveFullBaseline(projectId, baselineData, lastCommitSha = null) { // saves the cumulative full-baseline.json with all functions seen so far
    try {
        const baselinePath = buildFullBaselineIndexPath(projectId);
        const toSave = {
            ...baselineData,
            lastCommitSha: lastCommitSha || baselineData.lastCommitSha || null,
            generatedAt: new Date().toISOString(),
        };
        await fs.mkdir(path.dirname(baselinePath), { recursive: true });
        await fs.writeFile(baselinePath, JSON.stringify(toSave, null, 2), "utf8");
    } catch (err) {
        console.error(`Failed to save full baseline: ${err}`);
    }
}

async function sortCommitsChronologically(commitDirs) { // sorts commits by their date from manifest.json
    const commitData = [];
    
    for (const commitDir of commitDirs) {
        try {
            const manifestPath = path.join(commitDir, "manifest.json");
            const content = await fs.readFile(manifestPath, "utf8");
            const manifest = JSON.parse(content);
            
            let dateValue = manifest.committer?.date || manifest.author?.date;
            
            let timestamp = 0;
            if (dateValue) {
                if (typeof dateValue === 'number') {
                    timestamp = dateValue;
                } else if (typeof dateValue === 'string') {
                    timestamp = new Date(dateValue).getTime();
                }
            }
            
            const dateStr = timestamp ? new Date(timestamp).toISOString() : 'unknown';
            commitData.push({ dir: commitDir, timestamp });
        } catch (err) {
            console.warn(`No manifest for ${path.basename(commitDir)}`);
            commitData.push({ dir: commitDir, timestamp: 0 });
        }
    }
    
    commitData.sort((a, b) => {
        if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
        return a.dir.localeCompare(b.dir);
    });
    
    console.log(`Final order (${commitData.length} commits):`);
    commitData.forEach((d, idx) => {
        const timestamp = d.timestamp ? new Date(d.timestamp).toISOString() : 'unknown';
        console.log(`\t${idx + 1}. ${path.basename(d.dir).substring(0, 7)} (${timestamp})`);
    });
    
    for (let idx = 0; idx < commitData.length; idx++) {
        const manifestPath = path.join(commitData[idx].dir, "manifest.json");
        try {
            const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
            manifest.previousSha = idx > 0 ? path.basename(commitData[idx - 1].dir) : null;
            manifest.nextSha = idx < commitData.length - 1 ? path.basename(commitData[idx + 1].dir) : null;
            await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
            console.log(`Updated ${path.basename(commitData[idx].dir).substring(0, 7)}: prev=${manifest.previousSha ? manifest.previousSha.substring(0, 7) : "none"}, next=${manifest.nextSha ? manifest.nextSha.substring(0, 7) : "none"}`);
        } catch (err) {
            console.warn(`Failed to update manifest for ${path.basename(commitData[idx].dir)}:`, err.message);
        }
    }
    
    return commitData.map(d => d.dir);
}

function detectFunctionChanges(prevIndexData, nextFunctions) { // compares functions and returns only those that changed using ast diff
    if (!prevIndexData || !prevIndexData.functions) { // no previous data, all functions are new
        console.log(`No previous index – marking all ${nextFunctions.length} functions as 'added'`);
        return nextFunctions.map(f => ({ ...f, changeType: 'added' }));
    }

    const prevMap = new Map();
    for (const func of prevIndexData.functions) {
        const key = createFunctionKey(func);
        prevMap.set(key, func);
    }
    
    const changedFunctions = [];
    let addedCount = 0, modifiedCount = 0, removedCount = 0, unchangedCount = 0;
    console.log(`Starting ast based change detection (${prevIndexData.functions.length} baseline functions vs ${nextFunctions.length} current functions)`);
    
    for (const nextFunc of nextFunctions) {
        const key = createFunctionKey(nextFunc);
        const prevFunc = prevMap.get(key);

        if (!prevFunc) {
            console.log(`\tADDED: ${key}`);
            changedFunctions.push({ ...nextFunc, changeType: 'added' });
            addedCount++;
        } else if (compareFunctionsBySha(prevFunc, nextFunc)) {
            console.log(`\tUNCHANGED: ${key}`);
            unchangedCount++;
        } else {
            console.log(`\tMODIFIED: ${key} (hash ${prevFunc.contentHash?.substring(0, 7)} -> ${nextFunc.contentHash?.substring(0, 7)})`);
            changedFunctions.push({ ...nextFunc, changeType: 'modified' });
            modifiedCount++;
        }
    }

    const nextKeys = new Set(nextFunctions.map(createFunctionKey));
    for (const [key, prevFunc] of prevMap.entries()) {
        if (!nextKeys.has(key)) {
            console.log(`\tREMOVED: ${key}`);
            changedFunctions.push({ ...prevFunc, changeType: 'removed' });
            removedCount++;
        }
    }

    console.log(`Return: ${changedFunctions.length} changed functions out of ${nextFunctions.length} in current commit`);
    return changedFunctions;
}

function buildEntityContext(project, commitDirectory, sha, previousSha = null, nextSha = null) { // only collects functions, methods, lambdas; now attaches commit links for timeline navigation
    const context = {
        functions: [], // list of function entities
        functionById: new Map(), // id and function entity
        functionByDeclarationKey: new Map(), // declaration key ("src/utils/helper.ts:200") and function entity
        functionsBySimpleName: new Map(), // simpleName and list (for resolving)
        functionsByFile: new Map(), // filePath and list (for nested checks)
        repository: null, // will be set if manifest.json exists
    };

    const manifestPath = path.join(commitDirectory, "manifest.json");
    try {
        const manifestContent = require("fs").readFileSync(manifestPath, "utf8");
        const manifest = JSON.parse(manifestContent);
        if (manifest.repository) {
            context.repository = manifest.repository;
        }
    } catch {
    }

    for (const sourceFile of project.getSourceFiles()) {
        const repoRelativePath = getRepoRelativePath(commitDirectory, sourceFile.getFilePath());

        const addFunction = (node, kind, name, simpleName) => {
            const startLoc = getStartLocation(node);
            const endLoc = getEndLocation(node);
            const id = buildEntityId(sha, sourceFile.getFilePath(), node.getStart(), kind, name);
            const entity = {
                id,
                sha,
                previousSha: previousSha,
                nextSha: nextSha,
                kind,
                name,
                simpleName,
                repoRelativePath,
                file: repoRelativePath, // alias for normalized repo relative path
                repository: context.repository, // add repository field to each entity
                filePath: startLoc.filePath,
                startLine: startLoc.line,
                startColumn: startLoc.column,
                endLine: endLoc.line,
                endColumn: endLoc.column,
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
            if (!context.functionsByFile.has(startLoc.filePath)) {
                context.functionsByFile.set(startLoc.filePath, []);
            }
            context.functionsByFile.get(startLoc.filePath).push(entity);
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
            const startLoc = getStartLocation(callExpr);
            const endLoc = getEndLocation(callExpr);
            const edge = {
                kind: "CALLS",
                from: func.id,
                to: target.id,
                label: callExpr.getExpression().getText(),
                filePath: startLoc.filePath,
                startLine: startLoc.line,
                startColumn: startLoc.column,
                endLine: endLoc.line,
                endColumn: endLoc.column,
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

                const startLoc = getStartLocation(ident);
                const endLoc = getEndLocation(ident);
                const funcFilePath = func.filePath.split(path.sep).join("/");
                const targetFilePath = targetFunc.filePath.split(path.sep).join("/");
                const isCrossFile = funcFilePath !== targetFilePath;

                const edge = {
                    kind: "USES",
                    from: func.id,
                    to: targetFunc.id,
                    label: name,
                    filePath: startLoc.filePath,
                    startLine: startLoc.line,
                    startColumn: startLoc.column,
                    endLine: endLoc.line,
                    endColumn: endLoc.column,
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
                    const startLoc = getStartLocation(usage);
                    const endLoc = getEndLocation(usage);
                    const edge = {
                        kind: "USES",
                        from: `module:${filePath}`,
                        to: targetFunc.id,
                        label: requiredName,
                        filePath: startLoc.filePath,
                        startLine: startLoc.line,
                        startColumn: startLoc.column,
                        endLine: endLoc.line,
                        endColumn: endLoc.column,
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
            const startLoc = getStartLocation(jsxElement);
            const endLoc = getEndLocation(jsxElement);

            const edge = {
                kind: "CALLS",
                from: func.id,
                to: target.id,
                label: componentName,
                filePath: startLoc.filePath,
                startLine: startLoc.line,
                startColumn: startLoc.column,
                endLine: endLoc.line,
                endColumn: endLoc.column,
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

/* previous implementation replaced by analyzeFullProject
async function analyzeCommitDirectory(commitDirectory, options = {}) { // analyzes a single commit directory – function boundaries with diff detection
    // parses added, modified, and removed files to extract function boundary information
    // detects which functions have changed since the previous commit
    // edges are no longer generated here; they are built by analyzeFullProject instead

    const project = createProject();

    const sourceFiles = await collectTypeScriptFiles(commitDirectory);
    for (const file of sourceFiles) {
        project.addSourceFileAtPath(file);
    }

    const sha = path.basename(commitDirectory);
    const context = buildEntityContext(project, commitDirectory, sha, options.previousSha, options.nextSha);

    const allFunctions = context.functions.map(f => {
        const { node, ...rest } = f;
        return rest; // includes name, file, line, column, endLine, endColumn, repoRelativePath, contentHash
    });

    // detecting changes if previous index is available
    let functionsWithBoundaries = allFunctions;
    let changeStats = {
        added: 0,
        modified: 0,
        removed: 0,
        unchanged: 0,
    };

    if (options.prevIndexData) {
        console.log(`prevIndexData structure: functions=${options.prevIndexData.functions?.length || 'UNDEFINED'}`);
        const changedFunctions = detectFunctionChanges(options.prevIndexData, allFunctions);
        functionsWithBoundaries = changedFunctions; // include all changed functions (including removed as tombstones)

        for (const func of changedFunctions) {
            changeStats[func.changeType]++;
        }
        changeStats.unchanged = allFunctions.length - (changeStats.added + changeStats.modified);
    } else {
        console.log(`prevIndexData is null/ undefined, marking all ${allFunctions.length} as added`);
        functionsWithBoundaries = allFunctions.map(f => ({ ...f, changeType: 'added' }));
        changeStats.added = allFunctions.length;
    }

    const repoFiles = [...sourceFiles].map((file) => getRepoRelativePath(commitDirectory, file)).sort((a, b) => a.localeCompare(b));

    console.log(`\n[${sha}] analyzed files (${repoFiles.length})`);
    console.log(`[${sha}] functions found: ${allFunctions.length}`);
    if (options.prevIndexData) {
        console.log(`[${sha}] changes: +${changeStats.added} modified: ${changeStats.modified} removed: ${changeStats.removed} (unchanged: ${changeStats.unchanged})`);
    }

    return {
        sha,
        commitDirectory,
        filesAnalyzed: sourceFiles.length,
        functionCount: allFunctions.length,
        changedFunctionCount: functionsWithBoundaries.length,
        changeStats,
        functionsWithBoundaries,
        allFunctions, // include all functions for baseline update
    };
}*/

async function analyzeCommitDirectory(commitDirectory, options = {}) { // parsing only the files that actually changed in this commit
    const project = createProject();
    const sourceFiles = await collectTypeScriptFiles(commitDirectory);
    for (const file of sourceFiles) {
        project.addSourceFileAtPath(file);
    }

    const sha = path.basename(commitDirectory);
    const context = buildEntityContext(project, commitDirectory, sha, options.previousSha, options.nextSha);

    let allFunctions = [];
    if (options.prevIndexData && options.prevIndexData.functions && options.prevIndexData.functions.length > 0) {
        const fullFunctionsMap = new Map();
        for (const func of options.prevIndexData.functions) {
            const pathKey = func.repoRelativePath || func.file;
            const key = `${pathKey}::${func.simpleName}::${func.kind}`;
            // starting with a copy of all functions from the previous baseline
            fullFunctionsMap.set(key, { ...func }); // building the complete function set for this commit
        }

        for (const func of context.functions) {
            const key = `${func.repoRelativePath}::${func.simpleName}::${func.kind}`;
            fullFunctionsMap.set(key, func); // overwriting with functions parsed from added/ modified files in this commit
        }

        let manifest;
        try {
            const manifestPath = path.join(commitDirectory, "manifest.json");
            const manifestContent = await fs.readFile(manifestPath, "utf8");
            manifest = JSON.parse(manifestContent); // removed functions whose entire file was deleted, listed in manifest's 'removed'
        } catch (err) {
            console.warn(`[${sha}] Could not read manifest.json: ${err.message}`);
            manifest = { removed: [] };
        }

        if (manifest.removed && Array.isArray(manifest.removed)) {
            for (const removedFile of manifest.removed) {
                const normalizedRemoved = removedFile.replace(/\\/g, '/');
                for (const [key, func] of fullFunctionsMap.entries()) {
                    const funcPath = (func.repoRelativePath || func.file || '').replace(/\\/g, '/');
                    if (funcPath === normalizedRemoved) {
                        fullFunctionsMap.delete(key);
                    }
                }
            }
        }

        allFunctions = Array.from(fullFunctionsMap.values()); // fullFunctionsMap contains the complete state for this commit
    } else {
        allFunctions = context.functions.map(f => {
            const { node, ...rest } = f;
            return rest;
        }); // first commit or no baseline, using the functions we parsed
    }

    let functionsWithBoundaries = [];
    let changeStats = {
        added: 0,
        modified: 0,
        removed: 0,
        unchanged: 0,
    };

    if (options.prevIndexData && options.prevIndexData.functions && options.prevIndexData.functions.length > 0) {
        const changedFunctions = detectFunctionChanges(options.prevIndexData, allFunctions); // detecting changes by comparing with the previous baseline
        functionsWithBoundaries = changedFunctions;

        for (const func of changedFunctions) {
            changeStats[func.changeType]++;
        }
        changeStats.unchanged = allFunctions.length - (changeStats.added + changeStats.modified);
    } else {
        functionsWithBoundaries = allFunctions.map(f => ({ ...f, changeType: 'added' })); // no previous data, all functions are considered 'added'
        changeStats.added = allFunctions.length;
    }

    const repoFiles = [...sourceFiles].map(file => getRepoRelativePath(commitDirectory, file)).sort();

    console.log(`\n[${sha}] analyzed files (${repoFiles.length})`);
    console.log(`[${sha}] functions found: ${allFunctions.length}`);
    if (options.prevIndexData) {
        console.log(`[${sha}] changes: +${changeStats.added} modified: ${changeStats.modified} removed: ${changeStats.removed} (unchanged: ${changeStats.unchanged})`);
    }

    return {
        sha,
        commitDirectory,
        filesAnalyzed: sourceFiles.length,
        functionCount: allFunctions.length,
        changedFunctionCount: functionsWithBoundaries.length,
        changeStats,
        functionsWithBoundaries,
        allFunctions,
    };
}

async function analyzeFullProject(projectRoot) { // analyzes the entire project directory – functions and call edges
    const project = createProject();

    const sourceFiles = await collectTypeScriptFilesFromProject(projectRoot);
    
    for (const file of sourceFiles) {
        try {
            project.addSourceFileAtPath(file);
        } catch (err) {
            console.error(`Failed to parse ${file}: ${err.message}`);
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

    // to review later on: for full project analysis, functionsWithBoundaries = functions
    const functionsWithBoundaries = functions;

    const callEdges = edges.filter(e => e.kind === "CALLS").length;
    const crossFileEdges = edges.filter(e => e.scope === "cross-file").length;
    const inFileEdges = edges.filter(e => e.scope === "in-file").length;

    const getProjectRelativePath = (filePath) => {
        return path.relative(projectRoot, filePath).split(path.sep).join("/");
    };

    const repoFiles = sourceFiles.map(getProjectRelativePath).sort((a, b) => a.localeCompare(b));

    console.log(`\nFull project: analyzed files (${repoFiles.length})`);

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

    console.log(`Full project: function relationships (${sortedRelations.length})`);
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
        functionsWithBoundaries,
        edges,
    };
}

module.exports = { analyzeCommitDirectory, analyzeFullProject, loadFullBaseline, saveFullBaseline, buildFullBaselineIndexPath, sortCommitsChronologically };
