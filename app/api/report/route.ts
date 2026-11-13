import { NextRequest, NextResponse } from "next/server";
import type { AuthorKind } from "@/lib/agents";
import { analyze } from "@/lib/git";
import { RateLimitError } from "@/lib/github-client";
import { fetchPulls } from "@/lib/github";
import { buildFullReport } from "@/lib/full-report";
import { parseAsOf, SECTIONS, type Section } from "@/lib/report";
import type { Granularity } from "@/lib/types";
import type { Range } from "@/lib/view";

const PERIODS = ["week", "month", "quarter", "year"];
const RANGES = ["1", "2", "5", "all"];
const KINDS = ["all", "developers", "ai", "bots"];

/**
 * Headless twin of the dashboard: the same numbers as JSON.
 * GET /api/report?repo=owner/name&period=month&range=all&kind=all&excludeBulk=1&sections=summary,ai&pulls=1
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const pick = <T extends string>(v: string | null, allowed: string[], fallback: T, name: string): T => {
    if (v === null || v === "") return fallback;
    if (!allowed.includes(v)) throw new Error(`Invalid ${name} "${v}". Use one of: ${allowed.join(", ")}`);
    return v as T;
  };
  try {
    const sections = p.get("sections")?.split(",").filter(Boolean) ?? undefined;
    for (const s of sections ?? []) if (!(SECTIONS as readonly string[]).includes(s)) throw new Error(`Invalid section "${s}". Use: ${SECTIONS.join(", ")}`);

    // validate every option first, so a typo fails before any clone or API call
    const opts = {
      period: pick<Granularity>(p.get("period"), PERIODS, "month", "period"),
      range: pick<Range>(p.get("range"), RANGES, "all", "range"),
      kind: pick<AuthorKind>(p.get("kind"), KINDS, "all", "kind"),
      excludeBulk: p.get("excludeBulk") === "1",
      sections: sections as Section[] | undefined,
      limit: p.get("limit") ? Number(p.get("limit")) : undefined,
      asOf: p.get("asOf") ? parseAsOf(p.get("asOf")!) : undefined,
      quarters: p.get("quarters") ? { count: Number(p.get("quarters")) } : undefined,
    };
    if (opts.quarters && !(Number.isInteger(opts.quarters.count) && opts.quarters.count! >= 1 && opts.quarters.count! <= 40)) throw new Error("Invalid quarters. Use a whole number from 1 to 40");
    if (Number.isNaN(opts.asOf)) throw new Error("Invalid asOf. Use a date like 2026-10-30");

    const pin = p.get("pin") || undefined;
    if (pin && !/^[0-9a-f]{7,40}$/i.test(pin)) throw new Error("Invalid pin. Use a commit sha (7-40 hex characters)");
    const data = await analyze(p.get("repo") ?? "", p.get("refresh") === "1", undefined, { pin });
    const pulls = p.get("pulls") === "1" && data.source.startsWith("https://github.com/") ? await fetchPulls(data.repo, p.get("pullsFull") === "1") : null;

    return NextResponse.json(await buildFullReport(data, pulls, opts));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: e instanceof RateLimitError ? 429 : 400 });
  }
}
