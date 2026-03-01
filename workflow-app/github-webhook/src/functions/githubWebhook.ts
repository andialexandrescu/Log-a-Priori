import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions';
import { createHmac, timingSafeEqual } from 'crypto';

function verifySignature(secret: string, payload: string, signatureHeader: string | null): boolean { // for incoming payloads including a x-hub-signature-256 header
    if (!signatureHeader) return false;
    const sig = signatureHeader.split('=')[1];
    if (!sig) return false;
    const hmac = createHmac('sha256', secret);
    const digest = hmac.update(payload).digest('hex');
    try {
        return timingSafeEqual(Buffer.from(sig), Buffer.from(digest));
    } catch {
        return false;
    }
}

export async function githubWebhook(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    try {
        context.log('GitHub webhook triggered');

        const signature = request.headers.get('x-hub-signature-256');
        if (!signature) {
            context.log('Missing signature x-hub-signature-256 header');
            return { status: 401, body: 'Unauthorized' };
        }

        let rawBody: string;
        let payload: any;
        try {
            rawBody = await request.text();
            payload = JSON.parse(rawBody); // parse the raw body
        } catch (err) {
            context.log('Failed to read/ parse body:', err);
            return { status: 400, body: 'Invalid body' };
        }

        const pocketbaseUrl = process.env.POCKETBASE_URL; // getting credentials from pocketbase, in order to obtain the webhookSecret field from the api_keys json
        const serviceToken = process.env.POCKETBASE_SERVICE_TOKEN;
        if (!pocketbaseUrl || !serviceToken) {
            context.log('Missing PocketBase configuration');
            return { status: 500, body: 'Server configuration error' };
        }

        const repoFullname = payload?.repository?.full_name;
        if (!repoFullname) {
            context.log('No repository info in payload');
            return { status: 400, body: 'Bad Request' };
        }
        const [owner, repo] = repoFullname.split('/');

        let credential: any;
        let memberId: string;
        let projectId: string;
        try {
            const filter = `(api_keys.owner='${owner}' && api_keys.repo='${repo}')`;
            const encodedFilter = encodeURIComponent(filter);
            const searchUrl = `${pocketbaseUrl}/api/collections/credentials/records?filter=${encodedFilter}&expand=member.project`;
            context.log('Search url:', searchUrl);
            
            const response = await fetch(searchUrl, {
                headers: {
                    Authorization: `Bearer ${serviceToken}`
                },
            });
            context.log(`PocketBase response status: ${response.status}`);
            const responseText = await response.text();
            if (!response.ok) {
                context.log(`PocketBase request failed: ${response.status} - ${responseText}`);
                return { status: 500, body: 'Failed to fetch credential from PocketBase' };
            }

            let data;
            try {
                data = JSON.parse(responseText);
            } catch (parseError) {
                context.log('Failed to parse PocketBase response as json:', parseError);
                return { status: 500, body: 'Invalid response from PocketBase' };
            }
            if (!data.items || data.items.length === 0) {
                context.log(`No credential found for repo ${repoFullname}`);
                return { status: 404, body: 'Not Found' };
            }

            credential = data.items[0];
            memberId = credential.member;
            projectId = credential.expand?.member?.expand?.project?.id;
            if (!projectId) {
                context.log('Could not determine project ID from credential');
                return { status: 500, body: 'Internal Server Error' };
            }
        } catch (err) {
            context.log('Failed to fetch credential from PocketBase', err);
            return { status: 500, body: 'Internal Server Error' };
        }

        const secret = credential.api_keys.webhookSecret;

        if (!verifySignature(secret, rawBody, signature)) { // since there are repo specific webhook secrets, the retrieved secret is verified for each repo included as credential for a project
            context.log('Invalid signature');
            return { status: 403, body: 'Forbidden' };
        }
        context.log('Signature verified');

        const backendUrl = process.env.BACKEND_BASE_URL;
        const backendToken = process.env.BACKEND_SERVICE_TOKEN;
        const event = request.headers.get('x-github-event');
        if (backendUrl && backendToken) {
            try {
                await fetch(`${backendUrl}/api/projects/${projectId}/members/${memberId}/webhook-events`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${backendToken}`,
                    },
                    body: JSON.stringify({
                        event,
                        repo: repoFullname,
                        data: payload,
                    }),
                });
            } catch (err) {
                context.log('error', 'Failed to forward event to backend:', err);
            }
        }

        return { status: 200, body: 'OK' };
    } catch (err) {
        context.error('Unhandled exception in githubWebhook:', err);
        return { status: 500, body: 'Internal Server Error' };
    }
}

app.http('githubWebhook', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: githubWebhook,
});