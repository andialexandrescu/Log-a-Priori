"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Loader2, Maximize2, Minimize2, RefreshCw, X } from "lucide-react";
import { GraphCanvas, lightTheme, type NodeRendererProps } from "reagraph";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useGetCodeGraph } from "../api/use-get-code-graph";
import { KnowledgeGraphStatsSidebar, KnowledgeGraphStatsToggle } from "./stats-controls";
import { KnowledgeGraphPagerControls } from "./pager-controls";
import { Button } from "@/components/ui/button";
import { FlickeringGraphNode } from "@/features/knowledge-graph/components/flickering-graph-node";
import { applyClusterHighlightToNodeStyle, attachClusterHighlightNodeData, type GraphNodeVisualData } from "@/features/knowledge-graph/lib/graph-cluster-highlight";
import { BackgroundProcessPanel } from "@/components/ui/background-process-panel";
import { useQueryClient } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useGetFunctionHistory, type FunctionHistoryEntry } from "../api/use-get-function-history";
import { useGetFunctionSource } from "../api/use-get-function-source";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { useGetRemovedGraph } from "../api/use-get-removed-graph";
import { useDesktopUserId } from "@/lib/use-desktop-user-id";
import { isKnowledgeGraphAnalysisInFlight, runProjectKnowledgeGraphAnalysis } from "@/features/knowledge-graph/lib/run-knowledge-graph-analysis";
import { KnowledgeGraphAnalysisPreparing } from "@/features/knowledge-graph/components/knowledge-graph-analysis-preparing";
import { useKnowledgeGraphAnalysisStatus } from "@/features/knowledge-graph/hooks/use-knowledge-graph-analysis-status";
import { HIGHLIGHT_RERUN_ANALYSIS_EVENT } from "@/features/knowledge-graph/lib/graph-folder-sync-state";
import {
    augmentVisualizationNodes,
    computeGraphEdgeStats,
    formatGraphEdgeKindScope,
    formatGraphEdgeRelation,
    formatGraphNodeKindLabel,
    inferGraphEdgeRelation,
    mergeGraphEdgeDetails,
    type GraphEdgeRelation,
} from "@/features/knowledge-graph/lib/graph-edge-details";
import type { GraphCounts } from "@/features/knowledge-graph/components/stats-controls";
import { RawPPRClusterDialog } from "./raw-ppr-cluster-dialog";
import { ProjectDocumentationDrawer } from "./project-documentation-drawer";
import { ProjectRightPanel } from "@/features/projects/components/project-right-panel";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/prism-light.js";
import oneLight from "react-syntax-highlighter/dist/esm/styles/prism/one-light.js";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx.js";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript.js";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript.js";

SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("javascript", javascript);

type FunctionNode = {
    key: string;
    name: string;
    file: string;
    line: number;
    commitHistory?: FunctionHistoryEntry[];
    simpleName?: string;
    kind?: string;
};

type GraphFunctionRecord = {
    id: string;
    name?: string;
    simpleName?: string;
    kind?: string;
    file?: string;
    repoRelativePath?: string;
    line?: number;
    startLine?: number;
    endLine?: number;
};

type SelectedFunctionNode = {
    key: string;
    name: string;
    simpleName: string;
    kind: string;
    file: string;
    line: number;
    startLine?: number;
    endLine?: number;
};

type FunctionSourcePayload = {
    data?: {
        sha: string;
        file: string;
        operation: string;
        startLine: number;
        endLine: number;
        sourceCode: string;
    } | null;
    message?: string;
};

type CodeGraphPayload = {
    data?: {
        graph?: {
            nodes?: GraphFunctionRecord[];
            edges?: FunctionEdge[];
        };
        visualization?: {
            functionNodes?: FunctionNode[];
            edges?: {
                calls?: {
                    inFile?: FunctionEdge[];
                    crossFile?: FunctionEdge[];
                };
            };
            components?: string[][];
        };
    } | null;
};

type FunctionEdge = {
    from: string;
    to: string;
    scope?: string | null;
    kind?: string;
    relation?: GraphEdgeRelation | string | null;
    label?: string | null;
    filePath?: string | null;
    startLine?: number | null;
};

type GraphHoverNode = {
    data?: FunctionNode;
};

type GraphHoverEdge = {
    id?: string;
    source?: string;
    target?: string;
    data?: FunctionEdge;
};

type GraphPointerEvent = {
    clientX: number;
    clientY: number;
};

type GraphViewMode = "component" | "all-commits";

type GraphDataResult = {
    graphData: {
        nodes: Array<{
            id: string;
            label: string;
            data: FunctionNode;
            fill?: string;
            strokeWidth?: number;
            stroke?: string;
            opacity?: number;
        }>;
        edges: Array<{
            id: string;
            source: string;
            target: string;
            label: string;
            data: FunctionEdge;
            fill?: string;
            dashed?: boolean;
            dashArray?: [number, number];
            interpolation?: "curved" | "linear";
        }>;
    };
    componentCount: number;
    selectedComponentLabel: string;
};

function getSourceLanguage(filePath?: string) {
    const normalized = (filePath ?? "").toLowerCase();
    if (normalized.endsWith(".tsx")) return "tsx";
    if (normalized.endsWith(".ts")) return "typescript";
    if (normalized.endsWith(".jsx")) return "javascript";
    if (normalized.endsWith(".js")) return "javascript";
    return "typescript";
}

function getClientPosFromGraphEvent(event: unknown): { x: number; y: number } | null {
    const e = event as {
        clientX?: number;
        clientY?: number;
        pageX?: number;
        pageY?: number;
        pointer?: { clientX?: number; clientY?: number };
        nativeEvent?: { clientX?: number; clientY?: number; pageX?: number; pageY?: number };
        sourceEvent?: { clientX?: number; clientY?: number; pageX?: number; pageY?: number };
    };

    const native = e?.nativeEvent ?? e?.sourceEvent;
    const clientX = e?.clientX ?? e?.pointer?.clientX ?? native?.clientX ?? e?.pageX ?? native?.pageX;
    const clientY = e?.clientY ?? e?.pointer?.clientY ?? native?.clientY ?? e?.pageY ?? native?.pageY;

    if (typeof clientX === "number" && typeof clientY === "number") {
        return { x: clientX, y: clientY };
    }

    return null;
}

function resolveHoveredEdge(
    edge: GraphHoverEdge,
    edgeDataById: Map<string, FunctionEdge>,
): FunctionEdge | null {
    if (edge.data?.from && edge.data?.to) {
        return edge.data;
    }

    if (typeof edge.id === "string" && edgeDataById.has(edge.id)) {
        return edgeDataById.get(edge.id) ?? null;
    }

    if (typeof edge.source === "string" && typeof edge.target === "string") {
        for (const payload of edgeDataById.values()) {
            if (payload.from === edge.source && payload.to === edge.target) {
                return payload;
            }
        }

        return {
            from: edge.source,
            to: edge.target,
            kind: "CALLS",
            scope: "in-file",
        };
    }

    return null;
}

function isModuleGraphNode(node: Pick<FunctionNode, "key" | "kind"> | null | undefined) {
    return node?.kind === "module" || (typeof node?.key === "string" && node.key.startsWith("module:"));
}

function getEdgeLabel(edge: FunctionEdge) {
    return formatGraphEdgeKindScope(edge);
}

function getEdgeStyle(edge: FunctionEdge, isHovered = false) {
    const isCrossFile = edge.scope === "cross-file";

    if (isHovered) {
        return {
            fill: "#1e293b",
            dashed: isCrossFile,
            dashArray: isCrossFile ? ([5, 4] as [number, number]) : undefined,
            interpolation: (isCrossFile ? "curved" : "linear") as "curved" | "linear",
        };
    }

    return {
        fill: "#64748b",
        dashed: isCrossFile,
        dashArray: isCrossFile ? ([5, 4] as [number, number]) : undefined,
        interpolation: (isCrossFile ? "curved" : "linear") as "curved" | "linear",
    };
}

function formatEdgeRelation(edge: FunctionEdge, nodeById: Map<string, FunctionNode>) {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    const fromLabel = fromNode ? `${fromNode.name} [${fromNode.file}]` : edge.from;
    const toLabel = toNode ? `${toNode.name} [${toNode.file}]` : edge.to;
    return `${fromLabel} -> ${toLabel}`;
}

function formatEdgeLocation(edge: FunctionEdge) {
    if (!edge.filePath && typeof edge.startLine !== "number") {
        return null;
    }
    const file = edge.filePath?.split("\\").join("/") ?? "unknown-file";
    if (typeof edge.startLine === "number" && edge.startLine > 0) {
        return `${file}:${edge.startLine}`;
    }
    return file;
}

function getNodeStyle(node: FunctionNode, commitHistory?: FunctionHistoryEntry[]) {
    if (isModuleGraphNode(node)) {
        return { fill: "#fde68a", strokeWidth: 2, stroke: "#d97706" };
    }

    if (!commitHistory || commitHistory.length === 0) {
        return { fill: "#e2e8f0", strokeWidth: 1, stroke: "#e2e8f0" }; // edges with no commit history are grey, since there might be part of files not pushed yet
    }
    const latestChange = commitHistory[0].changeType;
    const colorMap: Record<string, { fill: string; strokeWidth: number }> = {
        added: { fill: "#86efac", strokeWidth: 2 }, // green
        modified: { fill: "#93c5fd", strokeWidth: 2 }, // blue
        removed: { fill: "#fca5a5", strokeWidth: 2 }, // red
        unchanged: { fill: "#e2e8f0", strokeWidth: 1 }, // grey
    };
    return colorMap[latestChange] || colorMap.unchanged;
}

export function KnowledgeGraphCanvas({ projectId, canRunAnalysis = true, canManageDocumentation = true, onRequestHighlightRerun }: { projectId: string; canRunAnalysis?: boolean; canManageDocumentation?: boolean; onRequestHighlightRerun?: () => void;}) {
    const userId = useDesktopUserId();
    const { data, isLoading } = useGetCodeGraph(projectId);
    const queryClient = useQueryClient();
    const { data: removedData, isLoading: removedLoading } = useGetRemovedGraph(projectId);
    const [currentComponentIndex, setCurrentComponentIndex] = useState(0);
    const [viewMode, setViewMode] = useState<GraphViewMode>("component");
    const [fullScreen, setFullScreen] = useState(false);
    const [minimalMode, setMinimalMode] = useState(true);
    const [hoveredNode, setHoveredNode] = useState<FunctionNode | null>(null);
    const [hoveredEdge, setHoveredEdge] = useState<FunctionEdge | null>(null);
    const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
    const [hoverClientPos, setHoverClientPos] = useState<{ x: number; y: number } | null>(null);
    const [pointerClientPos, setPointerClientPos] = useState<{ x: number; y: number } | null>(null);
    const {
        isAnalyzing,
        analysisLog,
        analysisPhase,
        setAnalysisPhase,
        setAnalysisLog,
    } = useKnowledgeGraphAnalysisStatus(projectId);
    const autoAnalysisStarted = useRef(false);
    const [selectedFunction, setSelectedFunction] = useState<SelectedFunctionNode | null>(null);
    const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
    const [selectedHistoryIndex, setSelectedHistoryIndex] = useState(-1);
    const [clusterHighlightNodes, setClusterHighlightNodes] = useState<Set<string>>(new Set());
    const [isDocumentationDrawerOpen, setIsDocumentationDrawerOpen] = useState(false);
    const [isRawPPRClusterOpen, setIsRawPPRClusterOpen] = useState(false);
    const [highlightRerunAnalysis, setHighlightRerunAnalysis] = useState(false);
    const rerunAnalysisButtonRef = useRef<HTMLButtonElement>(null);
    const graphCanvasRef = useRef<any>(null);

    const renderCustomNode = ({ color, size, opacity, node }: NodeRendererProps) => {
        const visual = node.data as GraphNodeVisualData | undefined;
        const resolvedOpacity = typeof visual?.graphOpacity === "number" ? visual.graphOpacity : opacity;
        return (
            <FlickeringGraphNode color={color} size={size} opacity={resolvedOpacity} flicker={visual?.clusterFlicker === true} />
        );
    };

    useEffect(() => {
        const onHighlightRerun = (event: Event) => {
            const detail = (event as CustomEvent<{ projectId: string }>).detail;
            if (detail?.projectId === projectId) {
                setHighlightRerunAnalysis(true);
                onRequestHighlightRerun?.();
            }
        };

        window.addEventListener(HIGHLIGHT_RERUN_ANALYSIS_EVENT, onHighlightRerun);
        return () => window.removeEventListener(HIGHLIGHT_RERUN_ANALYSIS_EVENT, onHighlightRerun);
    }, [projectId, onRequestHighlightRerun]);

    const handleRunAnalysis = async () => {
        if (!projectId || !userId || isAnalyzing) {
            return;
        }
        setHighlightRerunAnalysis(false);
        setAnalysisPhase("scanning");
        setAnalysisLog(null);
        try {
            const ok = await runProjectKnowledgeGraphAnalysis(queryClient, userId, projectId, {
                onProgress: ({ message, error }) => {
                    setAnalysisLog(message);
                    if (error) {
                        setAnalysisPhase("error");
                    }
                },
            });
            setAnalysisPhase(ok ? "complete" : "error");
        } catch {
            setAnalysisPhase("error");
        }
    };

    const codeGraphPayload = data as CodeGraphPayload | undefined;
    const graph = codeGraphPayload?.data?.graph;
    const visualization = codeGraphPayload?.data?.visualization;

    useEffect(() => {
        if (!canRunAnalysis || autoAnalysisStarted.current || isLoading || graph) {
            return;
        }
        if (!userId || !projectId || typeof window === "undefined" || !window.desktopControl) {
            return;
        }

        if (isKnowledgeGraphAnalysisInFlight(projectId)) {
            autoAnalysisStarted.current = true;
            const interval = window.setInterval(() => {
                void queryClient.invalidateQueries({
                    queryKey: ["projects", projectId, "knowledge-graph"],
                    exact: true,
                });
            }, 3000);
            return () => {
                window.clearInterval(interval);
            };
        }

        if (isAnalyzing) {
            return;
        }

        autoAnalysisStarted.current = true;
        setAnalysisPhase("scanning");
        setAnalysisLog(null);
        void runProjectKnowledgeGraphAnalysis(queryClient, userId, projectId, {
            onProgress: ({ message, error }) => {
                setAnalysisLog(message);
                if (error) {
                    setAnalysisPhase("error");
                }
            },
        }).then((ok) => setAnalysisPhase(ok ? "complete" : "error"));
    }, [canRunAnalysis, graph, isAnalyzing, isLoading, projectId, queryClient, setAnalysisLog, setAnalysisPhase, userId]);

    const graphNodeByKey = useMemo(() => {
        const map = new Map<string, GraphFunctionRecord>();
        const rawNodes = (graph?.nodes ?? []) as GraphFunctionRecord[];

        for (const node of rawNodes) {
            if (typeof node?.id === "string" && node.id) {
                map.set(node.id, node);
            }
        }

        return map;
    }, [graph?.nodes]);

    const historyQuery = useGetFunctionHistory(
        projectId,
        selectedFunction && !isModuleGraphNode(selectedFunction)
            ? {
                file: selectedFunction.file,
                simpleName: selectedFunction.simpleName,
                kind: selectedFunction.kind,
            }
            : null
    );

    const historyEntries = useMemo(() => {
        if (!historyQuery.data || typeof historyQuery.data !== "object" || !("data" in historyQuery.data)) {
            return [] as FunctionHistoryEntry[];
        }

        const maybeData = historyQuery.data.data;
        return Array.isArray(maybeData) ? (maybeData as FunctionHistoryEntry[]) : [];
    }, [historyQuery.data]);

    useEffect(() => {
        setSelectedHistoryIndex(-1);
    }, [selectedFunction?.key]);

    useEffect(() => {
        if (historyEntries.length === 0) {
            setSelectedHistoryIndex(-1);
            return;
        }

        setSelectedHistoryIndex((prev) => {
            if (prev >= 0 && prev < historyEntries.length) {
                return prev;
            }

            return 0; // starting with the first/ oldest commit
        });
    }, [historyEntries]);

    const selectedCommit = selectedHistoryIndex >= 0 && selectedHistoryIndex < historyEntries.length ? historyEntries[selectedHistoryIndex] : null;

    const selectedSourceParams = useMemo(() => {
        if (!selectedFunction || isModuleGraphNode(selectedFunction)) {
            return null;
        }

        const hasHistory = historyEntries.length > 0; // if there is no commit history, use current source for functions not tracked yet
        if (!hasHistory) {
            const startLine = selectedFunction.startLine || selectedFunction.line || 1;
            const endLine = selectedFunction.endLine || startLine;
            return {
                sha: "current",
                file: selectedFunction.file,
                startLine,
                endLine,
            };
        }

        if (!selectedCommit) return null;

        const startLine = Math.max(1, selectedCommit.boundaries?.startLine ?? selectedFunction.startLine ?? selectedFunction.line ?? 1);
        const endLine = Math.max(startLine, selectedCommit.boundaries?.endLine ?? selectedFunction.endLine ?? startLine);

        return {
            sha: selectedCommit.sha,
            file: selectedCommit.file || selectedFunction.file,
            startLine,
            endLine,
        };
    }, [selectedCommit, selectedFunction]);

    const sourceQuery = useGetFunctionSource(projectId, selectedSourceParams);
    const sourcePayload = sourceQuery.data as FunctionSourcePayload | undefined;

    useEffect(() => {
        if (!fullScreen) return;
        const previousOverflow = document.body.style.overflow;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setFullScreen(false);
        };
        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", onKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [fullScreen]);

    const graphDataResult = useMemo((): GraphDataResult => { // prepare data for reagraph
        const rawGraphEdges = (graph?.edges ?? []) as FunctionEdge[];
        const rawNodes = augmentVisualizationNodes(
            (visualization?.functionNodes ?? []) as FunctionNode[],
            rawGraphEdges
        ) as FunctionNode[];
        const rawCallInFileEdges = mergeGraphEdgeDetails(
            (visualization?.edges?.calls?.inFile ?? []) as FunctionEdge[],
            rawGraphEdges
        ) as FunctionEdge[];
        const rawCallCrossFileEdges = mergeGraphEdgeDetails(
            (visualization?.edges?.calls?.crossFile ?? []) as FunctionEdge[],
            rawGraphEdges
        ) as FunctionEdge[];
        const rawComponents = (visualization?.components ?? []) as string[][];

        const componentList = rawComponents.length > 0 ? rawComponents : [rawNodes.map((n) => n.key)];
        const clampedIndex = Math.max(0, Math.min(currentComponentIndex, componentList.length - 1));
        const selectedComponentKeys = componentList[clampedIndex] ?? [];
        const selectedKeySet = viewMode === "all-commits"
            ? new Set(rawNodes.map((node) => node.key))
            : new Set(selectedComponentKeys);

        const scopedNodes = rawNodes.filter((node) => selectedKeySet.has(node.key));
        const scopedKeySet = new Set(scopedNodes.map((node) => node.key));
        const clusterActive = clusterHighlightNodes.size > 0;

        const allEdges = [ // combine edges
            ...rawCallInFileEdges,
            ...rawCallCrossFileEdges,
        ];
        const scopedEdges = allEdges.filter(
            (edge): edge is FunctionEdge =>
                typeof edge.from === "string" &&
                typeof edge.to === "string" &&
                scopedKeySet.has(edge.from) &&
                scopedKeySet.has(edge.to)
        );

        const nodes = scopedNodes.map((node) => {
            const nodeStyle = getNodeStyle(node, node.commitHistory);
            const isClusterMatch = clusterHighlightNodes.has(node.key);
            const highlightedStyle = applyClusterHighlightToNodeStyle(nodeStyle, {
                clusterActive,
                isClusterMatch,
            });
            const { opacity: _opacity, ...nodeVisualStyle } = highlightedStyle;

            return {
                id: node.key,
                label: node.name,
                data: attachClusterHighlightNodeData(node, {
                    style: highlightedStyle,
                    clusterActive,
                    isClusterMatch,
                }),
                ...nodeVisualStyle,
            };
        });

        const edges = scopedEdges.map((edge, idx) => ({
            id: `${edge.from}-${edge.to}-${idx}`,
            source: edge.from,
            target: edge.to,
            label: "",
            data: edge,
            ...getEdgeStyle(edge),
        }));

        return {
            graphData: { nodes, edges },
            componentCount: componentList.length,
            selectedComponentLabel: `${clampedIndex + 1}/${Math.max(componentList.length, 1)}`,
        };
    }, [graph?.edges, visualization, currentComponentIndex, viewMode, clusterHighlightNodes]);

    const { graphData, componentCount, selectedComponentLabel } = graphDataResult;

    const mergedGraphData = useMemo((): GraphDataResult => {
        const removed = removedData?.data;
        
        if (!removed || !removed.visualization?.functionNodes) {
            return { graphData, componentCount, selectedComponentLabel };
        }

        const clusterActive = clusterHighlightNodes.size > 0;
        const existingKeys = new Set(graphData.nodes.map((n) => n.id));
        const newRemovedNodes = removed.visualization.functionNodes
            .filter((node) => !existingKeys.has(node.key))
            .map((node) => {
                const removedBase = {
                    fill: "#fca5a5",
                    strokeWidth: 2,
                    stroke: "#ef4444",
                };
                const isClusterMatch = clusterHighlightNodes.has(node.key);
                const highlightedRemovedStyle = applyClusterHighlightToNodeStyle(removedBase, {
                    clusterActive,
                    isClusterMatch,
                });
                const { opacity: _opacity, ...removedVisualStyle } = highlightedRemovedStyle;

                return {
                    id: node.key,
                    label: node.name,
                    data: attachClusterHighlightNodeData(
                        {
                            ...node,
                            isRemoved: true,
                            commitHistory: node.commitHistory,
                        },
                        {
                            style: highlightedRemovedStyle,
                            clusterActive,
                            isClusterMatch,
                        }
                    ),
                    ...removedVisualStyle,
                };
            });
        
        const mergedNodes = [...graphData.nodes, ...newRemovedNodes]; // merging other types of nodes with removed ones and edges
        const mergedEdges = [...graphData.edges];
        
        return {
            graphData: {
                nodes: mergedNodes,
                edges: mergedEdges,
            },
            componentCount,
            selectedComponentLabel,
        };
    }, [graphData, removedData, clusterHighlightNodes, componentCount, selectedComponentLabel]);

    const counts = useMemo((): GraphCounts => {
        const graphNodes = mergedGraphData.graphData.nodes.map((node) => node.data as FunctionNode);
        const graphEdges = mergedGraphData.graphData.edges.map((edge) => edge.data as FunctionEdge);
        const edgeStats = computeGraphEdgeStats(graphEdges);

        const functionNodes = graphNodes.filter((node) => !isModuleGraphNode(node)).length;
        const methodNodes = graphNodes.filter((node) => node.kind === "method").length;
        const lambdaNodes = graphNodes.filter((node) => node.kind === "lambda").length;
        const topLevelFunctionNodes = graphNodes.filter((node) => node.kind === "function").length;
        const moduleNodes = graphNodes.filter((node) => isModuleGraphNode(node)).length;

        const executableNodes = graphNodes.filter((node) => !isModuleGraphNode(node));
        const roots = executableNodes.filter((node) =>
            !mergedGraphData.graphData.edges.some((edge) => edge.target === node.key)
        ).length;

        const files = new Set(graphNodes.map((node) => node.file)).size;

        return {
            nodes: graphNodes.length,
            functionNodes: topLevelFunctionNodes,
            methodNodes,
            lambdaNodes,
            moduleNodes,
            ...edgeStats,
            roots,
            files,
        };
    }, [mergedGraphData]);

    const nodeById = useMemo(() => {
        return new Map(mergedGraphData.graphData.nodes.map((node) => [node.id, node.data as FunctionNode]));
    }, [mergedGraphData.graphData.nodes]);

    const edgeDataById = useMemo(() => {
        return new Map(
            mergedGraphData.graphData.edges.map((edge) => [edge.id, edge.data as FunctionEdge])
        );
    }, [mergedGraphData.graphData.edges]);

    const tooltipClientPos = hoverClientPos ?? pointerClientPos;

    const canvasGraphData = useMemo(() => {
        const edges = mergedGraphData.graphData.edges.map((edge) => {
            const isHovered = hoveredEdgeId != null && edge.id === hoveredEdgeId;
            const edgeData = edge.data as FunctionEdge;
            return {
                ...edge,
                label: "",
                ...getEdgeStyle(edgeData, isHovered),
            };
        });

        return {
            nodes: mergedGraphData.graphData.nodes,
            edges,
        };
    }, [mergedGraphData.graphData.nodes, mergedGraphData.graphData.edges, hoveredEdgeId]);

    const goToPreviousComponent = () => setCurrentComponentIndex((prev) => Math.max(0, prev - 1));
    const goToNextComponent = () => setCurrentComponentIndex((prev) => Math.min(componentCount - 1, prev + 1));
    const toggleFullScreen = () => setFullScreen((prev) => !prev);
    const isComponentView = viewMode === "component";

    const clusterAndDocumentationPanels = (
        <>
            <RawPPRClusterDialog
                projectId={projectId}
                canManageDocumentation={canManageDocumentation}
                hideTriggerButton
                open={isRawPPRClusterOpen}
                onOpenChange={setIsRawPPRClusterOpen}
                onClusterUpdate={(nodeIds) => {
                    setClusterHighlightNodes(new Set(nodeIds));
                }}
                onGoToDocumentation={() => {
                    setIsRawPPRClusterOpen(false);
                    setIsDocumentationDrawerOpen(true);
                }}
            />
            <ProjectDocumentationDrawer
                projectId={projectId}
                canManageDocumentation={canManageDocumentation}
                hideTriggerButton
                open={isDocumentationDrawerOpen}
                onOpenChange={setIsDocumentationDrawerOpen}
                onBackToCluster={() => {
                    setIsDocumentationDrawerOpen(false);
                    setIsRawPPRClusterOpen(true);
                }}
            />
        </>
    );

    const clusterAndDocumentationTriggers = (
        <>
            <Button
                variant="outline"
                size="sm"
                onClick={() => setIsRawPPRClusterOpen(true)}
            >
                Find cluster
            </Button>
            <Button
                variant="outline"
                size="sm"
                onClick={() => setIsDocumentationDrawerOpen(true)}
            >
                Project documentation
            </Button>
        </>
    );

    const sharedToolbarButtons = (
        <>
            <Button
                ref={rerunAnalysisButtonRef}
                onClick={handleRunAnalysis}
                disabled={isAnalyzing || !canRunAnalysis}
                className={cn(
                    "rounded-md p-2 hover:bg-muted transition-colors",
                    highlightRerunAnalysis &&
                        canRunAnalysis &&
                        !isAnalyzing &&
                        "ring-2 ring-purple-500 ring-offset-2 bg-purple-50 animate-pulse shadow-md shadow-purple-200/50"
                )}
                aria-label="Re-run analysis"
                title={
                    isAnalyzing
                        ? "Analysis in progress"
                        : highlightRerunAnalysis && canRunAnalysis
                          ? "Folder updated, re-run analysis to refresh the graph"
                          : canRunAnalysis
                            ? "Re-run analysis"
                            : "View only access"
                }
            >
                {isAnalyzing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            </Button>
            <Button onClick={toggleFullScreen} className="rounded-md p-2 hover:bg-muted transition-colors" aria-label={fullScreen ? "Exit full screen" : "Enter full screen"}>
                {fullScreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </Button>
        </>
    );

    const sharedViewButtons = (
        <div className="flex gap-2">
            <Button
                variant="ghost"
                size="sm"
                className={cn(
                    "rounded-b-none",
                    isComponentView ? "bg-muted hover:bg-muted" : "bg-white hover:bg-muted/50"
                )}
                onClick={() => setViewMode("component")}
            >
                Component view
            </Button>
            <Button
                variant="ghost"
                size="sm"
                className={cn(
                    "rounded-b-none",
                    !isComponentView ? "bg-muted hover:bg-muted" : "bg-white hover:bg-muted/50"
                )}
                onClick={() => setViewMode("all-commits")}
            >
                All components view
            </Button>
        </div>
    );

    const sharedGraphControls = (
        <div className="space-y-0">
            {sharedViewButtons}
            <div
                className={cn(
                    "space-y-3 rounded-b-lg bg-muted p-3",
                    isComponentView ? "rounded-tl-none rounded-tr-lg" : "rounded-t-lg"
                )}
            >
                <KnowledgeGraphStatsToggle
                    minimalMode={minimalMode}
                    onMinimalModeChange={setMinimalMode}
                />
                {isComponentView && (
                    <KnowledgeGraphPagerControls
                        componentCount={mergedGraphData.componentCount}
                        selectedComponentLabel={mergedGraphData.selectedComponentLabel}
                        currentComponentIndex={currentComponentIndex}
                        onPrevious={goToPreviousComponent}
                        onNext={goToNextComponent}
                    />
                )}
            </div>
        </div>
    );

    const handleCopySourceCode = async () => {
        const sourceCode = sourcePayload?.data?.sourceCode;
        if (!sourceCode) {
            toast.error("No source code to copy");
            return;
        }
        try {
            await navigator.clipboard.writeText(sourceCode);
            toast.success("Source code copied to clipboard");
        } catch (err) {
            toast.error("Failed to copy source code");
        }
    };

    if (isLoading && !isAnalyzing) {
        return (
            <Card>
            <CardHeader>
                <CardTitle className="text-2xl">Graph canvas</CardTitle>
                <CardDescription>Loading graph data</CardDescription>
            </CardHeader>
            <CardContent>
                <BackgroundProcessPanel status="active" title="Loading knowledge graph" description="Reading ts-code-graph.json produced by the desktop code analyzer" />
            </CardContent>
            </Card>
        );
    }

    if (!graph) {
        return (
            <Card>
            <CardHeader>
                <CardTitle className="text-2xl">Graph canvas</CardTitle>
                <CardDescription>
                    {isAnalyzing ? "Building knowledge graph" : "No graph file found"}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                {isAnalyzing ? (
                    <KnowledgeGraphAnalysisPreparing phase={analysisPhase} latestLog={analysisLog} active />
                ) : (
                    <>
                        <BackgroundProcessPanel status="idle" title="No knowledge graph yet" description="Scan your configured project root to build ts-code-graph.json (functions and call relationships) for this canvas" />
                        {canRunAnalysis ? (
                            <Button
                                ref={rerunAnalysisButtonRef}
                                variant="outline"
                                size="sm"
                                onClick={handleRunAnalysis}
                                disabled={
                                    isAnalyzing ||
                                    !userId ||
                                    typeof window === "undefined" ||
                                    !window.desktopControl
                                }
                                className={cn(
                                    highlightRerunAnalysis &&
                                        !isAnalyzing &&
                                        "ring-2 ring-purple-500 ring-offset-2 bg-purple-50 animate-pulse"
                                )}
                            >
                                <RefreshCw className="mr-2 size-4" />
                                Generate graph
                            </Button>
                        ) : (
                            <p className="text-xs text-muted-foreground">
                                Ask the project owner or someone with editor access to generate the graph
                            </p>
                        )}
                    </>
                )}
            </CardContent>
            </Card>
        );
    }

    return (
    <>
        {clusterAndDocumentationPanels}
        {fullScreen && <div className="fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-[2px]" onClick={toggleFullScreen} />}
        <Card
            className={cn(
                "flex flex-col transition-all duration-200",
                fullScreen ? "fixed inset-4 z-50 h-auto rounded-xl border shadow-2xl" : "h-[78vh]"
            )}
        >
        <CardHeader className={cn("shrink-0 space-y-4", fullScreen && "p-3")}>
            {!fullScreen && (
            <>
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-3">
                        <div>
                            <CardTitle className="text-2xl">Graph canvas</CardTitle>
                            <CardDescription>
                                {isComponentView
                                    ? "Function call map by connected component"
                                    : "Function call map across all commits"}
                            </CardDescription>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {clusterAndDocumentationTriggers}
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">{sharedToolbarButtons}</div>
                </div>
                {highlightRerunAnalysis && canRunAnalysis && !isAnalyzing && (
                    <BackgroundProcessPanel status="complete" title="Project folder updated" description="Use the highlighted re-run analysis button to rebuild the knowledge graph from your updated code" compact />
                )}
                {sharedGraphControls}
            </>
            )}
            {fullScreen && (
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                            {clusterAndDocumentationTriggers}
                        </div>
                        <div className="flex items-center gap-2">{sharedToolbarButtons}</div>
                    </div>
                    {sharedGraphControls}
                </div>
            )}
        </CardHeader>
        <CardContent className={cn("flex-1 min-h-0", fullScreen && "p-0")}>
            <div
                id="knowledge-graph-surface"
                className="relative h-full w-full rounded-lg border border-border bg-slate-50"
            >
                <div
                    className="absolute inset-0 h-full w-full"
                    onPointerMove={(event) => {
                        const nextPos = { x: event.clientX, y: event.clientY };
                        setPointerClientPos(nextPos);
                        if (hoveredEdgeId) {
                            setHoverClientPos(nextPos);
                        }
                    }}
                    onPointerLeave={() => {
                        setPointerClientPos(null);
                        setHoveredEdge(null);
                        setHoveredEdgeId(null);
                        setHoverClientPos(null);
                    }}
                >
                {isAnalyzing && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-50/90 p-4">
                        <div className="w-full max-w-md">
                            <KnowledgeGraphAnalysisPreparing phase={analysisPhase} latestLog={analysisLog} active />
                        </div>
                    </div>
                )}
                <GraphCanvas
                    ref={graphCanvasRef}
                    nodes={canvasGraphData.nodes}
                    edges={canvasGraphData.edges}
                    theme={lightTheme}
                    layoutType="forceDirected2d"
                    cameraMode="pan"
                    labelType="nodes"
                    renderNode={renderCustomNode}
                    onNodeClick={(node: GraphHoverNode) => {
                        const clicked = node.data;
                        if (!clicked) return;

                        if (isModuleGraphNode(clicked)) {
                            setSelectedFunction({
                                key: clicked.key,
                                name: clicked.name,
                                simpleName: clicked.simpleName ?? clicked.name,
                                kind: "module",
                                file: clicked.file.replace(/\\/g, "/"),
                                line: 0,
                            });
                            setSelectedHistoryIndex(-1);
                            setIsHistoryDrawerOpen(true);
                            return;
                        }

                        const isRemovedNode = (clicked as any).isRemoved === true;

                        let sourceNode = undefined; // for removed nodes, sourceNode doesn't exist in the main graph and matching based on the key will fail to be retrived
                        if (!isRemovedNode) {
                            sourceNode = graphNodeByKey.get(clicked.key);
                        }

                        const selectedFile = (sourceNode?.file || sourceNode?.repoRelativePath || clicked.file || "").replace(/\\/g, "/");
                        if (!selectedFile) return;

                        setSelectedFunction({
                            key: clicked.key,
                            name: sourceNode?.name || clicked.name,
                            simpleName: sourceNode?.simpleName ?? clicked.simpleName ?? clicked.name,
                            kind: sourceNode?.kind ?? clicked.kind ?? "function",
                            file: selectedFile,
                            line: sourceNode?.line || sourceNode?.startLine || clicked.line,
                            startLine: sourceNode?.startLine,
                            endLine: sourceNode?.endLine,
                        });
                        setIsHistoryDrawerOpen(true);
                    }}
                    onNodePointerOver={(node: GraphHoverNode, event: GraphPointerEvent) => {
                        const originalNode = node.data;
                        if (!originalNode) return;
                        setHoveredNode(originalNode);
                        setHoveredEdge(null);
                        setHoveredEdgeId(null);
                        const pos = getClientPosFromGraphEvent(event) ?? pointerClientPos;
                        if (pos) setHoverClientPos(pos);
                    }}
                    onNodePointerOut={() => {
                        setHoveredNode(null);
                    }}
                    onEdgePointerOver={(edge: GraphHoverEdge, event?: GraphPointerEvent) => {
                        const originalEdge = resolveHoveredEdge(edge, edgeDataById);
                        if (!originalEdge) return;
                        setHoveredEdge(originalEdge);
                        setHoveredEdgeId(typeof edge.id === "string" ? edge.id : null);
                        setHoveredNode(null);
                        const pos = getClientPosFromGraphEvent(event) ?? pointerClientPos;
                        setHoverClientPos(pos ?? pointerClientPos);
                    }}
                    onEdgePointerOut={() => {
                        setHoveredEdge(null);
                        setHoveredEdgeId(null);
                        setHoverClientPos(null);
                    }}
                />
                </div>
            </div>
        </CardContent>
        </Card>

        <KnowledgeGraphStatsSidebar
            open={!minimalMode}
            onOpenChange={(open) => setMinimalMode(!open)}
            counts={counts}
        />

        <ProjectRightPanel open={isHistoryDrawerOpen} ariaLabel="Function history">
                <div className="flex h-full min-h-0 flex-col overflow-hidden">
                <div className="space-y-1 border-b px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold leading-none tracking-tight">
                            {selectedFunction?.name || "Function history"}
                        </h2>
                        <Button variant="ghost" size="sm" className="-mr-2 shrink-0" aria-label="Close history panel" onClick={() => setIsHistoryDrawerOpen(false)} >
                            <X className="size-4" />
                        </Button>
                    </div>
                    <p
                        className="break-all text-sm text-muted-foreground"
                        title={
                            selectedFunction
                                ? `${selectedFunction.file} | ${selectedFunction.kind}`
                                : undefined
                        }
                    >
                        {selectedFunction
                            ? `${selectedFunction.file} | ${formatGraphNodeKindLabel(selectedFunction.kind)}`
                            : "Select a function node to inspect commit level source code"}
                    </p>
                </div>

                <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-3">
                    {!selectedFunction && (
                        <p className="text-sm text-muted-foreground">Select a function node from the graph to load its timeline</p>
                    )}

                    {selectedFunction && isModuleGraphNode(selectedFunction) && (
                        <div className="rounded-md border bg-muted/25 px-3 py-2 text-sm text-muted-foreground">
                            Module import anchor for <code className="font-mono text-foreground">import</code> / <code className="font-mono text-foreground">require()</code> usage edges originating from this file.
                            Commit history and function source are not available here because this node represents the file as an import boundary, not a specific function.
                        </div>
                    )}

                    {selectedFunction && !isModuleGraphNode(selectedFunction) && (
                        <>
                            {!historyQuery.isLoading && historyEntries.length > 0 && (
                                <>
                                    <div className="flex items-center gap-2">
                                        <Button variant="outline" size="sm" onClick={() => setSelectedHistoryIndex((prev) => Math.max(prev - 1, 0))} disabled={selectedHistoryIndex <= 0} >
                                            <ChevronLeft className="size-4" />
                                            Previous
                                        </Button>
                                        <Button variant="outline" size="sm" onClick={() => setSelectedHistoryIndex((prev) => Math.min(prev + 1, historyEntries.length - 1))} disabled={selectedHistoryIndex >= historyEntries.length - 1}>
                                            Next
                                            <ChevronRight className="size-4" />
                                        </Button>
                                        <span className="text-xs text-muted-foreground">
                                            {selectedHistoryIndex + 1}/{historyEntries.length}
                                        </span>
                                    </div>

                                    {selectedCommit && (
                                        <div className="rounded-md border bg-muted/25 px-3 py-2 text-xs text-muted-foreground">
                                            <p>
                                                Commit SHA: <span className="font-mono text-foreground">{selectedCommit.sha}</span>
                                            </p>
                                            <p>
                                                Change type: <span className="text-foreground">{selectedCommit.changeType}</span>
                                            </p>
                                            <p>
                                                Lines: <span className="text-foreground">{selectedSourceParams?.startLine}-{selectedSourceParams?.endLine}</span>
                                            </p>
                                        </div>
                                    )}
                                </>
                            )}
                            
                            {historyQuery.isLoading && (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <Loader2 className="size-4 animate-spin" />
                                    Loading commit history
                                </div>
                            )}

                            {!historyQuery.isLoading && historyEntries.length === 0 && (
                                <p className="text-sm text-muted-foreground">
                                    No change history found, showing current source code from the project
                                </p>
                            )}

                            <div className="flex min-h-0 flex-1 flex-col rounded-md border">
                                <div className="flex items-center justify-between border-b px-3 py-2">
                                    <span className="text-xs text-muted-foreground">
                                        {historyEntries.length > 0 ? "Source at selected commit" : "Current source code"}
                                    </span>
                                    <Button onClick={handleCopySourceCode} disabled={!sourcePayload?.data?.sourceCode} className="rounded p-1 hover:bg-muted transition-colors disabled:opacity-50" title="Copy source code" >
                                        <Copy className="size-3.5" />
                                    </Button>
                                </div>
                                <ScrollArea className="min-h-0 flex-1">
                                    <div className="p-3 pr-5">
                                        {sourceQuery.isLoading && (
                                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                <Loader2 className="size-4 animate-spin" />
                                                Loading source code
                                            </div>
                                        )}

                                        {!sourceQuery.isLoading && sourcePayload?.data?.sourceCode && (
                                            <SyntaxHighlighter
                                                language={getSourceLanguage(sourcePayload.data.file || selectedSourceParams?.file)}
                                                style={oneLight}
                                                customStyle={{
                                                    margin: 0,
                                                    padding: 0,
                                                    background: "transparent",
                                                    minWidth: "max-content",
                                                    overflow: "visible",
                                                    fontSize: "0.75rem",
                                                    lineHeight: "1.25rem",
                                                }}
                                                codeTagProps={{ style: { fontFamily: "inherit" } }}
                                                wrapLongLines={false}
                                                PreTag="div"
                                            >
                                                {sourcePayload.data.sourceCode}
                                            </SyntaxHighlighter>
                                        )}

                                        {!sourceQuery.isLoading && !sourcePayload?.data?.sourceCode && (
                                            <p className="text-sm text-muted-foreground">
                                                {sourcePayload?.message || "Source code unavailable for this selection"}
                                            </p>
                                        )}
                                    </div>
                                </ScrollArea>
                            </div>
                        </>
                    )}
                </div>
                </div>
        </ProjectRightPanel>

        {tooltipClientPos && hoveredNode &&
            createPortal(
                <div className="fixed z-60 pointer-events-none rounded-md border bg-white/95 px-3 py-2 text-xs shadow-lg max-w-sm" style={{ left: tooltipClientPos.x + 10, top: tooltipClientPos.y + 10 }}>
                <div className="font-semibold text-slate-900">{hoveredNode.name}</div>
                <div className="text-slate-600">{formatGraphNodeKindLabel(hoveredNode.kind)}</div>
                <div className="text-slate-600">{hoveredNode.file}{hoveredNode.line > 0 ? `:${hoveredNode.line}` : ""}</div>
                </div>,
                document.body
            )
        }
        {tooltipClientPos && hoveredEdge &&
            createPortal(
                <div className="fixed z-60 pointer-events-none rounded-md border bg-white/95 px-3 py-2 text-xs shadow-lg max-w-sm" style={{ left: tooltipClientPos.x + 10, top: tooltipClientPos.y + 10 }}>
                <div className="font-semibold text-slate-900">{formatEdgeRelation(hoveredEdge, nodeById)}</div>
                <div className="text-slate-600">{getEdgeLabel(hoveredEdge)}</div>
                <div className="text-slate-600">{formatGraphEdgeRelation(hoveredEdge)}</div>
                {hoveredEdge.label ? <div className="text-slate-500">Label: {hoveredEdge.label}</div> : null}
                {formatEdgeLocation(hoveredEdge) ? <div className="text-slate-500">At {formatEdgeLocation(hoveredEdge)}</div> : null}
                </div>,
                document.body
            )
        }
    </>
    );
}