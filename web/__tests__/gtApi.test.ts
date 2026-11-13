import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "./setup";
import { suggestGt, generateGt, batchGt } from "../app/api";
import { ndjson } from "./handlers";

const API = "http://localhost:8000";

describe("GT api", () => {
  it("suggestGt returns the parsed spec", async () => {
    const res = await suggestGt("fruits");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.spec.theme).toBe("fruits");
  });

  it("generateGt maps urls to absolute and returns a pair", async () => {
    const res = await generateGt({ title: "t", theme: "fruits", panels: [] }, "low");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.pair.frontUrl).toBe(`${API}/generated/gt-fruits-1-front.png`);
      expect(res.pair.backUrl).toBe(`${API}/generated/gt-fruits-1-back.png`);
    }
  });

  it("suggestGt forwards the test focus in the request body", async () => {
    let body: { topic: string | null; test: string | null } | null = null;
    mswServer.use(
      http.post(`${API}/api/gt/suggest`, async ({ request }) => {
        body = (await request.json()) as { topic: string | null; test: string | null };
        return HttpResponse.json({ spec: { title: "t", theme: "x", panels: [] } });
      })
    );
    await suggestGt("ocean", "cogat");
    expect(body!.test).toBe("cogat");
  });

  it("suggestGt surfaces a 502 error message", async () => {
    mswServer.use(
      http.post(`${API}/api/gt/suggest`, () =>
        HttpResponse.json({ error: "Couldn't generate GT worksheet: nope" }, { status: 502 })
      )
    );
    const res = await suggestGt(null);
    expect(res.ok).toBe(false);
    if (!res.ok && !("cancelled" in res)) expect(res.message).toMatch(/nope/);
  });
});

describe("GT streaming progress", () => {
  it("generateGt forwards streamed progress events via onEvent", async () => {
    mswServer.use(
      http.post(`${API}/api/gt/generate`, () =>
        ndjson([
          { type: "generate", side: "front", attempt: 1 },
          { type: "verify_result", side: "front", attempt: 1, passed: true, mismatches: [] },
          {
            type: "done",
            pair: { id: "x-1", front_url: "/generated/gt-x-1-front.png", back_url: "/generated/gt-x-1-back.png" },
          },
        ])
      )
    );
    const events: unknown[] = [];
    const res = await generateGt({ title: "t", theme: "x", panels: [] }, "low", undefined, (e) => events.push(e));
    expect(res.ok).toBe(true);
    expect(events).toEqual([
      { type: "generate", side: "front", attempt: 1 },
      { type: "verify_result", side: "front", attempt: 1, passed: true, mismatches: [] },
      { type: "done", pair: expect.objectContaining({ id: "x-1" }), index: undefined },
    ]);
  });

  it("generateGt surfaces a streamed error event as an error result", async () => {
    mswServer.use(
      http.post(`${API}/api/gt/generate`, () => ndjson([{ type: "error", message: "image generation failed: boom" }]))
    );
    const res = await generateGt({ title: "t", theme: "x", panels: [] }, "low");
    expect(res.ok).toBe(false);
    if (!res.ok && res.kind !== "cancelled") expect(res.message).toMatch(/boom/);
  });

  it("batchGt tags progress events with their item index", async () => {
    mswServer.use(
      http.post(`${API}/api/gt/batch`, () =>
        ndjson([
          { type: "generate", side: "front", attempt: 1, index: 0 },
          { type: "done", index: 0, pair: { id: "a-1", front_url: "/g/a", back_url: "/g/b" } },
          { type: "generate", side: "front", attempt: 1, index: 1 },
          { type: "done", index: 1, pair: { id: "a-2", front_url: "/g/c", back_url: "/g/d" } },
          { type: "batch_done" },
        ])
      )
    );
    const indices: (number | undefined)[] = [];
    const res = await batchGt(null, null, 2, null, "low", undefined, (e) => {
      if ("index" in e) indices.push(e.index);
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.batches).toHaveLength(2);
    expect(indices).toEqual([0, 0, 1, 1]);
  });
});


describe("GT interrupted streams", () => {
  it("returns an error when a single generation stream disconnects", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
      new ReadableStream({ pull(controller) { controller.error(new TypeError("connection lost")); } }),
    ));
    try {
      const result = await generateGt({ title: "t", theme: "x", panels: [] });
      expect(result).toEqual({ ok: false, kind: "error", message: expect.stringMatching(/stream|connection/i) });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("preserves completed pairs when a batch stream disconnects", async () => {
    let sent = false;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
      new ReadableStream({
        pull(controller) {
          if (sent) { controller.error(new TypeError("connection lost")); return; }
          sent = true;
          controller.enqueue(new TextEncoder().encode(JSON.stringify({
            type: "done", index: 0, pair: { id: "a-1", front_url: "/g/a", back_url: "/g/b" },
          }) + "\n"));
        },
      }),
    ));
    try {
      const result = await batchGt(null, null, 2);
      expect(result).toEqual({
        ok: false, message: expect.stringMatching(/stream|connection/i),
        completed: [expect.objectContaining({ id: "a-1", frontUrl: `${API}/g/a` })],
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
