"use client";

import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { clampProjectRightPanelWidth, getProjectRightPanelGeometry, measureProjectRightPanelMinWidth, measureProjectRightSidebarRect, PROJECT_RIGHT_PANEL_CLASS, PROJECT_RIGHT_SIDEBAR_WIDTH_PX, type ProjectRightSidebarRect } from "@/features/projects/lib/project-right-sidebar-layout";

function readInitialSidebarRect(): ProjectRightSidebarRect {
    if (typeof window === "undefined") {
        return { left: 0, width: PROJECT_RIGHT_SIDEBAR_WIDTH_PX };
    }
    return measureProjectRightSidebarRect();
}

function readInitialPanelWidth(): number {
    if (typeof window === "undefined") {
        return PROJECT_RIGHT_SIDEBAR_WIDTH_PX;
    }
    return measureProjectRightPanelMinWidth();
}

type ProjectRightPanelProps = {
    open: boolean;
    children: ReactNode | ((panelWidth: number) => ReactNode);
    ariaLabel?: string;
    onWidthChange?: (width: number) => void;
};

export function ProjectRightPanel({ open, children, ariaLabel = "Project panel", onWidthChange }: ProjectRightPanelProps) {
    const [panelWidth, setPanelWidth] = useState(readInitialPanelWidth);
    const [sidebarRect, setSidebarRect] = useState<ProjectRightSidebarRect>(readInitialSidebarRect);
    const [isResizing, setIsResizing] = useState(false);

    useEffect(() => {
        if (open) {
            onWidthChange?.(panelWidth);
        }
    }, [open, panelWidth, onWidthChange]);

    useLayoutEffect(() => {
        if (!open) return;
        const rect = measureProjectRightSidebarRect();
        setSidebarRect(rect);
        setPanelWidth(measureProjectRightPanelMinWidth());
    }, [open]);

    useEffect(() => {
        if (!open) return;

        const syncWidthToBounds = () => {
            const rect = measureProjectRightSidebarRect();
            setSidebarRect(rect);
            setPanelWidth((current) => clampProjectRightPanelWidth(current));
        };

        const onMouseMove = (event: MouseEvent) => {
            if (!isResizing) return;
            setPanelWidth(clampProjectRightPanelWidth(window.innerWidth - event.clientX));
        };

        const onMouseUp = () => {
            setIsResizing(false);
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
        };

        syncWidthToBounds();

        const sidebar = document.querySelector("[data-project-right-sidebar]");
        let resizeObserver: ResizeObserver | null = null;
        if (sidebar && typeof ResizeObserver !== "undefined") {
            resizeObserver = new ResizeObserver(syncWidthToBounds);
            resizeObserver.observe(sidebar);
        }

        window.addEventListener("resize", syncWidthToBounds);
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);

        return () => {
            resizeObserver?.disconnect();
            window.removeEventListener("resize", syncWidthToBounds);
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
            document.body.style.userSelect = "";
            document.body.style.cursor = "";
        };
    }, [open, isResizing]);

    if (!open) {
        return null;
    }

    const geometry = getProjectRightPanelGeometry(panelWidth, sidebarRect);

    return createPortal(
        <div role="dialog" aria-modal={false} aria-label={ariaLabel} className={PROJECT_RIGHT_PANEL_CLASS}
            style={{
                left: `${geometry.left}px`,
                ...(geometry.right !== undefined
                    ? { right: geometry.right }
                    : { width: `${geometry.width}px`, maxWidth: "50vw" }),
            }}
        >
            <div
                className="absolute left-0 top-0 h-full w-2 -translate-x-1/2 cursor-col-resize touch-none"
                onMouseDown={() => {
                    setIsResizing(true);
                    document.body.style.userSelect = "none";
                    document.body.style.cursor = "col-resize";
                }}
                aria-label="Resize panel"
                title="Drag left to widen over the graph"
            >
                <div className="mx-auto h-full w-px bg-border/70 hover:bg-primary/60" />
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                {typeof children === "function" ? children(panelWidth) : children}
            </div>
        </div>,
        document.body
    );
}

export { PROJECT_RIGHT_SIDEBAR_WIDTH_PX };
