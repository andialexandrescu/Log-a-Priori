import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/rpc";
import type { ProjectAccessPayload } from "../lib/project-response";

export type ProjectDetailResult =
    | {
          status: "ok";
          project: Record<string, unknown>;
          access: ProjectAccessPayload;
      }
    | {
          status: "deleted";
          deleted: { projectId: string; projectName: string; deletedAt?: string };
          message: string;
      }
    | {
          status: "error";
          message: string;
      };

export const useGetProject = (projectId: string) => {
    const query = useQuery({
        queryKey: ["projects", projectId],
        enabled: !!projectId,
        retry: false,
        queryFn: async (): Promise<ProjectDetailResult> => {
            const res = await client.api.projects[":projectId"].$get({
                param: { projectId },
            });

            const body = await res.json().catch(() => ({}));

            if (res.status === 410) {
                const payload = body as {
                    error?: string;
                    deleted?: { projectId: string; projectName: string; deletedAt?: string };
                };
                return {
                    status: "deleted",
                    deleted: payload.deleted ?? {
                        projectId,
                        projectName: "This project",
                    },
                    message:
                        payload.error ??
                        "This project was deleted by its owner",
                };
            }

            if (!res.ok) {
                return {
                    status: "error",
                    message:
                        (body as { error?: string }).error ??
                        `Failed to get project (${res.status})`,
                };
            }

            const { data, access } = body as {
                data: Record<string, unknown>;
                access: ProjectAccessPayload;
            };

            return {
                status: "ok",
                project: data,
                access,
            };
        },
    });

    return query;
};
