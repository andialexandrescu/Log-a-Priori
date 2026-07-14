"use client";

import { useEffect, useState } from "react";

const SIDEBAR_SELECTOR = "[data-project-right-sidebar]";

// full height vertical rule at the project sidebar's left edge (viewport bottom), without stretching the sidebar or main workspace layout
export function ProjectRightSidebarRule() {
    const [ruleStyle, setRuleStyle] = useState<React.CSSProperties>({ display: "none" });

    useEffect(() => {
        const sync = () => {
            const sidebar = document.querySelector(SIDEBAR_SELECTOR);
            if (!sidebar) {
                setRuleStyle({ display: "none" });
                return;
            }

            const { left, top } = sidebar.getBoundingClientRect();
            setRuleStyle({
                display: "block",
                position: "fixed",
                left: Math.round(left),
                top: Math.round(top),
                bottom: 0,
                width: 1,
            });
        };

        sync();

        const sidebar = document.querySelector(SIDEBAR_SELECTOR);
        let resizeObserver: ResizeObserver | null = null;
        if (sidebar && typeof ResizeObserver !== "undefined") {
            resizeObserver = new ResizeObserver(sync);
            resizeObserver.observe(sidebar);
        }

        window.addEventListener("resize", sync);
        window.addEventListener("scroll", sync, true);

        return () => {
            resizeObserver?.disconnect();
            window.removeEventListener("resize", sync);
            window.removeEventListener("scroll", sync, true);
        };
    }, []);

    return (
        <div aria-hidden data-project-right-sidebar-rule className="pointer-events-none z-0 bg-border" style={ruleStyle} />
    );
}
