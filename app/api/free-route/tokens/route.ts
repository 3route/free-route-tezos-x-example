// GET /api/free-route/tokens — token registry, keyed server-side.
import { freeRoute } from '@/lib/server/freeRoute';

export async function GET() {
  try {
    return Response.json(await freeRoute.getTokens());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
