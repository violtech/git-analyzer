import { changedDirectories, gitDirFor, headAtOrBefore, SCHEMA } from "./git";
import { globMatcher } from "./glob";
import { buildReport, type ReportOptions } from "./report";
import type { Analysis, PullStats } from "./types";

type Loose = Record<string, unknown> & {
  meta: { provenance: { headAtAsOf: { sha: string; committedAt: string } | null; analysisSchema: number | null } };
  quarters?: { quarters: { start: string; end: string; complete: boolean; largeChange: boolean; topChangedDirectories: unknown }[] };
};

/**
 * buildReport() plus the two facts that need the local clone: the commit at or before asOf, and, for quarters with a large
 * source change, the directories that moved most. Everything else is identical. Used by the CLI, the REST API and `sample`;
 * if the clone is not on disk the report is still returned, with those two fields left empty.
 */
export async function buildFullReport(raw: Analysis, pulls: PullStats | null, opts: ReportOptions = {}) {
  const report = buildReport(raw, pulls, opts) as unknown as Loose;
  const prov = report.meta.provenance;
  prov.analysisSchema = SCHEMA;

  const dir = await gitDirFor(raw).catch(() => null);
  if (!dir) return report;
  const ref = raw.headSha ?? "HEAD";
  const isVendored = globMatcher(raw.appliedRules?.vendored);
  const asOf = opts.asOf ?? Date.now() / 1000;
  try {
    const head = await headAtOrBefore(dir, asOf, ref);
    if (head) prov.headAtAsOf = { sha: head.sha, committedAt: new Date(head.committedAt * 1000).toISOString() };

    for (const q of report.quarters?.quarters ?? []) {
      if (!q.largeChange) continue;
      const start = Date.parse(q.start) / 1000;
      const end = q.complete ? Date.parse(q.end) / 1000 + 1 : Math.min(asOf + 1, Date.parse(q.end) / 1000 + 1);
      q.topChangedDirectories = await changedDirectories(dir, ref, start, end, 5, isVendored);
    }
  } catch {
    // the clone could not be read: keep the report without the git-derived extras
  }
  return report;
}
