type AccessListUser = {
    id: string;
    name?: string;
    email?: string;
    username?: string;
    avatar?: string;
};

type AccessListShare = {
    status?: string;
    role?: string;
    expand?: {
        to_user?: AccessListUser;
    };
};

export type ProjectAccessUser = {
    id: string;
    name?: string;
    email?: string;
    username?: string;
    avatar?: string;
    role: string;
    isOwner: boolean;
};

function mapPbUser(
    user: AccessListUser | undefined | null,
    role: string,
    isOwner: boolean
): ProjectAccessUser | null {
    if (!user?.id) {
        return null;
    }

    return {
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        avatar: user.avatar,
        role,
        isOwner,
    };
}

export function buildProjectAccessList(
    ownerUser: AccessListUser | undefined,
    shares: AccessListShare[],
    options?: { includePending?: boolean }
): ProjectAccessUser[] {
    const users = new Map<string, ProjectAccessUser>();
    const owner = mapPbUser(ownerUser, "owner", true);
    if (owner) {
        users.set(owner.id, owner);
    }

    for (const share of shares) {
        const status = share.status as string | undefined;
        if (status !== "accepted" && !(options?.includePending && status === "pending")) {
            continue;
        }

        const toUser = share.expand?.to_user;
        const rawRole = (share.role as string) ?? "viewer";
        const role = rawRole === "admin" ? "editor" : rawRole;
        const mapped = mapPbUser(toUser, role, false);
        if (mapped && mapped.id !== owner?.id) {
            users.set(mapped.id, mapped);
        }
    }

    return Array.from(users.values());
}
