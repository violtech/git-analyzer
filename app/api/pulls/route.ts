import { NextRequest, NextResponse } from "next/server";
import { RateLimitError } from "@/lib/github-client";
import { fetchPulls } from "@/lib/github";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  try {
    return NextResponse.json(await fetchPulls(p.get("repo") ?? "", p.get("full") === "1"));
  } catch (e) {
    const status = e instanceof RateLimitError ? 429 : 400;
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
