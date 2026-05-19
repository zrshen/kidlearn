import { http, HttpResponse } from "msw";

const API = "http://localhost:8000";

export const handlers = [
  http.get(`${API}/api/used-words`, () =>
    HttpResponse.json({ words: ["alpha", "beta", "gamma"], count: 3 })
  ),
  http.post(`${API}/api/generate`, async () =>
    HttpResponse.json({ image_url: "/generated/image-carrot.png" })
  ),
];
