import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/rpc";
import { toast } from "sonner";
import { normalizeProjectListItems, type ProjectListItem } from "../schemas";

export const useGetProjects = () => {
	const query = useQuery({
		queryKey: ["projects"],
		queryFn: async (): Promise<ProjectListItem[]> => {
            try {
                const res = await client.api.projects.$get();

                if (!res.ok) {
                    throw new Error("Failed to get projects");
                }

                const body = (await res.json()) as { data?: unknown };
                return normalizeProjectListItems(body.data);
            } catch (error) {
                toast.error("Failed to fetch current user's projects");
                throw error;
            }
		},
	});
	return query;
};