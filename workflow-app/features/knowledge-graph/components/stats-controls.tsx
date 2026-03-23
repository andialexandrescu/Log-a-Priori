"use client";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

type GraphCounts = {
    nodes: number;
    edges: number;
    callEdges: number;
    inFileEdges: number;
    crossFileEdges: number;
    roots: number;
    files: number;
};

type KnowledgeGraphStatsControlsProps = {
    minimalMode: boolean;
    onMinimalModeChange: (minimalMode: boolean) => void;
    counts: GraphCounts;
};

export function KnowledgeGraphStatsControls({ minimalMode, onMinimalModeChange, counts }: KnowledgeGraphStatsControlsProps) {
    return (
    <>
        <div className="flex items-center gap-2">
        <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Show stats</span>
            <Switch checked={!minimalMode} onCheckedChange={(checked) => onMinimalModeChange(!checked)}/>
        </div>
        </div>
        {!minimalMode && (
            <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">Functions {counts.nodes}</Badge>
                <Badge variant="outline">Edges {counts.edges}</Badge>
                <Badge variant="outline">Calls {counts.callEdges}</Badge>
                <Badge variant="outline">In-file {counts.inFileEdges}</Badge>
                <Badge variant="outline">Cross-file {counts.crossFileEdges}</Badge>
                <Badge variant="outline">Roots {counts.roots}</Badge>
                <Badge variant="outline">Files {counts.files}</Badge>
            </div>
        )}
    </>
    );
}
