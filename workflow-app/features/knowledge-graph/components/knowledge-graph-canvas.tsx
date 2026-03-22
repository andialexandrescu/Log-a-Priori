"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Maximize2, Minimize2 } from "lucide-react";
import { GraphCanvas, lightTheme } from "reagraph";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useGetCodeGraph } from "../api/use-get-code-graph";
import { KnowledgeGraphStatsControls } from "./stats-controls";
import { KnowledgeGraphPagerControls } from "./pager-controls";
import { Button } from "@/components/ui/button";

type FunctionNode = {
    key: string;
    name: string;
    file: string;
    line: number;
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
    if (edge.kind === "USES") return "USES";
    if (edge.scope === "cross-file") return "CROSS-FILE CALL";
    return "IN-FILE CALL";
}

function getEdgeStyle(edge: FunctionEdge) {
    if (edge.kind === "USES") {
        return {
            fill: "#a855f7",
            dashed: true,
            dashArray: [3, 3] as [number, number],
            interpolation: "curved" as const,
        };
    }

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

export function KnowledgeGraphCanvas({ projectId }: { projectId: string }) {
    const { data, isLoading } = useGetCodeGraph(projectId);
    const [search, setSearch] = useState("");
    const [currentComponentIndex, setCurrentComponentIndex] = useState(0);
    const [fullScreen, setFullScreen] = useState(false);
    const [minimalMode, setMinimalMode] = useState(true);
    const [hoveredNode, setHoveredNode] = useState<FunctionNode | null>(null);
    const [hoveredEdge, setHoveredEdge] = useState<FunctionEdge | null>(null);
    const [hoverClientPos, setHoverClientPos] = useState<{ x: number; y: number } | null>(null);

    const graph = data?.data?.graph;
    const visualization = data?.data?.visualization;

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

    const { graphData, componentCount, selectedComponentLabel } = useMemo(() => { // prepare data for reagraph
        const rawNodes = (visualization?.functionNodes ?? []) as FunctionNode[];
        const rawCallInFileEdges = (visualization?.edges?.calls?.inFile ?? []) as FunctionEdge[];
        const rawCallCrossFileEdges = (visualization?.edges?.calls?.crossFile ?? []) as FunctionEdge[];
        const rawUsesInFileEdges = (visualization?.edges?.uses?.inFile ?? []) as FunctionEdge[];
        const rawUsesCrossFileEdges = (visualization?.edges?.uses?.crossFile ?? []) as FunctionEdge[];
        const rawComponents = (visualization?.components ?? []) as string[][];

        const componentList = rawComponents.length > 0 ? rawComponents : [rawNodes.map((n) => n.key)];
        const clampedIndex = Math.max(0, Math.min(currentComponentIndex, componentList.length - 1));
        const selectedComponentKeys = componentList[clampedIndex] ?? [];
        const selectedKeySet = new Set(selectedComponentKeys);

        const componentNodes = rawNodes.filter((node) => selectedKeySet.has(node.key));
        const visibleNodes = componentNodes.filter((node) => isVisibleFunction(node, search));
        const visibleKeySet = new Set(visibleNodes.map((node) => node.key));

        const allEdges = [ // combine edges
            ...rawCallInFileEdges,
            ...rawCallCrossFileEdges,
            ...rawUsesInFileEdges,
            ...rawUsesCrossFileEdges,
        ];
        const visibleEdges = allEdges.filter(
            (edge) => visibleKeySet.has(edge.from) && visibleKeySet.has(edge.to) // filter by visible nodes
        );

        const nodes = visibleNodes.map((node) => ({ // convert to reagraph format
            id: node.key,
            label: node.name,
            data: node,
        }));

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
    }, [search, visualization, currentComponentIndex]);

    const counts = useMemo(() => { // counts are used for stats controls
        const nodes = graphData.nodes.length;
        const edges = graphData.edges.length;
        const callEdges = graphData.edges.filter((e) => {
            const edge = e.data as FunctionEdge | undefined;
            return edge?.kind === "CALLS";
        }).length;
        const usesEdges = graphData.edges.filter((e) => {
            const edge = e.data as FunctionEdge | undefined;
            return edge?.kind === "USES";
        }).length;
        const inFileEdges = graphData.edges.filter((e) => {
            const edge = e.data as FunctionEdge | undefined;
            return edge?.scope !== "cross-file";
        }).length;
        const crossFileEdges = graphData.edges.filter((e) => {
            const edge = e.data as FunctionEdge | undefined;
            return edge?.scope === "cross-file";
        }).length;
        const roots = graphData.nodes.filter((node) =>
            !graphData.edges.some((e) => e.target === node.id)
        ).length;
        const files = new Set(graphData.nodes.map((n) => n.data.file)).size;
        return { nodes, edges, callEdges, usesEdges, inFileEdges, crossFileEdges, roots, files };
    }, [graphData]);

    const nodeById = useMemo(() => {
        return new Map(graphData.nodes.map((node) => [node.id, node.data as FunctionNode]));
    }, [graphData.nodes]);

    const goToPreviousComponent = () => setCurrentComponentIndex((prev) => Math.max(0, prev - 1));
    const goToNextComponent = () => setCurrentComponentIndex((prev) => Math.min(componentCount - 1, prev + 1));
    const toggleFullScreen = () => setFullScreen((prev) => !prev);

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
            <CardContent className="space-y-2 text-sm text-muted-foreground">
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
                            Function call map
                        </CardDescription>
                    </div>
                    <Button onClick={toggleFullScreen} className="rounded-md p-2 hover:bg-muted transition-colors" aria-label={fullScreen ? "Exit full screen" : "Enter full screen"}>
                        {fullScreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                    </Button>
                </div>
                <KnowledgeGraphStatsControls minimalMode={minimalMode} onMinimalModeChange={setMinimalMode} counts={counts}/>
                <KnowledgeGraphPagerControls currentComponentIndex={currentComponentIndex} componentCount={componentCount} selectedComponentLabel={selectedComponentLabel} onPrevious={goToPreviousComponent} onNext={goToNextComponent}/>
            </>
            )}
            {fullScreen && (
                <div className="space-y-3">
                    <div className="flex items-center justify-end">
                        <Button  onClick={toggleFullScreen} className="rounded-md p-2 hover:bg-muted transition-colors" aria-label={fullScreen ? "Exit full screen" : "Enter full screen"}>
                            {fullScreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                        </Button>
                    </div>
                    <KnowledgeGraphStatsControls minimalMode={minimalMode} onMinimalModeChange={setMinimalMode} counts={counts}/>
                    <KnowledgeGraphPagerControls currentComponentIndex={currentComponentIndex} componentCount={componentCount} selectedComponentLabel={selectedComponentLabel} onPrevious={goToPreviousComponent} onNext={goToNextComponent}/>
                </div>
            )}
        </CardHeader>
        <CardContent className={cn("flex-1 min-h-0", fullScreen && "p-0")}>
            <div className="relative h-full w-full rounded-lg border border-border bg-slate-50">
                <GraphCanvas nodes={graphData.nodes} edges={graphData.edges} theme={lightTheme}
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