// GET /api/free-route/swap — pricing + router calldata, keyed server-side (calldata is public; only the key is secret).
import type { NextRequest } from 'next/server';
import { serializeSwap, parseSwapQuery } from '@baking-bad/free-route-tezos-x';
import { freeRoute } from '@/lib/server/freeRoute';

export async function GET(req: NextRequest) {
  let query;
  try {
    query = parseSwapQuery(req.nextUrl.searchParams); // validate untrusted params
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  try {
    return Response.json(serializeSwap(await freeRoute.getSwap(query))); // model -> DTO (JSON can't carry bigint)
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
