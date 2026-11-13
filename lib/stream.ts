import type { Analysis, ProgressEvent, StreamMessage } from "./types";

/** Reads the NDJSON progress stream from /api/analyze/stream and resolves with the analysis. */
export async function streamAnalysis(
  repo: string,
  refresh: boolean,
  onProgress: (e: ProgressEvent) => void,
): Promise<Analysis> {
  const res = await fetch(`/api/analyze/stream?repo=${encodeURIComponent(repo)}${refresh ? "&refresh=1" : ""}`);
  if (!res.ok || !res.body) throw new Error("Request failed");

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  let result: Analysis | null = null;

  const handle = (line: string) => {
    if (!line.trim()) return;
    const msg = JSON.parse(line) as StreamMessage;
    if (msg.type === "progress") onProgress(msg);
    else if (msg.type === "error") throw new Error(msg.error);
    else result = msg.data;
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (value) {
      const lines = (buf + value).split("\n");
      buf = lines.pop() ?? "";
      lines.forEach(handle);
    }
    if (done) break;
  }
  handle(buf);
  if (!result) throw new Error("The analysis ended without a result");
  return result;
}
