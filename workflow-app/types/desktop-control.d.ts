interface DesktopControlBridge {
    getProjectCommitStorageRootDirectory: (userId: string, projectId: string) => Promise<string>;

    selectProjectRootDirectory: (userId: string, projectId?: string) => Promise<string | null>;
    getProjectRootDirectory: (userId: string, projectId?: string) => Promise<string | null>;
    promotePendingProjectRoot: (userId: string, projectId: string) => Promise<string | null>;

    pullProjectRootLatest: (
        userId: string,
        projectId: string
    ) => Promise<{ ok: boolean; message?: string; error?: string }>;

    runKnowledgeGraphAnalysis: (userId: string, projectId: string) => Promise<{ ok: boolean; message?: string; error?: string }>;
    onKnowledgeGraphAnalysisProgress: (callback: (data: { message: string; error?: boolean }) => void) => () => void;
}

declare global {
    interface Window {
        desktopControl?: DesktopControlBridge;
    }
}

export {};
