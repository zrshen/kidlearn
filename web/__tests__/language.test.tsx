import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "./setup";
import { ndjson } from "./handlers";
import { GtView } from "../components/GtView";
import Page from "../app/page";
import { batchGenerate, suggestGt, batchGt } from "../app/api";
import { UsedWordsSidebar } from "../components/UsedWordsSidebar";

const API = "http://localhost:8000";

describe("worksheet language", () => {
  beforeEach(() => mswServer.use(http.get(`${API}/api/generated`, () => HttpResponse.json({ items: [] }))));
  it("sends Chinese for flashcard suggestions and generation, clearing old content on change", async () => {
    const requests: { language?: string }[] = [];
    mswServer.use(
      http.post(`${API}/api/suggest`, async ({ request }) => {
        requests.push(await request.json() as { language?: string });
        return HttpResponse.json({ items: Array.from({ length: 6 }, () => ({ word: "苹果", sentence: "苹果很好吃。" })) });
      }),
      http.post(`${API}/api/generate`, async ({ request }) => {
        requests.push(await request.json() as { language?: string });
        return HttpResponse.json({ image_url: "/generated/image-苹果.png" });
      }),
    );
    const user = userEvent.setup();
    render(<Page />);
    const selector = screen.getByRole("combobox", { name: /worksheet language/i });
    expect(selector).toHaveValue("en");
    await user.type(screen.getAllByPlaceholderText("word")[0], "cat");
    await user.selectOptions(selector, "zh-CN");
    expect(screen.getAllByPlaceholderText("word")[0]).toHaveValue("");
    await user.click(screen.getByRole("button", { name: /suggest & generate/i }));
    await screen.findByTestId("preview");
    expect(requests.map((r) => r.language)).toEqual(["zh-CN", "zh-CN"]);
    await user.selectOptions(selector, "en");
    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
    expect(screen.getAllByPlaceholderText("word")[0]).toHaveValue("");
  });

  it("forwards language through both batch APIs and GT suggestions", async () => {
    const languages: string[] = [];
    for (const endpoint of ["batch", "gt/suggest", "gt/batch"]) {
      mswServer.use(http.post(`${API}/api/${endpoint}`, async ({ request }) => {
        const body = await request.json() as { language: string };
        languages.push(body.language);
        if (endpoint === "gt/batch") return ndjson([{ type: "batch_done" }]);
        if (endpoint === "batch") return HttpResponse.json({ batches: [] });
        return HttpResponse.json({ spec: { language: "zh-CN", title: "思维练习", theme: "水果", panels: [] } });
      }));
    }
    await batchGenerate(null, 1, "low", undefined, "zh-CN");
    await suggestGt(null, null, 4, undefined, "zh-CN");
    await batchGt(null, null, 1, 4, "low", undefined, undefined, "zh-CN");
    expect(languages).toEqual(["zh-CN", "zh-CN", "zh-CN"]);
  });

  it("groups Chinese library entries together", () => {
    render(<UsedWordsSidebar words={["apple", "苹果", "香蕉"]} />);
    expect(screen.getByRole("heading", { name: "Chinese" })).toBeInTheDocument();
    expect(screen.getByText("苹果")).toBeInTheDocument();
    expect(screen.getByText("香蕉")).toBeInTheDocument();
  });

  it("locks language selection during GT work and clears previews on language change", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mswServer.use(http.post(`${API}/api/gt/suggest`, async ({ request }) => {
      const body = await request.json() as { language: string };
      expect(body.language).toBe("zh-CN");
      await gate;
      return HttpResponse.json({ spec: { language: "zh-CN", title: "思维练习", theme: "水果", panels: [] } });
    }));
    const user = userEvent.setup();
    render(<Page />);
    const selector = screen.getByRole("combobox", { name: /worksheet language/i });
    await user.selectOptions(selector, "zh-CN");
    await user.click(screen.getByRole("tab", { name: /gt thinking/i }));
    await user.click(screen.getByRole("button", { name: /suggest & generate/i }));
    await waitFor(() => expect(selector).toBeDisabled());
    release();
    await screen.findByTestId("gt-front");
    await waitFor(() => expect(selector).toBeEnabled());
    await user.selectOptions(selector, "en");
    expect(screen.queryByTestId("gt-front")).not.toBeInTheDocument();
  });
  it("preserves batch counts when changing language", async () => {
    const user = userEvent.setup();
    render(<Page />);
    const input = screen.getByRole("spinbutton", { name: /batches/i });
    await user.clear(input);
    await user.type(input, "2");
    await user.selectOptions(screen.getByRole("combobox", { name: /worksheet language/i }), "zh-CN");
    expect(screen.getByRole("spinbutton", { name: /batches/i })).toHaveValue(2);
  });

  it("clears GT results while preserving test focus, panels, and batch count", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<GtView topic="" quality="low" language="en" />);
    await user.click(screen.getByRole("button", { name: "CogAT" }));
    const panels = screen.getByLabelText(/panels per worksheet/i);
    await user.clear(panels);
    await user.type(panels, "5");
    const batches = screen.getByRole("spinbutton", { name: /batches/i });
    await user.clear(batches);
    await user.type(batches, "2");
    await user.click(screen.getByRole("button", { name: /suggest & generate/i }));
    await screen.findByTestId("gt-front");
    rerender(<GtView topic="" quality="low" language="zh-CN" />);
    await waitFor(() => expect(screen.queryByTestId("gt-front")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "CogAT" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText(/panels per worksheet/i)).toHaveValue(5);
    expect(screen.getByRole("spinbutton", { name: /batches/i })).toHaveValue(2);
  });

  it("shows Chinese archive badges without changing the current language", async () => {
    mswServer.use(http.get(`${API}/api/gt/generated`, () => HttpResponse.json({ items: [{
      id: "gt-cn", theme: "水果", test: "General GT", language: "zh-CN", mtime: 1,
      front_url: "/generated/front-cn.png", back_url: "/generated/back-cn.png",
      spec: { language: "zh-CN", title: "思维练习", theme: "水果", panels: [] },
    }] })));
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("tab", { name: /gt thinking/i }));
    await user.click(await screen.findByRole("button", { name: /水果/, pressed: false }));
    await screen.findByTestId("gt-front");
    expect(screen.getByText("中文 + 拼音")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /worksheet language/i })).toHaveValue("en");
  });

  it.each(["苹果", "100%"])("deletes an archived %s worksheet and clears its preview", async (word) => {
    let deleted = false;
    mswServer.use(
      http.get(`${API}/api/generated`, () => HttpResponse.json({ items: deleted ? [] : [{
        filename: `image-${word}.png`, url: `/generated/image-${word}.png`, word, words: [word],
        language: "zh-CN", has_metadata: true, mtime: 1,
      }] })),
      http.post(`${API}/api/generated/delete`, () => {
        deleted = true;
        return HttpResponse.json({ deleted: [`image-${word}.png`], released_words: [word] });
      }),
    );
    const user = userEvent.setup();
    render(<Page />);
    await user.click(await screen.findByRole("button", { name: new RegExp(`worksheet starting with ${word}`) }));
    await screen.findByTestId("preview");
    await user.click(screen.getByRole("button", { name: `Delete worksheet ${word}` }));
    await waitFor(() => expect(screen.queryByTestId("preview")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: `Delete worksheet ${word}` })).not.toBeInTheDocument();
  });

});
