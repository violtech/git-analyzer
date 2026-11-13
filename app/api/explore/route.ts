import { NextRequest, NextResponse } from "next/server";
import { RateLimitError } from "@/lib/github-client";
import { explore, type ExplorePeriod, type ExploreSort } from "@/lib/explore";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  try {
    const result = await explore({
      period: (p.get("period") ?? "week") as ExplorePeriod,
      topic: p.get("topic") ?? "",
      language: p.get("language") ?? "",
      sort: (p.get("sort") ?? "stars") as ExploreSort,
      page: Number(p.get("page") ?? 1),
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof RateLimitError ? 429 : 400 });
  }
}
