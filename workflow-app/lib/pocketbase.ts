import { TypedPocketBase } from '@/types/pocketbase-types';
import PocketBase from 'pocketbase';
import 'server-only';

const client = new PocketBase(
    process.env.NEXT_PUBLIC_POCKETBASE_API_URL
) as TypedPocketBase;

export const createAdminClient = async () => {
    if (!process.env.POCKETBASE_ADMIN_EMAIL || !process.env.POCKETBASE_ADMIN_PASSWORD) {
        throw new Error('Admin credentials not defined');
    }

    // create a fresh admin client instance to avoid race conditions
    const adminClient = new PocketBase(
        process.env.NEXT_PUBLIC_POCKETBASE_API_URL
    ) as TypedPocketBase;

    await adminClient.admins.authWithPassword(
        process.env.POCKETBASE_ADMIN_EMAIL,
        process.env.POCKETBASE_ADMIN_PASSWORD
    );

    return adminClient;
};

export default client;