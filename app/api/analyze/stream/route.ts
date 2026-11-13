import { NextRequest } from "next/server";
import { analyze } from "@/lib/git";
import type { StreamMessage } from "@/lib/types";

/** Streams newline-delimited JSON: progress events while git works, then "done" or "error". */
export async function GET(req: NextRequest) {
  const repo = req.nextUrl.searchParams.get("repo") ?? "";
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";
  const enc = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (m: StreamMessage) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(m) + "\n"));
        } catch {
          // client went away
        }
      };
      try {
        const data = await analyze(repo, refresh, (e) => send({ type: "progress", ...e }));
        send({ type: "done", data });
      } catch (e) {
        send({ type: "error", error: (e as Error).message });
      }
      try {
        controller.close();
      } catch {}
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
