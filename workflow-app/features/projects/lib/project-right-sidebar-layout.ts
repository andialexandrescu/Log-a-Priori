export const PROJECT_RIGHT_SIDEBAR_WIDTH_PX = 256;

const RIGHT_SIDEBAR_SELECTOR = "[data-project-right-sidebar]";

export type ProjectRightSidebarRect = {
    left: number;
    width: number;
};

export function measureProjectRightSidebarRect(): ProjectRightSidebarRect {
    if (typeof window === "undefined") {
        return {
            left: 0,
            width: PROJECT_RIGHT_SIDEBAR_WIDTH_PX,
        };
    }

    const sidebar = document.querySelector(RIGHT_SIDEBAR_SELECTOR);
    if (sidebar) {
        const rect = sidebar.getBoundingClientRect();
        return {
            left: Math.round(rect.left),
            width: Math.round(rect.width),
        };
    }

    return {
        left: Math.round(window.innerWidth - PROJECT_RIGHT_SIDEBAR_WIDTH_PX),
        width: PROJECT_RIGHT_SIDEBAR_WIDTH_PX,
    };
}

export function measureProjectRightPanelMinWidth(): number {
    if (typeof window === "undefined") {
        return PROJECT_RIGHT_SIDEBAR_WIDTH_PX;
    }

    const { left } = measureProjectRightSidebarRect();
    return Math.round(window.innerWidth - left);
}

export type ProjectRightPanelGeometry = {
    left: number;
    width?: number;
    right?: number;
};

export function getProjectRightPanelGeometry( panelWidth: number, sidebar: ProjectRightSidebarRect = measureProjectRightSidebarRect() ): ProjectRightPanelGeometry {
    const minWidth =
        typeof window === "undefined"
            ? sidebar.width
            : Math.round(window.innerWidth - sidebar.left);
    const width = Math.max(panelWidth, minWidth);

    if (width <= minWidth) {
        return { left: sidebar.left, right: 0 };
    }

    return {
        left: Math.round(window.innerWidth - width),
        width,
    };
}

export function getProjectRightPanelResizeBounds() {
    const minWidth = measureProjectRightPanelMinWidth();
    const maxWidth =
        typeof window === "undefined"
            ? minWidth
            : Math.floor(window.innerWidth * 0.5);

    return {
        minWidth,
        defaultWidth: minWidth,
        maxWidth,
    };
}

export function clampProjectRightPanelWidth(width: number): number {
    const { minWidth, maxWidth } = getProjectRightPanelResizeBounds();
    return Math.min(Math.max(width, minWidth), maxWidth);
}

export const PROJECT_RIGHT_PANEL_CLASS =
    "fixed top-0 z-50 flex h-full flex-col border-l bg-background shadow-lg";