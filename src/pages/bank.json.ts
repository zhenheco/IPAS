import { loadSiteBank } from '../lib/bankfile';

export const GET = () => new Response(JSON.stringify(loadSiteBank()), { headers: { 'content-type': 'application/json' } });
