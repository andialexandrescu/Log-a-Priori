import { useQuery } from "@tanstack/react-query";
import { useDesktopUserId } from "@/lib/use-desktop-user-id";

export const useGetCommitStorageRootDirectory = (projectId?: string) => {
    const userId = useDesktopUserId();

    const query = useQuery({
        queryKey: ["commit-storage-root-directory", userId, projectId],
        queryFn: async (): Promise<string | null> => {
            if (typeof window === "undefined" || !window.desktopControl || !projectId || !userId) {
                return null;
            }
            return window.desktopControl.getProjectCommitStorageRootDirectory(userId, projectId);
        },
        enabled: !!projectId && !!userId,
    });

    return query;
};
