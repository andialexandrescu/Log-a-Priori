import { CommitIndexEntry, CommitIndexRecord } from "@/features/commits/types";

type BuildCommitIndexInput = {
    pb: any;
    memberId: string;
    projectId: string;
    repository: string;
};

const createAdminClient = (): any => { // needed to create relations, requiring full adminPb permissions
    const PocketBase = require("pocketbase").default;
    const adminPb = new PocketBase(process.env.NEXT_PUBLIC_POCKETBASE_API_URL);
    const adminEmail = process.env.POCKETBASE_ADMIN_EMAIL;
    const adminPassword = process.env.POCKETBASE_ADMIN_PASSWORD;
    
    if (!adminEmail || !adminPassword) {
        throw new Error("POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD must be set");
    }
    
    return { adminPb, adminEmail, adminPassword }; // a new admin client per request to avoid race conditions
};

// used to build chronological commit index from webhook_events and establishes previousSha/ nextSha links for commit traversal
export const buildCommitIndex = async ({pb, memberId, projectId, repository,}: BuildCommitIndexInput): Promise<CommitIndexRecord> => {
    console.log(`Building commit index for ${repository}, memberId=${memberId}, projectId=${projectId}`);

    const events = await pb.collection("webhook_events").getFullList({
        filter: `member="${memberId}" && repository="${repository}" && event_type="commit"`,
        sort: "+payload.commit.author.date", // oldest first
        fields: "id,payload",
    });

    console.log(`Found ${events.length} commits to index`);

    const commits: CommitIndexEntry[] = events.map((event: any, idx: number) => {
        const payload = event.payload;
        return { // index entries with bidirectional links
            sha: payload.sha,
            authorDate: payload.commit.author.date,
            previousSha: idx > 0 ? events[idx - 1].payload.sha : null,
            nextSha: idx < events.length - 1 ? events[idx + 1].payload.sha : null,
            author: payload.commit.author.name || "Unknown",
            message: payload.commit.message || "",
            added: payload.added || [],
            modified: payload.modified || [],
            removed: payload.removed || [],
        };
    });

    const indexRecord: CommitIndexRecord = {
        member: memberId,
        project: projectId,
        repository,
        commits,
        lastIndexedAt: new Date().toISOString(),
    };

    const createRecord = {
        ...indexRecord,
        member: memberId,
        project: projectId,
    };

    try {
        const existing = await pb.collection("commit_index").getFirstListItem(
            `member="${memberId}" && project="${projectId}" && repository="${repository}"`
        ).catch(() => null);

        if (existing) {
            const updateRecord = {
                ...createRecord,
            };
            await pb.collection("commit_index").update(existing.id, updateRecord);
            console.log(`Updated existing commit index record ${existing.id}`);
        } else {
            console.log(`Attempting to create commit_index with record:`, JSON.stringify({
                member: memberId,
                project: projectId,
                repository,
                commits_count: commits.length,
                lastIndexedAt: indexRecord.lastIndexedAt,
            }));
            
            try {
                const { adminPb, adminEmail, adminPassword } = createAdminClient();
                await adminPb.admins.authWithPassword(adminEmail, adminPassword);
                
                const adminMember = await adminPb.collection("members").getOne(memberId);
                console.log(`Member found via admin: ${memberId} (${adminMember.name}), project field: ${adminMember.project}`);
                
                const adminProject = await adminPb.collection("projects").getOne(projectId);
                console.log(`Project found via admin: ${projectId} (${adminProject.name})`);
                
                await adminPb.collection("commit_index").create(createRecord);
                console.log(`Commit index created successfully (via admin client) for projectId ${projectId} and memberId ${memberId}`);
            } catch (adminError: any) {
                console.error(`Admin client creation failed:`, adminError);
                if (adminError.response?.data) {
                    console.error(`PocketBase errors:`, JSON.stringify(adminError.response.data, null, 2));
                }
                throw adminError;
            }
        }
    } catch (error: any) {
        console.error(`Error upserting commit index:`, error);
        if (error.response?.data) {
            console.error(`PocketBase validation errors:`, JSON.stringify(error.response.data, null, 2));
        }
        throw error;
    }

    console.log(`Commit index built: ${commits.length} commits indexed`);
    return indexRecord;
};

export const getCommitIndex = async ({pb, memberId, projectId, repository}: Omit<BuildCommitIndexInput, "pb"> & { pb: any }): Promise<CommitIndexRecord | null> => {
    try {
        const index = await pb.collection("commit_index").getFirstListItem(
            `member="${memberId}" && project="${projectId}" && repository="${repository}"`
        );
        return index as unknown as CommitIndexRecord;
    } catch {
        return null;
    }
};

export const getCommitsInOrder = (index: CommitIndexRecord): CommitIndexEntry[] => {
    return [...index.commits]; // already sorted by authorDate ascending
};
