import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { client } from "@/lib/rpc";
import { toast } from "sonner";

// export const useChangelog = (projectId: string, changelogId: string) => {
//   return useQuery({
//     queryKey: ["changelogs", projectId, changelogId],
//     enabled: !!projectId && !!changelogId,
//     queryFn: async () => {
//       try {
//         const res = await client.api.changelogs[":projectId"][":changelogId"].$get({
//           param: { projectId, changelogId }
//         });

//         if (!res.ok) {
//           throw new Error(`Failed to fetch changelog: ${res.status}`);
//         }

//         const { data } = await res.json();
//         return data;
//       } catch (error) {
//           toast.error("Failed to fetch current changelog");
//           throw error;
//       }
//     }
//   });
// };