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
];
