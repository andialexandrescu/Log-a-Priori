import { useQuery } from "@tanstack/react-query";
import { sharingFetch } from "./sharing-fetch";

export type ProjectDeletionNotice = {
    id: string;
    deleted_project_id?: string;
    deleted_project_name?: string;
    manifest?: unknown;
    from_user?: string;
    expand?: {
        from_user?: { id: string; name?: string; email?: string; username?: string };
    };
};

export const useGetProjectDeletionNotices = () => {
    return useQuery({
        queryKey: ["project-shares", "deletion-notices"],
        queryFn: async () => {
            const { data } = await sharingFetch("/project-shares/deletion-notices");
            return data as ProjectDeletionNotice[];
        },
        refetchInterval: 15000,
    });
};
