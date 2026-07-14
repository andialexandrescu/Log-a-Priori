export const GRAPH_CLUSTER_DIM_OPACITY = 0.22;

export const GRAPH_CLUSTER_MATCH_STROKE = "#4f46e5";

export const GRAPH_CLUSTER_FLICKER_MIN_OPACITY = 0.35;
export const GRAPH_CLUSTER_FLICKER_MAX_OPACITY = 1;
export const GRAPH_CLUSTER_FLICKER_SPEED = 12;

export type GraphNodeBaseStyle = {
    fill: string;
    strokeWidth: number;
    stroke?: string;
};

export function applyClusterHighlightToNodeStyle( baseStyle: GraphNodeBaseStyle, options: { clusterActive: boolean; isClusterMatch: boolean }): GraphNodeBaseStyle & { opacity?: number } {
    if (!options.clusterActive) {
        return baseStyle;
    }

    if (options.isClusterMatch) {
        return {
            ...baseStyle,
            strokeWidth: Math.max(baseStyle.strokeWidth, 3),
            stroke: GRAPH_CLUSTER_MATCH_STROKE,
            opacity: 1,
        };
    }

    return { ...baseStyle, opacity: GRAPH_CLUSTER_DIM_OPACITY };
}

export type GraphNodeVisualData = {
    graphOpacity?: number;
    clusterFlicker?: boolean;
};

export function attachClusterHighlightNodeData<T extends Record<string, unknown>>(
    nodeData: T,
    options: {
        style: GraphNodeBaseStyle & { opacity?: number };
        clusterActive: boolean;
        isClusterMatch: boolean;
    }
): T & GraphNodeVisualData {
    const next: T & GraphNodeVisualData = { ...nodeData };

    if (typeof options.style.opacity === "number") {
        next.graphOpacity = options.style.opacity;
    }

    if (options.clusterActive && options.isClusterMatch) {
        next.clusterFlicker = true;
    }

    return next;
}
