async function sharingFetch(path: string, init?: RequestInit) {
    const response = await fetch(`/api${path}`, {
        ...init,
        credentials: "include",
        headers: {
            ...(init?.headers ?? {}),
        },
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload.error || `Request failed (${response.status})`);
    }
    return payload;
}

export { sharingFetch };
