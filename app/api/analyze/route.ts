import { NextRequest, NextResponse } from "next/server";
import { analyze } from "@/lib/git";


export async function GET(req: NextRequest) {
  const repo = req.nextUrl.searchParams.get("repo") ?? "";
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  try {
    return NextResponse.json(await analyze(repo, refresh));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
