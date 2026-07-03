import { http, HttpResponse } from "msw";

const API = "http://localhost:8000";

export const handlers = [
  http.get(`${API}/api/used-words`, () =>
    HttpResponse.json({ words: ["alpha", "beta", "gamma"], count: 3 })
  ),
  http.post(`${API}/api/generate`, async () =>
    HttpResponse.json({ image_url: "/generated/image-carrot.png" })
  ),
  http.post(`${API}/api/gt/suggest`, () =>
    HttpResponse.json({ spec: { title: "Kindergarten GT Thinking Practice", theme: "fruits", panels: [] } })
  ),
  http.post(`${API}/api/gt/generate`, () =>
    HttpResponse.json({ id: "fruits-1", front_url: "/generated/gt-fruits-1-front.png", back_url: "/generated/gt-fruits-1-back.png" })
  ),
  http.get(`${API}/api/gt/generated`, () => HttpResponse.json({ items: [] })),
  http.post(`${API}/api/gt/batch`, async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { n?: number };
    const n = body.n ?? 1;
    const batches = Array.from({ length: n }, (_, i) => ({
      id: `fruits-${i + 1}`,
      theme: "fruits",
      test: "",
      front_url: `/generated/gt-fruits-${i + 1}-front.png`,
      back_url: `/generated/gt-fruits-${i + 1}-back.png`,
    }));
    return HttpResponse.json({ batches });
  }),
  http.post(`${API}/api/gt/generated/delete`, async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as { ids?: string[] };
    return HttpResponse.json({ deleted: body.ids ?? [] });
  }),
];
