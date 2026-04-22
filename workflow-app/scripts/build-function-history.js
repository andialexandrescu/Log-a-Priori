const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");

function getProjectAppdataPath(projectId) {
    const appData = process.env.APPDATA?.trim();
    const baseDir = appData 
        ? path.join(appData, "log-a-priori-desktop-shell", projectId)
        : path.join(os.homedir(), "AppData", "Roaming", "log-a-priori-desktop-shell", projectId);
    return baseDir;
}

async function exists(targetPath) {
    try {
        await fs.access(targetPath);
        return true;
    } catch {
        return false;
    }
}

// building function history by scanning all per-commit indices
// returns a map: functionKey -> array of commits where it changed { sha, changeType, file, simpleName, kind, boundaries }
async function buildFunctionHistory(projectId) {
    console.log(`Building history for projectId: ${projectId}`);
    
    const baseDir = getProjectAppdataPath(projectId);
    const analysisDir = path.join(baseDir, "analysis");
    
    if (!(await exists(analysisDir))) {
        console.log(`No analysis directory found at ${analysisDir}`);
        return new Map();
    }

    const files = await fs.readdir(analysisDir);
    const isCommitHash = (filename) => /^[a-f0-9]{40}\.json$/.test(filename);
    const commitFiles = files.filter(isCommitHash);

    const commitDataList = [];
    for (const file of commitFiles) { // reading all commit data with timestamps
        const indexPath = path.join(analysisDir, file);
        try {
            const content = await fs.readFile(indexPath, "utf8");
            const indexData = JSON.parse(content);
            if (!indexData.functions || !Array.isArray(indexData.functions)) continue;
            
            let timestamp = indexData.timestamp;
            if (!timestamp) {
                const stat = await fs.stat(indexPath);
                timestamp = stat.mtime.toISOString();
            }
            commitDataList.push({
                sha: indexData.sha,
                timestamp: timestamp,
                functions: indexData.functions,
            });
        } catch (err) {
            console.error(`Failed to parse ${file}: ${err}`);
        }
    }

    commitDataList.sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        if (timeA !== timeB) return timeB - timeA; // descending
        return b.sha.localeCompare(a.sha);
    });

    const functionHistory = new Map();
    for (const commit of commitDataList) {
        for (const func of commit.functions) {
            const key = `${func.file}::${func.simpleName}::${func.kind}`;
            if (!functionHistory.has(key)) {
                functionHistory.set(key, []);
            }
            functionHistory.get(key).push({ // building function history map
                sha: commit.sha,
                changeType: func.changeType,
                simpleName: func.simpleName,
                kind: func.kind,
                file: func.file,
                boundaries: {
                    startLine: func.startLine,
                    endLine: func.endLine,
                    startColumn: func.startColumn,
                    endColumn: func.endColumn,
                },
                previousSha: func.previousSha || null,
                nextSha: func.nextSha || null,
            });
        }
    }

    console.log(`Processed ${commitDataList.length} commits, ${functionHistory.size} unique functions`);
    return functionHistory;
}

async function saveFunctionHistory(projectId, functionHistory) { // saving to json file
    const baseDir = getProjectAppdataPath(projectId);
    const historyPath = path.join(baseDir, "analysis", "function-history.json");
    
    const historyObj = {};
    for (const [key, commits] of functionHistory.entries()) {
        historyObj[key] = commits;
    }

    try {
        await fs.mkdir(path.dirname(historyPath), { recursive: true });
        await fs.writeFile(historyPath, JSON.stringify(historyObj, null, 2), "utf8");
        console.log(`Saved to: ${historyPath}`);
        return historyPath;
    } catch (err) {
        console.error(`Failed to save history: ${err}`);
        throw err;
    }
}

async function loadFunctionHistory(projectId) { // loading from json
    const baseDir = getProjectAppdataPath(projectId);
    const historyPath = path.join(baseDir, "analysis", "function-history.json");

    try {
        const content = await fs.readFile(historyPath, "utf8");
        const historyObj = JSON.parse(content);
        
        const historyMap = new Map(Object.entries(historyObj));
        console.log(`Loaded ${historyMap.size} functions from ${historyPath}`);
        return historyMap;
    } catch (err) {
        console.log(`No existing history found (${err.message})`);
        return null;
    }
}

async function getFunctionHistory(projectId, file, simpleName, kind) { // commits for a specific function
    const history = await loadFunctionHistory(projectId);
    if (!history) return [];

    const key = `${file}::${simpleName}::${kind}`;
    return history.get(key) || [];
}

async function getFunctionSourceCode(projectId, sha, fileRelativePath, boundaries) { // source code for a function at a specific commit
    const baseDir = getProjectAppdataPath(projectId);
    const commitDir = path.join(baseDir, "commits");
    
    // commits/owner/repo/.../commit_sha, finding the full path recursively
    const searchForCommit = async (searchDir) => {
        const entries = await fs.readdir(searchDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (entry.name === sha) {
                    return path.join(searchDir, entry.name);
                }
                const found = await searchForCommit(path.join(searchDir, entry.name));
                if (found) return found;
            }
        }
        return null;
    };

    const commitDirPath = await searchForCommit(commitDir);
    if (!commitDirPath) {
        return null;
    }

    const operationFolders = ['added', 'modified', 'removed'];
    for (const operation of operationFolders) {
        const fullPath = path.join(commitDirPath, operation, fileRelativePath);
        if (await exists(fullPath)) {
            try {
                const content = await fs.readFile(fullPath, "utf8");
                const lines = content.split('\n');
                const start = (boundaries.startLine || 1) - 1;
                const end = boundaries.endLine || lines.length;
                return lines.slice(start, end).join('\n');
            } catch (err) {
                console.error(`Failed to read ${fullPath}: ${err}`);
                return null;
            }
        }
    }

    console.warn(`File not found in any operation folder: ${fileRelativePath}`);
    return null;
}

async function main() {
    const args = process.argv.slice(2);
    const projectId = args[0];

    if (args.length === 1) { // building and saving history right after
        const history = await buildFunctionHistory(projectId);
        const outputPath = await saveFunctionHistory(projectId, history);
        console.log(`\nCompleted, function history saved to: ${outputPath}`);
    } else if (args.length >= 3) { // querying specific function
        const file = args[1];
        const simpleName = args[2];
        const kind = args[3] || 'function';
        
        console.log(`\nQuerying: ${file}::${simpleName}::${kind}`);
        const commits = await getFunctionHistory(projectId, file, simpleName, kind);
        
        if (commits.length === 0) {
            console.log(`No history found for this function`);
        } else {
            console.log(`Found in ${commits.length} commits:`);
            for (const commit of commits) {
                console.log(`  - ${commit.sha} [${commit.changeType}]`);
                console.log(`\tLines ${commit.boundaries.startLine}-${commit.boundaries.endLine}`);
            }
        }
    }
}

module.exports = { buildFunctionHistory, saveFunctionHistory, loadFunctionHistory, getFunctionHistory, getFunctionSourceCode };

if (require.main === module) {
    main().catch(err => {
        console.error(`Error: ${err.message}`);
        process.exit(1);
    });
}
