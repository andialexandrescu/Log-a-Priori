import { useQuery } from "@tanstack/react-query";

export const useGetProjectRootDirectory = (projectId?: string) => {
    const query = useQuery({
        queryKey: ["project-root-directory", projectId],
        queryFn: async (): Promise<string | null> => {
            if (typeof window === "undefined" || !window.desktopControl) {
                return null;
            }
            return window.desktopControl.getProjectRootDirectory(projectId);
        },
    });

    return query;
};
