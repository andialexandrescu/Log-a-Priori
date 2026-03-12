import { useQuery } from "@tanstack/react-query";

export const useGetRootDirectory = () => {
    const query = useQuery({
        queryKey: ["root-directory"],
        queryFn: async (): Promise<string | null> => {
            if (typeof window === "undefined" || !window.desktopControl) {
                return null;
            }
            return window.desktopControl.getRootDirectory();
        },
    });

    return query;
};
