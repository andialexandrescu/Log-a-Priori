"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, Loader2, Maximize2, Minimize2, RefreshCw } from "lucide-react";
import { GraphCanvas, lightTheme } from "reagraph";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useGetCodeGraph } from "../api/use-get-code-graph";
import { KnowledgeGraphStatsControls } from "./stats-controls";
import { KnowledgeGraphPagerControls } from "./pager-controls";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useGetFunctionHistory, type FunctionHistoryEntry } from "../api/use-get-function-history";
import { useGetFunctionSource } from "../api/use-get-function-source";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { useGetRemovedGraph } from "../api/use-get-removed-graph";

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
};

type GraphHoverNode = {
    data?: FunctionNode;
};

type GraphHoverEdge = {
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

function getClientPosFromGraphEvent(event: unknown): { x: number; y: number } | null {
    const e = event as {
        clientX?: number;
        clientY?: number;
        pointer?: { clientX?: number; clientY?: number };
        nativeEvent?: { clientX?: number; clientY?: number };
    };

    const clientX = e?.clientX ?? e?.pointer?.clientX ?? e?.nativeEvent?.clientX;
    const clientY = e?.clientY ?? e?.pointer?.clientY ?? e?.nativeEvent?.clientY;

    if (typeof clientX === "number" && typeof clientY === "number") {
        return { x: clientX, y: clientY };
    }

    return null;
}

function getEdgeLabel(edge: FunctionEdge) {
    if (edge.scope === "cross-file") return "CROSS-FILE CALL";
    return "IN-FILE CALL";
}

function getEdgeStyle(edge: FunctionEdge) {
    if (edge.scope === "cross-file") {
        return {
            fill: "#1e293b",
            dashed: true,
            dashArray: [5, 4] as [number, number],
            interpolation: "curved" as const,
        };
    }

    return {
        fill: "#1e293b",
        dashed: false,
        interpolation: "linear" as const,
    };
}

function formatEdgeRelation(edge: FunctionEdge, nodeById: Map<string, FunctionNode>) {
    const fromNode = nodeById.get(edge.from);
    const toNode = nodeById.get(edge.to);
    const fromLabel = fromNode ? `${fromNode.name} [${fromNode.file}]` : edge.from;
    const toLabel = toNode ? `${toNode.name} [${toNode.file}]` : edge.to;
    return `${fromLabel} -> ${toLabel}`;
}

function isVisibleFunction(node: FunctionNode, searchText: string): boolean {
    if (!searchText) return true;
    const q = searchText.toLowerCase();
    return `${node.name} ${node.file}`.toLowerCase().includes(q);
}

function getNodeStyle(node: FunctionNode, commitHistory?: FunctionHistoryEntry[]) {
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

export function KnowledgeGraphCanvas({ projectId }: { projectId: string }) {
    const { data, isLoading } = useGetCodeGraph(projectId);
    const queryClient = useQueryClient();
    const { data: removedData, isLoading: removedLoading } = useGetRemovedGraph(projectId);
    const [search, setSearch] = useState("");
    const [currentComponentIndex, setCurrentComponentIndex] = useState(0);
    const [viewMode, setViewMode] = useState<GraphViewMode>("component");
    const [fullScreen, setFullScreen] = useState(false);
    const [minimalMode, setMinimalMode] = useState(true);
    const [hoveredNode, setHoveredNode] = useState<FunctionNode | null>(null);
    const [hoveredEdge, setHoveredEdge] = useState<FunctionEdge | null>(null);
    const [hoverClientPos, setHoverClientPos] = useState<{ x: number; y: number } | null>(null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [selectedFunction, setSelectedFunction] = useState<SelectedFunctionNode | null>(null);
    const [isHistoryDrawerOpen, setIsHistoryDrawerOpen] = useState(false);
    const [selectedHistoryIndex, setSelectedHistoryIndex] = useState(-1);

    const renderCustomNode = ({ id, color, size, opacity, node }: any) => { // used for rendering a custom node that changes color on hover since the default turquoise one might get mistaken for a green added node
        const displayColor = hoveredNode?.key === id ? '#a855f7' : color; // purple
        
        return (
            <group onPointerOver={() => {
                const originalNode = mergedGraphData.graphData.nodes.find(n => n.id === id)?.data;
                if (originalNode) setHoveredNode(originalNode);
            }}
            onPointerOut={() => setHoveredNode(null)}>
                <mesh>
                    <sphereGeometry args={[size, 32, 32]} />
                    <meshBasicMaterial color={displayColor} opacity={opacity} transparent />
                </mesh>
            </group>
        );
    };

    const handleRunAnalysis = async () => {
        if (typeof window === "undefined" || !window.desktopControl || !projectId) return;
        setIsAnalyzing(true);
        try {
            const result = await window.desktopControl.runKnowledgeGraphAnalysis(projectId);
            if (result.ok) {
                await queryClient.refetchQueries({ queryKey: ["projects", projectId, "knowledge-graph"], exact: true });
            }
        } finally {
            setIsAnalyzing(false);
        }
    };

    const codeGraphPayload = data as CodeGraphPayload | undefined;
    const graph = codeGraphPayload?.data?.graph;
    const visualization = codeGraphPayload?.data?.visualization;

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
        selectedFunction
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
        if (!selectedFunction) {
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
        const rawNodes = (visualization?.functionNodes ?? []) as FunctionNode[];
        const rawCallInFileEdges = (visualization?.edges?.calls?.inFile ?? []) as FunctionEdge[];
        const rawCallCrossFileEdges = (visualization?.edges?.calls?.crossFile ?? []) as FunctionEdge[];
        const rawComponents = (visualization?.components ?? []) as string[][];

        const componentList = rawComponents.length > 0 ? rawComponents : [rawNodes.map((n) => n.key)];
        const clampedIndex = Math.max(0, Math.min(currentComponentIndex, componentList.length - 1));
        const selectedComponentKeys = componentList[clampedIndex] ?? [];
        const selectedKeySet = viewMode === "all-commits"
            ? new Set(rawNodes.map((node) => node.key))
            : new Set(selectedComponentKeys);

        const scopedNodes = rawNodes.filter((node) => selectedKeySet.has(node.key));
        const visibleNodes = scopedNodes.filter((node) => isVisibleFunction(node, search));
        const visibleKeySet = new Set(visibleNodes.map((node) => node.key));

        const allEdges = [ // combine edges
            ...rawCallInFileEdges,
            ...rawCallCrossFileEdges,
        ];
        const visibleEdges = allEdges.filter(
            (edge) => visibleKeySet.has(edge.from) && visibleKeySet.has(edge.to) // filter by visible nodes
        );

        const nodes = visibleNodes.map((node) => { // convert to reagraph format
            const nodeStyle = getNodeStyle(node, node.commitHistory); // applying the custom node hover color
            return {
                id: node.key,
                label: node.name,
                data: node,
                ...nodeStyle,
            };
        });

        const edges = visibleEdges.map((edge, idx) => ({
            id: `${edge.from}-${edge.to}-${idx}`,
            source: edge.from,
            target: edge.to,
            label: getEdgeLabel(edge),
            data: edge,
            ...getEdgeStyle(edge),
        }));

        return {
            graphData: { nodes, edges },
            componentCount: componentList.length,
            selectedComponentLabel: `${clampedIndex + 1}/${Math.max(componentList.length, 1)}`,
        };
    }, [search, visualization, currentComponentIndex, viewMode]);

    const { graphData, componentCount, selectedComponentLabel } = graphDataResult;

    const mergedGraphData = useMemo((): GraphDataResult => {
        const removed = removedData?.data;
        
        if (!removed || !removed.visualization?.functionNodes) {
            return { graphData, componentCount, selectedComponentLabel };
        }
        
        const existingKeys = new Set(graphData.nodes.map(n => n.id)); // existing node keys to avoid duplicates
        const newRemovedNodes = removed.visualization.functionNodes
            .filter(node => !existingKeys.has(node.key)) // filtering removed nodes that aren't already in the main graph
            .map(node => ({
                id: node.key,
                label: node.name,
                data: {
                    ...node,
                    isRemoved: true,
                    commitHistory: node.commitHistory,
                },
                fill: "#fca5a5",
                strokeWidth: 2,
                stroke: "#ef4444",
            }));
        
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
    }, [graphData, removedData]);

    const counts = useMemo(() => { // counts are used for stats controls
        const nodes = mergedGraphData.graphData.nodes.length;
        const edges = mergedGraphData.graphData.edges.length;
        const callEdges = mergedGraphData.graphData.edges.filter((e) => {
            const edge = e.data as FunctionEdge | undefined;
            return edge?.kind === "CALLS";
        }).length;
        const usesEdges = mergedGraphData.graphData.edges.filter((e) => {
            const edge = e.data as FunctionEdge | undefined;
            return edge?.kind === "USES";
        }).length;
        const inFileEdges = mergedGraphData.graphData.edges.filter((e) => {
            const edge = e.data as FunctionEdge | undefined;
            return edge?.scope !== "cross-file";
        }).length;
        const crossFileEdges = mergedGraphData.graphData.edges.filter((e) => {
            const edge = e.data as FunctionEdge | undefined;
            return edge?.scope === "cross-file";
        }).length;
        const roots = mergedGraphData.graphData.nodes.filter((node) =>
            !mergedGraphData.graphData.edges.some((e) => e.target === node.id)
        ).length;
        const files = new Set(mergedGraphData.graphData.nodes.map((n) => n.data.file)).size;
        return { nodes, edges, callEdges, usesEdges, inFileEdges, crossFileEdges, roots, files };
    }, [mergedGraphData]);

    const nodeById = useMemo(() => {
        return new Map(mergedGraphData.graphData.nodes.map((node) => [node.id, node.data as FunctionNode]));
    }, [mergedGraphData.graphData.nodes]);

    const goToPreviousComponent = () => setCurrentComponentIndex((prev) => Math.max(0, prev - 1));
    const goToNextComponent = () => setCurrentComponentIndex((prev) => Math.min(componentCount - 1, prev + 1));
    const toggleFullScreen = () => setFullScreen((prev) => !prev);
    const isComponentView = viewMode === "component";

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

    if (isLoading) {
        return (
            <Card>
            <CardHeader>
                <CardTitle className="text-2xl">Graph canvas</CardTitle>
                <CardDescription>Loading graph data</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Building visualization
            </CardContent>
            </Card>
        );
    }

    if (!graph) {
        return (
            <Card>
            <CardHeader>
                <CardTitle className="text-2xl">Graph canvas</CardTitle>
                <CardDescription>No graph file found</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
                <p>Run the extractor first to generate analysis/ts-code-graph.json</p>
            </CardContent>
            </Card>
        );
    }

    return (
    <>
        {fullScreen && <div className="fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-[2px]" onClick={toggleFullScreen} />}
        <Card
            className={cn(
                "flex flex-col transition-all duration-200",
                fullScreen ? "fixed inset-4 z-50 h-auto rounded-xl border shadow-2xl" : "h-[78vh]"
            )}
        >
        <CardHeader className={cn("space-y-4", fullScreen && "p-3")}>
            {!fullScreen && (
            <>
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <CardTitle className="text-2xl">Graph canvas</CardTitle>
                        <CardDescription>
                            {isComponentView ? "Function call map by connected component" : "Function call map across all commits"}
                        </CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button onClick={handleRunAnalysis} disabled={isAnalyzing} className="rounded-md p-2 hover:bg-muted transition-colors" aria-label="Refresh analysis" title="Re-run analysis">
                            {isAnalyzing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                        </Button>
                        <Button onClick={toggleFullScreen} className="rounded-md p-2 hover:bg-muted transition-colors" aria-label={fullScreen ? "Exit full screen" : "Enter full screen"}>
                            {fullScreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                        </Button>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant={isComponentView ? "default" : "outline"} size="sm" onClick={() => setViewMode("component")}>
                        Component View
                    </Button>
                    <Button variant={!isComponentView ? "default" : "outline"} size="sm" onClick={() => setViewMode("all-commits")}>
                        All Commits View
                    </Button>
                </div>
                <KnowledgeGraphStatsControls minimalMode={minimalMode} onMinimalModeChange={setMinimalMode} counts={counts} projectId={projectId}/>
                {isComponentView && (
                    <KnowledgeGraphPagerControls componentCount={mergedGraphData.componentCount} selectedComponentLabel={mergedGraphData.selectedComponentLabel}  currentComponentIndex={currentComponentIndex} onPrevious={goToPreviousComponent} onNext={goToNextComponent}/>
                )}
            </>
            )}
            {fullScreen && (
                <div className="space-y-3">
                    <div className="flex items-center justify-end gap-2">
                        <Button onClick={handleRunAnalysis} disabled={isAnalyzing} className="rounded-md p-2 hover:bg-muted transition-colors" aria-label="Refresh analysis" title="Re-run analysis">
                            {isAnalyzing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
                        </Button>
                        <Button  onClick={toggleFullScreen} className="rounded-md p-2 hover:bg-muted transition-colors" aria-label={fullScreen ? "Exit full screen" : "Enter full screen"}>
                            {fullScreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                        </Button>
                    </div>
                    <div className="flex items-center gap-2">
                        <Button variant={isComponentView ? "default" : "outline"} size="sm" onClick={() => setViewMode("component")}>
                            Component View
                        </Button>
                        <Button variant={!isComponentView ? "default" : "outline"} size="sm" onClick={() => setViewMode("all-commits")}>
                            All Commits View
                        </Button>
                    </div>
                    <KnowledgeGraphStatsControls minimalMode={minimalMode} onMinimalModeChange={setMinimalMode} counts={counts} projectId={projectId}/>
                    {isComponentView && (
                        <KnowledgeGraphPagerControls currentComponentIndex={currentComponentIndex} componentCount={componentCount} selectedComponentLabel={selectedComponentLabel} onPrevious={goToPreviousComponent} onNext={goToNextComponent}/>
                    )}
                </div>
            )}
        </CardHeader>
        <CardContent className={cn("flex-1 min-h-0", fullScreen && "p-0")}>
            <div className="relative h-full w-full rounded-lg border border-border bg-slate-50">
                <GraphCanvas nodes={mergedGraphData.graphData.nodes} edges={mergedGraphData.graphData.edges} theme={lightTheme} renderNode={renderCustomNode}
                    onNodeClick={(node: GraphHoverNode) => {
                        const clicked = node.data;
                        if (!clicked) return;

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
                        const pos = getClientPosFromGraphEvent(event);
                        if (pos) setHoverClientPos(pos);
                    }}
                    onNodePointerOut={() => {
                        setHoveredNode(null);
                        setHoverClientPos(null);
                    }}
                    onEdgePointerOver={(edge: GraphHoverEdge, event?: GraphPointerEvent) => {
                        const originalEdge = edge.data;
                        if (!originalEdge) return;
                        setHoveredEdge(originalEdge);
                        setHoveredNode(null);
                        const pos = getClientPosFromGraphEvent(event);
                        if (pos) setHoverClientPos(pos);
                    }}
                    onEdgePointerOut={() => {
                        setHoveredEdge(null);
                        setHoverClientPos(null);
                    }}
                />
            </div>
        </CardContent>
        </Card>

        <Drawer open={isHistoryDrawerOpen} onOpenChange={setIsHistoryDrawerOpen} direction="right">
            <DrawerContent className="sm:max-w-xl">
                <DrawerHeader>
                    <DrawerTitle>{selectedFunction?.name || "Function history"}</DrawerTitle>
                    <DrawerDescription>
                        {selectedFunction
                            ? `${selectedFunction.file} | ${selectedFunction.kind}`
                            : "Select a function node to inspect commit level source code"}
                    </DrawerDescription>
                </DrawerHeader>

                <div className="flex h-full min-h-0 flex-1 flex-col gap-3 px-4 pb-4">
                    {!selectedFunction && (
                        <p className="text-sm text-muted-foreground">Select a function node from the graph to load its timeline</p>
                    )}

                    {selectedFunction && (
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
                                <ScrollArea className="h-[55vh]">
                                    <div className="p-3">
                                        {sourceQuery.isLoading && (
                                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                                <Loader2 className="size-4 animate-spin" />
                                                Loading source code
                                            </div>
                                        )}

                                        {!sourceQuery.isLoading && sourcePayload?.data?.sourceCode && (
                                            <pre className="overflow-x-auto whitespace-pre text-xs leading-5 font-mono">
                                                {sourcePayload.data.sourceCode}
                                            </pre>
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
            </DrawerContent>
        </Drawer>

        {hoverClientPos && hoveredNode &&
            createPortal(
                <div className="fixed z-60 pointer-events-none rounded-md border bg-white/95 px-3 py-2 text-xs shadow-lg" style={{ left: hoverClientPos.x + 10, top: hoverClientPos.y + 10 }}>
                <div className="font-semibold text-slate-900">{hoveredNode.name}</div>
                <div className="text-slate-600">{hoveredNode.file}:{hoveredNode.line}</div>
                </div>,
                document.body
            )
        }
        {hoverClientPos && hoveredEdge &&
            createPortal(
                <div className="fixed z-60 pointer-events-none rounded-md border bg-white/95 px-3 py-2 text-xs shadow-lg" style={{ left: hoverClientPos.x + 10, top: hoverClientPos.y + 10 }}>
                <div className="font-semibold text-slate-900">{formatEdgeRelation(hoveredEdge, nodeById)}</div>
                <div className="text-slate-600">{getEdgeLabel(hoveredEdge)}</div>
                </div>,
                document.body
            )
        }
    </>
    );
}