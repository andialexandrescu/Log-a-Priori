"use client";

import { useState, useEffect } from "react";
import { Search, X, Copy, Download, History } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { toast } from "sonner";
import { useGetClustering, type ClusteringResult } from "../api/use-get-clustering";

type ClusterInspectorProps = {
  projectId: string;
  isOpen: boolean;
  onClose: () => void;
  onNodeClick?: (nodeId: string) => void;
  onClusterUpdate?: (nodeIds: string[]) => void;
};

const QUERY_HISTORY_KEY = "dgi-clustering-history";
const MAX_HISTORY = 10;

type HistoryEntry = {
  query: string;
  type: "query" | "node";
  timestamp: number;
};

export function ClusterInspector({ projectId, isOpen, onClose, onNodeClick, onClusterUpdate }: ClusterInspectorProps) {
  const [queryMode, setQueryMode] = useState<"query" | "node">("query");
  const [input, setInput] = useState("");
  const [clustering, setClustering] = useState<ClusteringResult | null>(null);
  const [topKDGI, setTopKDGI] = useState(10);
  const [simThreshold, setSimThreshold] = useState(0.7);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // loading history from localStorage on mount
  useEffect(() => {
    if (isOpen) {
      const stored = localStorage.getItem(QUERY_HISTORY_KEY);
      if (stored) {
        try {
          setHistory(JSON.parse(stored));
        } catch {
          setHistory([]);
        }
      }
    }
  }, [isOpen]);

  const { data, isLoading, error } = useGetClustering(
    projectId,
    queryMode === "query"
      ? { query: input, topKDGI, simThreshold }
      : { nodeId: input, topKDGI, simThreshold },
    { enabled: !!input && isOpen }
  );

  // updating clustering when data changes
  if (data && data !== clustering) {
    setClustering(data);
    // notify canvas about cluster nodes
    onClusterUpdate?.(data.clusterNodeIds);
  }

  const saveToHistory = (q: string) => {
    if (!q.trim()) return;

    const newEntry: HistoryEntry = {
      query: q,
      type: queryMode,
      timestamp: Date.now(),
    };

    const updated = [newEntry, ...history.filter(h => h.query !== q)].slice(0, MAX_HISTORY);
    setHistory(updated);
    localStorage.setItem(QUERY_HISTORY_KEY, JSON.stringify(updated));
  };

  const handleSearch = () => {
    if (!input.trim()) {
      toast.error("Please enter a search term");
      return;
    }
    saveToHistory(input);
  };

  const handleHistorySelect = (entry: HistoryEntry) => {
    setQueryMode(entry.type);
    setInput(entry.query);
    setShowHistory(false);
  };

  const handleClearHistory = () => {
    setHistory([]);
    localStorage.removeItem(QUERY_HISTORY_KEY);
    toast.success("History cleared");
  };

  const handleExportCluster = () => {
    if (!clustering) return;

    const exportData = {
      seedNode: {
        id: clustering.seedNodeId,
        name: clustering.seedNodeName,
      },
      clusterMembers: clustering.clusterNodeIds.map((id, idx) => ({
        id,
        name: clustering.clusterNodeNames[idx],
      })),
      statistics: {
        clusterSize: clustering.clusterSize,
        semanticScore: clustering.semanticScore,
      },
      parameters: {
        topKDGI: clustering.metadata.topKDGI,
        simThreshold: clustering.metadata.simThreshold,
      },
      exportedAt: new Date().toISOString(),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cluster_${clustering.seedNodeId}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Cluster exported");
  };

  const handleCopyNodeIds = () => {
    if (!clustering) return;
    const nodeIds = clustering.clusterNodeIds.join("\n");
    navigator.clipboard.writeText(nodeIds);
    toast.success("Node ids copied to clipboard");
  };

  return (
    <Drawer open={isOpen} onOpenChange={onClose}>
      <DrawerContent className="h-[90vh] max-h-[90vh]">
        <DrawerHeader>
          <DrawerTitle>DGI cluster inspector</DrawerTitle>
          <DrawerDescription>
            Query or select a node to find related clusters using the finetuned DGI model
          </DrawerDescription>
        </DrawerHeader>

        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b space-y-3 bg-muted/50">
            <div className="flex gap-2">
              <Button
                variant={queryMode === "query" ? "default" : "outline"}
                size="sm"
                onClick={() => setQueryMode("query")}
              >
                Query
              </Button>
              <Button
                variant={queryMode === "node" ? "default" : "outline"}
                size="sm"
                onClick={() => setQueryMode("node")}
              >
                Node id
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowHistory(!showHistory)}
                className="ml-auto gap-1"
              >
                <History className="w-4 h-4" />
                History
              </Button>
            </div>

            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Input
                  placeholder={
                    queryMode === "query"
                      ? "e.g., 'authenticate user'"
                      : "e.g., 'node_123' or 'function_id'"
                  }
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSearch();
                  }}
                />
                {showHistory && history.length > 0 && (
                  <div className="absolute top-full left-0 right-0 mt-1 border bg-background rounded-md shadow-lg z-50 max-h-40 overflow-y-auto">
                    {history.map((entry, idx) => (
                      <button
                        key={idx}
                        onClick={() => handleHistorySelect(entry)}
                        className="w-full text-left px-3 py-2 hover:bg-muted text-sm border-b last:border-b-0 flex items-center gap-2"
                      >
                        <Badge variant="outline" className="text-xs shrink-0">
                          {entry.type}
                        </Badge>
                        <span className="truncate">{entry.query}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <Button onClick={handleSearch} size="sm" disabled={isLoading || !input.trim()}>
                <Search className="w-4 h-4" />
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-2 border-t">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-medium text-muted-foreground">Top K DGI</label>
                  <Badge variant="secondary" className="text-xs">{topKDGI}</Badge>
                </div>
                <input
                  type="range"
                  min="1"
                  max="50"
                  value={topKDGI}
                  onChange={(e) => setTopKDGI(parseInt(e.target.value))}
                  className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
                />
                <div className="text-xs text-muted-foreground mt-1">Top K neighbors by DGI similarity</div>
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-medium text-muted-foreground">Sim threshold</label>
                  <Badge variant="secondary" className="text-xs">{simThreshold.toFixed(2)}</Badge>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={simThreshold}
                  onChange={(e) => setSimThreshold(parseFloat(e.target.value))}
                  className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer"
                />
                <div className="text-xs text-muted-foreground mt-1">Min DGI similarity threshold</div>
              </div>
            </div>
          </div>

          <ScrollArea className="flex-1 px-6 py-4">
            {isLoading && (
              <div className="space-y-4">
                <div className="h-4 bg-muted rounded animate-pulse w-3/4" />
                <div className="h-4 bg-muted rounded animate-pulse w-1/2" />
              </div>
            )}

            {error && (
              <div className="text-sm text-destructive">
                Error: {error.message}
              </div>
            )}

            {clustering && !isLoading && (
              <div className="space-y-6">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Seed node</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div>
                      <span className="text-xs text-muted-foreground">id:</span>
                      <p className="font-mono text-sm break-all">{clustering.seedNodeId}</p>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground">name:</span>
                      <p className="font-semibold text-sm">{clustering.seedNodeName}</p>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Cluster statistics</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Cluster size:</span>
                      <Badge variant="secondary">{clustering.clusterSize} nodes</Badge>
                    </div>
                    {clustering.semanticScore !== null && (
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-muted-foreground">Semantic score:</span>
                        <Badge variant="outline">
                          {(clustering.semanticScore * 100).toFixed(1)}%
                        </Badge>
                      </div>
                    )}
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Algorithm:</span>
                      <Badge variant="outline">{clustering.metadata.algorithm}</Badge>
                    </div>
                    {clustering.metadata.query && (
                      <div className="mt-2 pt-2 border-t">
                        <span className="text-xs text-muted-foreground">Query:</span>
                        <p className="text-sm italic text-muted-foreground truncate">
                          "{clustering.metadata.query}"
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                <div>
                  <h3 className="font-semibold text-sm mb-3">Cluster members ({clustering.clusterSize})</h3>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {clustering.clusterNodeNames.map((name, idx) => (
                      <div
                        key={clustering.clusterNodeIds[idx]}
                        className="flex items-center justify-between p-2 rounded border hover:bg-accent cursor-pointer transition"
                        onClick={() => onNodeClick?.(clustering.clusterNodeIds[idx])}
                      >
                        <span className="text-sm font-mono truncate">{name}</span>
                        <Badge className="text-xs shrink-0">
                          {idx === 0 ? "seed" : "member"}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {!isLoading && !error && !clustering && input && (
              <div className="text-sm text-muted-foreground text-center py-8">
                Click search or press Enter to cluster
              </div>
            )}
          </ScrollArea>

          <div className="px-6 py-4 border-t space-y-2 bg-muted/30">
            {clustering && (
              <div className="flex gap-2">
                <Button
                  onClick={handleCopyNodeIds}
                  variant="outline"
                  size="sm"
                  className="flex-1"
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Copy ids
                </Button>
                <Button
                  onClick={handleExportCluster}
                  variant="outline"
                  size="sm"
                  className="flex-1"
                >
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
              </div>
            )}
            {history.length > 0 && (
              <Button
                onClick={handleClearHistory}
                variant="ghost"
                size="sm"
                className="w-full text-xs"
              >
                Clear history
              </Button>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
