import { NextResponse } from "next/server";
import { getBudget } from "@/lib/github-client";

export async function GET() {
  return NextResponse.json(await getBudget());
}
