export function getRepositoryFromCredential(credential: unknown): string | null {
    const apiKeys = (credential as { api_keys?: { owner?: string; repo?: string } } | null)?.api_keys;
    if (apiKeys?.owner && apiKeys?.repo) {
        return `${apiKeys.owner}/${apiKeys.repo}`;
    }
    return null;
}
