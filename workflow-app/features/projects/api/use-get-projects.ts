import { useQuery } from "@tanstack/react-query";
import { client } from "@/lib/rpc";

export const useGetProjects = () => {
	const query = useQuery({
		queryKey: ["projects"],
		queryFn: async () => {
			const res = await client.api.projects.$get();

			if (!res.ok) {
				throw new Error("Failed to get projects");
			}

			const { data } = await res.json();

			return data;
		},
	});
	return query;
};