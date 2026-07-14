"use client";

import { useQuery } from "@tanstack/react-query";

export type ClusteringMetadata = {
  query: string | null;
  topKDGI: number;
  simThreshold: number | null;
  algorithm: string;
};

export type ClusteringResult = {
  clusterNodeIds: string[];
  clusterNodeNames: string[];
  seedNodeId: string;
  seedNodeName: string;
  clusterSize: number;
  semanticScore: number | null;
  metadata: ClusteringMetadata;
};

export type ClusteringParams = {
  query?: string;
  nodeId?: string;
  topKDGI?: number;
  simThreshold?: number;
};

// hook to fetch clustering results for a query or node, either query or nodeId must be provided (not both)
export function useGetClustering( projectId: string, params: ClusteringParams, options?: { enabled?: boolean } ) {
  const { query, nodeId, topKDGI = 10, simThreshold = 0.7 } = params;
  const enabled = options?.enabled ?? !!(query || nodeId);

  return useQuery<ClusteringResult, Error>({
    queryKey: [
      "knowledge-graph",
      projectId,
      "clustering",
      { query, nodeId, topKDGI, simThreshold },
    ],
    queryFn: async () => {
      if (!query && !nodeId) {
        throw new Error("Either query or nodeId must be provided");
      }

      const searchParams = new URLSearchParams();
      if (query) searchParams.append("query", query);
      if (nodeId) searchParams.append("nodeId", nodeId);
      searchParams.append("topKDGI", topKDGI.toString());
      searchParams.append("simThreshold", simThreshold.toString());

      const response = await fetch(
        `/api/projects/${projectId}/knowledge-graph/clustering?${searchParams.toString()}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to fetch clustering results");
      }

      return response.json();
    },
    enabled,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
