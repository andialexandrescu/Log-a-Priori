import { FileText, FilePlus, FileMinus } from "lucide-react";

interface CommitCardProps {
    message: string;
    timeLabel: string;
    addedCount: number;
    modifiedCount: number;
    removedCount: number;
}

export function CommitCard({ message, timeLabel, addedCount, modifiedCount, removedCount }: CommitCardProps) {
    return (
        <div className="group border border-border hover:border-ring rounded-lg p-3 hover:shadow-md transition-all bg-card/50 hover:bg-card h-full flex flex-col">
            <div className="flex items-start justify-start mb-2">
                <span className="text-xs text-muted-foreground">
                    {timeLabel}
                </span>
            </div>

            <div className="flex-1 mb-2">
                <div className="text-sm leading-tight whitespace-pre-line wrap-break-word">
                    {message}
                </div>
            </div>

            <div className="flex items-center gap-4 text-xs mt-auto pt-2 border-t border-border/50">
                <FileChangeBadge type="added" count={addedCount} />
                <FileChangeBadge type="modified" count={modifiedCount} />
                <FileChangeBadge type="removed" count={removedCount} />
            </div>
        </div>
    );
}

interface FileChangeBadgeProps {
    type: 'added' | 'modified' | 'removed';
    count: number;
}

function FileChangeBadge({ type, count }: FileChangeBadgeProps) {
    const { icon: Icon, color, label } = {
        added: { icon: FilePlus, color: "text-green-600", label: "added" },
        modified: { icon: FileText, color: "text-yellow-600", label: "modified" },
        removed: { icon: FileMinus, color: "text-red-600", label: "removed" }
    }[type];

    return (
        <div className="flex items-center gap-1">
            <Icon className="w-3 h-3" />
            <span className={color}>{count} {label}</span>
        </div>
    );
}