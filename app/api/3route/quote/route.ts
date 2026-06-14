// GET /api/3route/quote — pricing only, keyed server-side.
import type { NextRequest } from 'next/server';
import { serializeQuote } from '@sdk/index.js';
import { threeRoute } from '@/lib/server/threeRoute';
import { parseQuoteQuery } from '@/lib/threeRouteDto';

export async function GET(req: NextRequest) {
  let query;
  try {
    query = parseQuoteQuery(req.nextUrl.searchParams); // validate untrusted params
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  try {
    return Response.json(serializeQuote(await threeRoute.getQuote(query))); // model -> DTO (JSON can't carry bigint)
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
