import { useQuery } from "@tanstack/react-query";
import { useDesktopUserId } from "@/lib/use-desktop-user-id";

export const useGetProjectRootDirectory = (projectId?: string) => {
    const userId = useDesktopUserId();

    const query = useQuery({
        queryKey: ["project-root-directory", userId, projectId],
        enabled: !!userId,
        queryFn: async (): Promise<string | null> => {
            if (typeof window === "undefined" || !window.desktopControl || !userId) {
                return null;
            }
            return window.desktopControl.getProjectRootDirectory(userId, projectId);
        },
    });

    return query;
};
