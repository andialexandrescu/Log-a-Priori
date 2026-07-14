import { useQuery } from "@tanstack/react-query";
import { sharingFetch } from "./sharing-fetch";

export type SenderShareUpdate = {
    id: string;
    project: string;
    to_user?: string;
    role?: string;
    message?: string;
    status?: "accepted" | "declined" | string;
    sender_read?: boolean;
    expand?: {
        project?: { id: string; name: string };
        to_user?: { id: string; name?: string; email?: string; username?: string };
    };
};

export const useGetSenderShareUpdates = () => {
    return useQuery({
        queryKey: ["project-shares", "sender-updates"],
        queryFn: async () => {
            const { data } = await sharingFetch("/project-shares/sender-updates");
            return data as SenderShareUpdate[];
        },
        refetchInterval: 15000,
    });
};
