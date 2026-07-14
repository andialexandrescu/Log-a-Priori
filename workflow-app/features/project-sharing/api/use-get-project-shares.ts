import { useQuery } from "@tanstack/react-query";
import { sharingFetch } from "./sharing-fetch";

export const useGetProjectShares = (projectId: string) => {
    return useQuery({
        queryKey: ["project-shares", projectId],
        queryFn: async () => {
            const { data } = await sharingFetch(`/projects/${projectId}/shares/access`);
            return data;
        },
    });
};
