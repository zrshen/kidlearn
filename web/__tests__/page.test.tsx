import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "./setup";
import Page from "../app/page";

const API = "http://localhost:8000";

const ROWS = [
  { word: "carrot", sentence: "A rabbit eats a carrot." },
  { word: "tomato", sentence: "The tomato is red." },
  { word: "grapes", sentence: "I share my grapes." },
  { word: "potato", sentence: "We bake a potato." },
  { word: "broccoli", sentence: "I dip broccoli." },
  { word: "kiwi", sentence: "A kiwi is green." },
];

const SUGGEST_ITEMS = [
  { word: "tiger", sentence: "A tiger roars loud." },
  { word: "zebra", sentence: "Zebras have stripes." },
  { word: "giraffe", sentence: "A giraffe is tall." },
  { word: "fox", sentence: "The fox runs fast." },
  { word: "panda", sentence: "A panda eats bamboo." },
  { word: "owl", sentence: "An owl hoots at night." },
];

async function fillAllRows(user: ReturnType<typeof userEvent.setup>) {
  const wordInputs = screen.getAllByPlaceholderText("word");
  const sentInputs = screen.getAllByPlaceholderText("sentence");
  for (let i = 0; i < 6; i++) {
    await user.type(wordInputs[i], ROWS[i].word);
    await user.type(sentInputs[i], ROWS[i].sentence);
  }
}

describe("Page", () => {
  it("button label reads 'Suggest & Generate' when rows are empty and 'Generate' when filled", async () => {
    const user = userEvent.setup();
    render(<Page />);
    const btn = await screen.findByRole("button", { name: /suggest & generate/i });
    expect(btn).toBeEnabled();

    await fillAllRows(user);
    expect(screen.getByRole("button", { name: /^generate$/i })).toBeEnabled();
  });

  it("filled rows: clicking Generate goes straight to /api/generate (no suggest call)", async () => {
    let suggestCalled = 0;
    let generateCalled = 0;
    mswServer.use(
      http.post(`${API}/api/suggest`, () => {
        suggestCalled++;
        return HttpResponse.json({ items: SUGGEST_ITEMS });
      }),
      http.post(`${API}/api/generate`, () => {
        generateCalled++;
        return HttpResponse.json({ image_url_path: "/generated/image-carrot.png" });
      }),
    );
    const user = userEvent.setup();
    render(<Page />);
    await fillAllRows(user);
    await user.click(screen.getByRole("button", { name: /^generate$/i }));
    await waitFor(() => expect(generateCalled).toBe(1));
    expect(suggestCalled).toBe(0);
  });

  it("empty rows: clicking the combined button suggests then generates", async () => {
    let suggestCalled = 0;
    let generateCalled = 0;
    let generateBody: { items: Array<{ word: string }> } | null = null;
    mswServer.use(
      http.post(`${API}/api/suggest`, () => {
        suggestCalled++;
        return HttpResponse.json({ items: SUGGEST_ITEMS });
      }),
      http.post(`${API}/api/generate`, async ({ request }) => {
        generateCalled++;
        generateBody = (await request.json()) as { items: Array<{ word: string }> };
        return HttpResponse.json({ image_url_path: "/generated/image-tiger.png" });
      }),
    );
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: /suggest & generate/i }));

    await waitFor(() => {
      expect(suggestCalled).toBe(1);
      expect(generateCalled).toBe(1);
    });
    expect(generateBody!.items.map((i) => i.word)).toEqual([
      "tiger", "zebra", "giraffe", "fox", "panda", "owl",
    ]);
    // Rows show the suggested words
    const wordInputs = screen.getAllByPlaceholderText("word") as HTMLInputElement[];
    expect(wordInputs[0].value).toBe("tiger");
    expect(wordInputs[5].value).toBe("owl");
  });

  it("empty rows + suggest fails: shows error and does NOT call generate", async () => {
    let generateCalled = 0;
    mswServer.use(
      http.post(`${API}/api/suggest`, () =>
        HttpResponse.json({ error: "Couldn't generate suggestions: x" }, { status: 502 }),
      ),
      http.post(`${API}/api/generate`, () => {
        generateCalled++;
        return HttpResponse.json({ image_url_path: "/generated/x.png" });
      }),
    );
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: /suggest & generate/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn't generate suggestions/i);
    expect(generateCalled).toBe(0);
    // Rows still empty
    const wordInputs = screen.getAllByPlaceholderText("word") as HTMLInputElement[];
    expect(wordInputs[0].value).toBe("");
  });

  it("shows the conflict banner and highlights conflicting rows on 409", async () => {
    mswServer.use(
      http.post(`${API}/api/generate`, () =>
        HttpResponse.json({ conflicts: ["carrot", "potato"] }, { status: 409 }),
      ),
    );
    const user = userEvent.setup();
    render(<Page />);
    await fillAllRows(user);
    await user.click(screen.getByRole("button", { name: /^generate$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/carrot/);
    expect(alert.textContent).toMatch(/potato/);
    expect(screen.getByTestId("row-0").className).toMatch(/conflict/);
    expect(screen.getByTestId("row-3").className).toMatch(/conflict/);
    expect(screen.getByTestId("row-1").className).not.toMatch(/conflict/);
  });

  it("shows a network-error banner when the server is unreachable", async () => {
    mswServer.use(http.post(`${API}/api/generate`, () => HttpResponse.error()));
    const user = userEvent.setup();
    render(<Page />);
    await fillAllRows(user);
    await user.click(screen.getByRole("button", { name: /^generate$/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Could not reach server/i);
  });

  it("shows a load-error banner when the initial used-words fetch fails", async () => {
    mswServer.use(http.get(`${API}/api/used-words`, () => HttpResponse.error()));
    render(<Page />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/Could not load used words/i);
  });

  it("clears the stale preview when a new Generate starts", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await fillAllRows(user);
    await user.click(screen.getByRole("button", { name: /^generate$/i }));
    await waitFor(() => expect(screen.queryByTestId("preview")).toBeInTheDocument());

    mswServer.use(http.post(`${API}/api/generate`, () => HttpResponse.error()));
    await user.click(screen.getByRole("button", { name: /^generate$/i }));
    await waitFor(() => expect(screen.queryByTestId("preview")).not.toBeInTheDocument());
  });

  it("disables the combined button while a slow Batch request is in flight", async () => {
    let resolveBatch: (() => void) | undefined;
    mswServer.use(
      http.post(`${API}/api/batch`, async () => {
        await new Promise<void>((res) => { resolveBatch = res; });
        return HttpResponse.json({ batches: [] });
      }),
    );
    const user = userEvent.setup();
    render(<Page />);
    await screen.findByText("Used Words");

    await user.click(screen.getByRole("button", { name: /batch generate/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /suggest & generate/i })).toBeDisabled();
    });

    resolveBatch?.();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /suggest & generate/i })).not.toBeDisabled();
    });
  });

  it("Batch (N=2) renders batch tiles and hides the single preview", async () => {
    mswServer.use(
      http.post(`${API}/api/batch`, () =>
        HttpResponse.json({
          batches: [
            { image_url: "/generated/image-tiger.png", words: ["tiger", "zebra", "fox", "owl", "panda", "giraffe"] },
            { image_url: "/generated/image-carrot.png", words: ["carrot", "tomato", "grapes", "potato", "broccoli", "kiwi"] },
          ],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<Page />);
    // getByRole filters hidden nodes, so this selects the visible flashcard
    // batch input rather than the always-mounted (hidden) GtView one.
    const numInput = screen.getByRole("spinbutton", { name: /batches/i }) as HTMLInputElement;
    await user.clear(numInput);
    await user.type(numInput, "2");
    await user.click(screen.getByRole("button", { name: /batch generate/i }));

    await waitFor(() => {
      expect(screen.getByTestId("batch-preview-0")).toBeInTheDocument();
      expect(screen.getByTestId("batch-preview-1")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
  });
});
