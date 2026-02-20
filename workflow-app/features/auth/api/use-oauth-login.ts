import { useMutation } from "@tanstack/react-query";
import PocketBase from "pocketbase";

export const useOAuthLogin = (provider: 'github' | 'google') => {
    const mutation = useMutation({
        mutationFn: async () => {
            const pb = new PocketBase(process.env.NEXT_PUBLIC_POCKETBASE_API_URL);
            
            const authData = await pb.collection('users').authWithOAuth2({
                provider,
            });

            // pocketbase automatically stores the token in local storage, i need to also set it as a cookie for server side auth
            await fetch('/api/auth/oauth/callback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ token: authData.token }),
            });

            return authData;
        }
    });

    return mutation;
};