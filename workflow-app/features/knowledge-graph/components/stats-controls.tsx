"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ProjectRightPanel } from "@/features/projects/components/project-right-panel";
import type { GraphEdgeStats } from "@/features/knowledge-graph/lib/graph-edge-details";
import { X } from "lucide-react";

export type GraphCounts = {
    nodes: number;
    functionNodes: number;
    methodNodes: number;
    lambdaNodes: number;
    moduleNodes: number;
    roots: number;
    files: number;
} & GraphEdgeStats;

type KnowledgeGraphStatsToggleProps = {
    minimalMode: boolean;
    onMinimalModeChange: (minimalMode: boolean) => void;
};

type KnowledgeGraphStatsPanelProps = {
    counts: GraphCounts;
};

function StatCell({ value, emphasized = false }: { value: number; emphasized?: boolean }) {
    return (
        <td className={`px-2 py-1 text-right tabular-nums ${emphasized ? "font-medium text-foreground" : "text-muted-foreground"}`}>
            {value}
        </td>
    );
}

function EdgeBreakdownTable({ counts }: { counts: GraphCounts }) {
    const callEdges = counts.callsInFile + counts.callsCrossFile;
    const usesEdges = counts.usesInFile + counts.usesCrossFile;
    const inFileEdges = counts.callsInFile + counts.usesInFile;
    const crossFileEdges = counts.callsCrossFile + counts.usesCrossFile;

    return (
        <div className="overflow-x-auto rounded-md border bg-background">
            <table className="w-full min-w-[280px] text-xs">
                <thead>
                    <tr className="border-b bg-muted/40 text-left text-muted-foreground">
                        <th className="px-2 py-1.5 font-medium">Kind</th>
                        <th className="px-2 py-1.5 text-right font-medium">In-file</th>
                        <th className="px-2 py-1.5 text-right font-medium">Cross-file</th>
                        <th className="px-2 py-1.5 text-right font-medium">Total</th>
                    </tr>
                </thead>
                <tbody>
                    <tr className="border-b">
                        <td className="px-2 py-1">
                            <span className="font-medium text-foreground">CALLS</span>
                            <span className="ml-1 text-muted-foreground">invocations</span>
                        </td>
                        <StatCell value={counts.callsInFile} />
                        <StatCell value={counts.callsCrossFile} />
                        <StatCell value={callEdges} emphasized />
                    </tr>
                    <tr className="border-b">
                        <td className="px-2 py-1">
                            <span className="font-medium text-foreground">USES</span>
                            <span className="ml-1 text-muted-foreground">references</span>
                        </td>
                        <StatCell value={counts.usesInFile} />
                        <StatCell value={counts.usesCrossFile} />
                        <StatCell value={usesEdges} emphasized />
                    </tr>
                    <tr className="bg-muted/20">
                        <td className="px-2 py-1 font-medium text-foreground">Total</td>
                        <StatCell value={inFileEdges} emphasized />
                        <StatCell value={crossFileEdges} emphasized />
                        <StatCell value={counts.edges} emphasized />
                    </tr>
                </tbody>
            </table>
        </div>
    );
}

export function KnowledgeGraphStatsToggle({ minimalMode, onMinimalModeChange }: KnowledgeGraphStatsToggleProps) {
    return (
        <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Show stats</span>
            <Switch checked={!minimalMode} onCheckedChange={(checked) => onMinimalModeChange(!checked)} />
        </div>
    );
}

export function KnowledgeGraphStatsPanel({ counts }: KnowledgeGraphStatsPanelProps) {
    return (
        <div className="space-y-4">
            <section className="space-y-1.5">
                <h4 className="text-xs font-medium text-muted-foreground">Nodes</h4>
                <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="outline">Total {counts.nodes}</Badge>
                    <Badge variant="outline">Functions {counts.functionNodes}</Badge>
                    <Badge variant="outline">Methods {counts.methodNodes}</Badge>
                    <Badge variant="outline">Lambdas {counts.lambdaNodes}</Badge>
                    <Badge variant="outline">Modules {counts.moduleNodes}</Badge>
                    <Badge variant="outline">Files {counts.files}</Badge>
                    <Badge variant="outline">Roots {counts.roots}</Badge>
                </div>
            </section>

            <section className="space-y-1.5">
                <div>
                    <h4 className="text-xs font-medium text-muted-foreground">Edges ({counts.edges})</h4>
                </div>
                <EdgeBreakdownTable counts={counts} />
            </section>

            <section className="space-y-1.5">
                <div>
                    <h4 className="text-xs font-medium text-muted-foreground">Other categories</h4>
                    <p className="text-[11px] text-muted-foreground">
                        Not included in the edge total above
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant="secondary">Direct call {counts.callDirect}</Badge>
                    <Badge variant="secondary">JSX component {counts.jsxComponent}</Badge>
                    <Badge variant="secondary">Reference {counts.reference}</Badge>
                    <Badge variant="secondary">Module import {counts.moduleImport}</Badge>
                </div>
            </section>
        </div>
    );
}

type KnowledgeGraphStatsSidebarProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    counts: GraphCounts;
};

export function KnowledgeGraphStatsSidebar({ open, onOpenChange, counts }: KnowledgeGraphStatsSidebarProps) {
    return (
        <ProjectRightPanel open={open} ariaLabel="Graph stats">
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
                <div className="space-y-1 border-b px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                        <h2 className="min-w-0 flex-1 text-lg font-semibold leading-none tracking-tight">
                            Graph stats
                        </h2>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="-mr-2 shrink-0"
                            aria-label="Close stats panel"
                            onClick={() => onOpenChange(false)}
                        >
                            <X className="size-4" />
                        </Button>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Node and edge breakdown for the current graph view
                    </p>
                </div>

                <div className="px-4 pb-4 pt-3">
                    <KnowledgeGraphStatsPanel counts={counts} />
                </div>
            </div>
        </ProjectRightPanel>
    );
}