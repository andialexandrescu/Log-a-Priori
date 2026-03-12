interface DesktopControlBridge { // the bridge object exposed by preload.ts
    selectRootDirectory: () => Promise<string | null>;
    getRootDirectory: () => Promise<string | null>;
}

declare global {
    interface Window { // calling window.desktopControl.getRootDirectory() would cause an error
        desktopControl?: DesktopControlBridge;
    }
}

export {};