// GET /api/3route/swap — pricing + router calldata, keyed server-side (calldata is public; only the key is secret).
import type { NextRequest } from 'next/server';
import { serializeSwap } from '@sdk/index.js';
import { threeRoute } from '@/lib/server/threeRoute';
import { parseSwapQuery } from '@/lib/threeRouteDto';

export async function GET(req: NextRequest) {
  let query;
  try {
    query = parseSwapQuery(req.nextUrl.searchParams); // validate untrusted params
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  try {
    return Response.json(serializeSwap(await threeRoute.getSwap(query))); // model -> DTO (JSON can't carry bigint)
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
