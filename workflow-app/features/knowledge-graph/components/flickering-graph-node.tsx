"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { ColorRepresentation, MeshBasicMaterial } from "three";
import { GRAPH_CLUSTER_FLICKER_MAX_OPACITY, GRAPH_CLUSTER_FLICKER_MIN_OPACITY, GRAPH_CLUSTER_FLICKER_SPEED } from "@/features/knowledge-graph/lib/graph-cluster-highlight";

type FlickeringGraphNodeProps = {
    color: ColorRepresentation;
    size: number;
    opacity: number;
    flicker: boolean;
};

export function FlickeringGraphNode({ color, size, opacity, flicker }: FlickeringGraphNodeProps) {
    const materialRef = useRef<MeshBasicMaterial>(null);

    useFrame((state) => {
        const material = materialRef.current;
        if (!flicker || !material) {
            return;
        }

        const pulse = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * GRAPH_CLUSTER_FLICKER_SPEED);
        material.opacity =
            GRAPH_CLUSTER_FLICKER_MIN_OPACITY +
            (GRAPH_CLUSTER_FLICKER_MAX_OPACITY - GRAPH_CLUSTER_FLICKER_MIN_OPACITY) * pulse;
    });

    return (
        <mesh>
            <circleGeometry args={[size, 32]} />
            <meshBasicMaterial
                ref={materialRef}
                color={color}
                opacity={flicker ? GRAPH_CLUSTER_FLICKER_MAX_OPACITY : opacity}
                transparent
            />
        </mesh>
    );
}
