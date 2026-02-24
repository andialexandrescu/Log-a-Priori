import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/rpc";
import { toast } from "sonner";

export const useGetProjects = () => {
	const query = useQuery({
		queryKey: ["projects"],
		queryFn: async () => {
            try {
                const res = await client.api.projects.$get();

                if (!res.ok) {
                    throw new Error("Failed to get projects");
                }

                const { data } = await res.json();

                return data;
            } catch (error) {
                toast.error("Failed to fetch current user's projects");
                throw error;
            }
		},
	});
	return query;
};