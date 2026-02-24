import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/rpc";
import { toast } from "sonner";

export const useCurrent = () => {
    const query = useQuery({
        queryKey: ["current"],
        queryFn: async () => {
            try {
                const response = await client.api.auth.current.$get();

                if (!response.ok) {
                    return null;
                }

                const { data } = await response.json();
                return data;
            } catch (error) {
                toast.error("Failed to fetch current user");
                throw error;
            }
        }
    });

    return query;
}