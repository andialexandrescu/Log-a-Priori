import { useQuery } from "@tanstack/react-query";

export const useGetCommitStorageRootDirectory = (projectId?: string) => {
    const query = useQuery({
        queryKey: ["commit-storage-root-directory", projectId],
        queryFn: async (): Promise<string | null> => {
            if (typeof window === "undefined" || !window.desktopControl || !projectId) {
                return null;
            }
            return window.desktopControl.getProjectCommitStorageRootDirectory(projectId);
        },
        enabled: !!projectId,
    });

    return query;
};
