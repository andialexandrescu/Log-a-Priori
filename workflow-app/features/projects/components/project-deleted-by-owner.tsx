"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BackgroundProcessPanel } from "@/components/ui/background-process-panel";

type Props = {
    projectName: string;
    message: string;
};

export function ProjectDeletedByOwner({ projectName, message }: Props) {
    return (
        <main className="flex-1 p-6 space-y-4">
            <BackgroundProcessPanel status="error" title={`"${projectName}" was deleted`} description={message}/>
            <p className="text-sm text-muted-foreground">
                The owner removed this project from the database and cleared packaged data from your
                local app folder on this machine
                You can no longer open graphs, commits, or documentation for this project
            </p>
            <Button asChild variant="outline">
                <Link href="/projects">Back to projects</Link>
            </Button>
        </main>
    );
}
