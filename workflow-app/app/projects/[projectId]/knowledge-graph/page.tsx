import { KnowledgeGraphRootDirectory } from "@/features/knowledge-graph/components/knowledge-graph-root-directory";

type KnowledgeGraphPageProps = {
    params: Promise<{ projectId: string }>;
};

export default async function KnowledgeGraphPage({ params }: KnowledgeGraphPageProps) {
    const { projectId } = await params;

    return (
        <div className="space-y-4">
            <KnowledgeGraphRootDirectory />
        </div>
    );
}