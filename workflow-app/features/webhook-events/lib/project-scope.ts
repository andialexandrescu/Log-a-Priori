export function buildWebhookEventsProjectFilter(integrationUserId: string, projectId: string): string {
    return `user = "${integrationUserId}" && project = "${projectId}"`;
}

export function buildWebhookEventsProjectFilterWithRepos(
    integrationUserId: string,
    projectId: string,
    repositories: Set<string>
): string {
    const base = buildWebhookEventsProjectFilter(integrationUserId, projectId);
    if (repositories.size === 0) {
        return base;
    }
    const clauses = Array.from(repositories).map(
        (repo) => `repository = "${repo.replace(/"/g, '\\"')}"`
    );
    return `${base} && (${clauses.join(" || ")})`;
}

export function buildCommitWebhookEventsFilter(
    integrationUserId: string,
    projectId: string,
    repo: string
): string {
    return `user="${integrationUserId}" && project="${projectId}" && repository="${repo}" && event_type="commit"`;
}

export function buildCommitWebhookEventDedupFilter(
    userId: string,
    projectId: string,
    repo: string,
    sha: string
): string {
    return `user="${userId}" && project="${projectId}" && repository="${repo}" && event_type="commit" && payload.sha="${sha}"`;
}
