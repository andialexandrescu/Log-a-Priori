"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PROJECT_ROLE_CAPABILITIES, PROJECT_ROLE_LABELS, ProjectRole, type ProjectRoleType } from "@/features/project-sharing/constants";
import type { ProjectAccessPayload } from "../lib/project-response";

type Props = {
    access: ProjectAccessPayload;
};

export function ProjectRoleAccessCard({ access }: Props) {
    if (access.isOwner) {
        return null;
    }

    const role = access.role as ProjectRoleType;
    const capabilities = PROJECT_ROLE_CAPABILITIES[role] ?? PROJECT_ROLE_CAPABILITIES[ProjectRole.VIEWER];

    return (
        <Card className="border-dashed">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                    Your access
                    <Badge variant="secondary" className="capitalize">
                        {role}
                    </Badge>
                </CardTitle>
                <CardDescription>{PROJECT_ROLE_LABELS[role]}</CardDescription>
            </CardHeader>
            <CardContent>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                    {capabilities.map((line) => (
                        <li key={line}>{line}</li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    );
}
