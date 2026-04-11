interface DesktopControlBridge { // the bridge object exposed by preload.ts
    getProjectCommitStorageRootDirectory: (projectId: string) => Promise<string>;

    selectProjectRootDirectory: (projectId?: string) => Promise<string | null>;
    getProjectRootDirectory: (projectId?: string) => Promise<string | null>;

    runKnowledgeGraphAnalysis: (projectId: string) => Promise<{ ok: boolean; message?: string; error?: string }>;
    onKnowledgeGraphAnalysisProgress: (callback: (data: { message: string; error?: boolean }) => void) => () => void;
}

declare global {
    interface Window { // calling window.desktopControl.getProjectRootDirectory() would cause an error
        desktopControl?: DesktopControlBridge;
    }
}

export {};