// GET /api/3route/tokens — token registry, keyed server-side.
import { threeRoute } from '@/lib/server/threeRoute';

export async function GET() {
  try {
    return Response.json(await threeRoute.getTokens());
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
