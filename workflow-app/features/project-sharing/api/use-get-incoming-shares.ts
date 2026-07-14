import { useQuery } from "@tanstack/react-query";
import { sharingFetch } from "./sharing-fetch";

export type IncomingProjectShare = {
    id: string;
    project: string;
    from_user?: string;
    role?: string;
    message?: string;
    status?: string;
    expand?: {
        project?: { id: string; name: string };
        from_user?: { id: string; name?: string; email?: string; username?: string };
        to_user?: { id: string; name?: string; email?: string; username?: string };
    };
};

export const useGetIncomingProjectShares = () => {
    return useQuery({
        queryKey: ["project-shares", "incoming"],
        queryFn: async () => {
            const { data } = await sharingFetch("/project-shares/incoming");
            return data as IncomingProjectShare[];
        },
        refetchInterval: 15000,
    });
};
