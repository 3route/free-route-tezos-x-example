// GET /api/free-route/quote — pricing only, keyed server-side.
import type { NextRequest } from 'next/server';
import { serializeQuote } from '@baking-bad/free-route-tezos-x';
import { freeRoute } from '@/lib/server/freeRoute';
import { parseQuoteQuery } from '@/lib/freeRouteDto';

export async function GET(req: NextRequest) {
  let query;
  try {
    query = parseQuoteQuery(req.nextUrl.searchParams); // validate untrusted params
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  try {
    return Response.json(serializeQuote(await freeRoute.getQuote(query))); // model -> DTO (JSON can't carry bigint)
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
