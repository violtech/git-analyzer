import type { Analysis } from "./types";

/**
 * What the repository's tags turned out to be, so a caller can tell "no releases" from "a tag style we do not recognise".
 * `stable`, `pre` and `rolling` are the tags that count as releases or builds; the rest are why a tag did not.
 */
export interface TagCounts {
  stable: number;
  pre: number;
  rolling: number;
  /** monorepo package tags (@scope/pkg@1.2.3) */
  package: number;
  /** excluded by a rule in release-rules.json */
  ignored: number;
  /** not a version at all (latest, v1, master-0035858) */
  other: number;
  /** the same version tagged twice (v1.2.3 and v1.2.3-stable): the later tag */
  duplicates: number;
  total: number;
}

export function tagCounts(data: Analysis): TagCounts {
  const o = data.otherTags;
  const stable = data.releases.filter((r) => r.stable).length;
  const pre = data.releases.filter((r) => r.pre).length;
  const rolling = data.releases.filter((r) => r.rolling).length;
  const pkg = o?.package.length ?? data.packageTags;
  const ignored = o?.ignored.length ?? 0;
  const other = o?.other.length ?? 0;
  const duplicates = o?.duplicate.length ?? 0;
  return { stable, pre, rolling, package: pkg, ignored, other, duplicates, total: stable + pre + rolling + pkg + ignored + other + duplicates };
}
