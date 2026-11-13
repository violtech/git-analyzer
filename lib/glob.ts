// Path patterns for per-repository rules (vendored folders). Root-relative, forward slashes:
//   `*`  anything inside one folder level     `**`  any number of levels     `?`  one character
//   `third_party/llama.cpp/`  or  `third_party/llama.cpp`  a folder and everything under it
//   `src/**/*.pb.ts`           a pattern; a plain name also matches the file or folder of exactly that path

function toRegex(pattern: string): RegExp {
  let p = pattern.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
  if (p.endsWith("/")) p += "**";
  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*") {
      if (p[i + 1] === "*") {
        i++;
        if (p[i + 1] === "/") {
          i++;
          re += "(?:.*/)?"; // `**/` also matches zero levels
        } else re += ".*";
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  // a pattern naming a folder (no wildcard at the end) also covers what is inside it
  return new RegExp(`^${re}(?:/.*)?$`);
}

/** Returns a test for "is this repository path covered by one of the patterns". Empty list matches nothing. */
export function globMatcher(patterns: string[] | undefined): (file: string) => boolean {
  const res = (patterns ?? []).filter((p) => p.trim()).map(toRegex);
  if (!res.length) return () => false;
  return (file) => res.some((r) => r.test(file));
}
