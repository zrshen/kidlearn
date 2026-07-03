import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "./setup";
import { suggestGt, generateGt } from "../app/api";

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
