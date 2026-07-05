import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GtView } from "../components/GtView";
import Page from "../app/page";

describe("GtView", () => {
  it("renders the stacked front and back preview after Suggest & Generate", async () => {
    const user = userEvent.setup();
    render(<GtView topic="fruits" quality="low" />);
    await user.click(screen.getByRole("button", { name: /suggest & generate/i }));
    await waitFor(() => {
      expect(screen.getByTestId("gt-front")).toBeInTheDocument();
      expect(screen.getByTestId("gt-back")).toBeInTheDocument();
    });
    expect((screen.getByTestId("gt-front") as HTMLImageElement).src).toMatch(/gt-fruits-1-front\.png/);
    expect((screen.getByTestId("gt-back") as HTMLImageElement).src).toMatch(/gt-fruits-1-back\.png/);
  });

  it("shows a step-by-step progress log during Suggest & Generate", async () => {
    const { http } = await import("msw");
    const { mswServer } = await import("./setup");
    const { ndjson } = await import("./handlers");
    mswServer.use(
      http.post("http://localhost:8000/api/gt/generate", () =>
        ndjson([
          { type: "generate", side: "front", attempt: 1 },
          { type: "verify_result", side: "front", attempt: 1, passed: true, mismatches: [] },
          { type: "generate", side: "back", attempt: 1 },
          { type: "verify_result", side: "back", attempt: 1, passed: true, mismatches: [] },
          {
            type: "done",
            pair: { id: "fruits-1", front_url: "/generated/gt-fruits-1-front.png", back_url: "/generated/gt-fruits-1-back.png" },
          },
        ]),
      ),
    );
    const user = userEvent.setup();
    render(<GtView topic="fruits" quality="low" />);
    await user.click(screen.getByRole("button", { name: /suggest & generate/i }));
    await screen.findByTestId("gt-front");
    const log = screen.getByTestId("gt-progress-log");
    expect(log.textContent).toMatch(/front page verified/i);
    expect(log.textContent).toMatch(/back page verified/i);
    expect(log.textContent).toMatch(/done/i);
  });

  it("keeps the progress log visible after generation completes", async () => {
    const user = userEvent.setup();
    render(<GtView topic="fruits" quality="low" />);
    await user.click(screen.getByRole("button", { name: /suggest & generate/i }));
    await screen.findByTestId("gt-front");
    expect(screen.getByTestId("gt-progress-log")).toBeInTheDocument();
  });

  it("shows an error banner when suggest fails", async () => {
    const { http, HttpResponse } = await import("msw");
    const { mswServer } = await import("./setup");
    mswServer.use(
      http.post("http://localhost:8000/api/gt/suggest", () =>
        HttpResponse.json({ error: "Couldn't generate GT worksheet: boom" }, { status: 502 }),
      ),
    );
    const user = userEvent.setup();
    render(<GtView topic="" quality="medium" />);
    await user.click(screen.getByRole("button", { name: /suggest & generate/i }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/boom/i);
  });

  it("forwards the selected test focus to /api/gt/suggest", async () => {
    const { http, HttpResponse } = await import("msw");
    const { mswServer } = await import("./setup");
    let body: { test: string | null } | null = null;
    mswServer.use(
      http.post("http://localhost:8000/api/gt/suggest", async ({ request }) => {
        body = (await request.json()) as { test: string | null };
        return HttpResponse.json({ spec: { title: "t", theme: "x", test: "CogAT", panels: [] } });
      }),
    );
    const user = userEvent.setup();
    render(<GtView topic="" quality="medium" />);
    await user.click(screen.getByRole("button", { name: /^cogat$/i }));
    await user.click(screen.getByRole("button", { name: /suggest & generate/i }));
    await waitFor(() => expect(body?.test).toBe("cogat"));
  });

  it("forwards a custom test name typed in the Other field", async () => {
    const { http, HttpResponse } = await import("msw");
    const { mswServer } = await import("./setup");
    let body: { test: string | null } | null = null;
    mswServer.use(
      http.post("http://localhost:8000/api/gt/suggest", async ({ request }) => {
        body = (await request.json()) as { test: string | null };
        return HttpResponse.json({ spec: { title: "t", theme: "x", panels: [] } });
      }),
    );
    const user = userEvent.setup();
    render(<GtView topic="" quality="medium" />);
    await user.type(screen.getByLabelText(/other test/i), "Iowa Assessments");
    await user.click(screen.getByRole("button", { name: /suggest & generate/i }));
    await waitFor(() => expect(body?.test).toBe("Iowa Assessments"));
  });

  it("forwards the chosen panel count to /api/gt/suggest (defaults to 4)", async () => {
    const { http, HttpResponse } = await import("msw");
    const { mswServer } = await import("./setup");
    let body: { panels: number | null } | null = null;
    mswServer.use(
      http.post("http://localhost:8000/api/gt/suggest", async ({ request }) => {
        body = (await request.json()) as { panels: number | null };
        return HttpResponse.json({ spec: { title: "t", theme: "x", panels: [] } });
      }),
    );
    const user = userEvent.setup();
    render(<GtView topic="" quality="medium" />);
    expect((screen.getByLabelText(/panels per worksheet/i) as HTMLInputElement).value).toBe("4");
    await user.click(screen.getByRole("button", { name: /suggest & generate/i }));
    await waitFor(() => expect(body?.panels).toBe(4));
  });

  it("clamps an out-of-range panel count on blur so the field matches what is sent", async () => {
    const user = userEvent.setup();
    render(<GtView topic="" quality="medium" />);
    const input = screen.getByLabelText(/panels per worksheet/i) as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "8");
    expect(input.value).toBe("8");
    await user.tab(); // blur
    expect(input.value).toBe("6");
  });

  it("renders batch thumbnails after Batch Generate", async () => {
    const user = userEvent.setup();
    render(<GtView topic="fruits" quality="low" />);
    await user.click(screen.getByRole("button", { name: /batch generate/i }));
    await waitFor(() => {
      expect(screen.getByTestId("gt-batch-0")).toBeInTheDocument();
    });
  });

  it("still notifies onGenerated when a batch partially fails, so history refreshes", async () => {
    const { http } = await import("msw");
    const { mswServer } = await import("./setup");
    const { ndjson } = await import("./handlers");
    mswServer.use(
      http.post("http://localhost:8000/api/gt/batch", () =>
        ndjson([
          {
            type: "done",
            index: 0,
            pair: { id: "a-1", front_url: "/generated/gt-a-1-front.png", back_url: "/generated/gt-a-1-back.png" },
          },
          { type: "error", message: "Batch 2 of 2 failed: boom" },
        ]),
      ),
    );
    const onGenerated = vi.fn();
    const user = userEvent.setup();
    render(<GtView topic="fruits" quality="low" onGenerated={onGenerated} />);
    const batchInput = screen.getByLabelText(/batches/i);
    await user.clear(batchInput);
    await user.type(batchInput, "2");
    await user.click(screen.getByRole("button", { name: /batch generate/i }));
    await screen.findByTestId("gt-batch-0");
    await waitFor(() => expect(onGenerated).toHaveBeenCalledTimes(1));
  });

  it("prints questions only when Print questions is clicked", async () => {
    const printSpy = vi.spyOn(window, "print").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<GtView topic="fruits" quality="low" />);
    await user.click(screen.getByRole("button", { name: /suggest & generate/i }));
    await screen.findByTestId("gt-front");
    await user.click(screen.getByRole("button", { name: /print questions/i }));
    expect(printSpy).toHaveBeenCalled();
    printSpy.mockRestore();
  });

  it("displays a pair passed in via selectedPair (history selection)", async () => {
    const pair = {
      id: "ocean-1",
      theme: "ocean",
      test: "CogAT",
      frontUrl: "http://x/gt-ocean-1-front.png",
      backUrl: "http://x/gt-ocean-1-back.png",
    };
    render(<GtView topic="" quality="medium" selectedPair={pair} />);
    await waitFor(() => {
      expect((screen.getByTestId("gt-front") as HTMLImageElement).src).toMatch(/gt-ocean-1-front\.png/);
      expect((screen.getByTestId("gt-back") as HTMLImageElement).src).toMatch(/gt-ocean-1-back\.png/);
    });
  });

  it("shows a pending placeholder with a live status while a batch item is still generating", async () => {
    const { http, HttpResponse } = await import("msw");
    const { mswServer } = await import("./setup");
    let releaseSecond: () => void = () => {};
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    mswServer.use(
      http.post("http://localhost:8000/api/gt/batch", async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "done",
                  index: 0,
                  pair: { id: "a-1", front_url: "/generated/gt-a-1-front.png", back_url: "/generated/gt-a-1-back.png" },
                }) + "\n",
              ),
            );
            controller.enqueue(encoder.encode(JSON.stringify({ type: "generate", side: "front", attempt: 1, index: 1 }) + "\n"));
            await secondGate;
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "done",
                  index: 1,
                  pair: { id: "a-2", front_url: "/generated/gt-a-2-front.png", back_url: "/generated/gt-a-2-back.png" },
                }) + "\n",
              ),
            );
            controller.enqueue(encoder.encode(JSON.stringify({ type: "batch_done" }) + "\n"));
            controller.close();
          },
        });
        return new HttpResponse(stream, { headers: { "Content-Type": "application/x-ndjson" } });
      }),
    );
    const user = userEvent.setup();
    render(<GtView topic="fruits" quality="low" />);
    const batchInput = screen.getByLabelText(/batches/i);
    await user.clear(batchInput);
    await user.type(batchInput, "2");
    await user.click(screen.getByRole("button", { name: /batch generate/i }));
    await screen.findByTestId("gt-batch-0");
    await waitFor(() => expect(screen.getByTestId("gt-batch-pending-1").textContent).toMatch(/drawing front/i));
    releaseSecond();
    await waitFor(() => expect(screen.getByTestId("gt-batch-1")).toBeInTheDocument());
  });
});

describe("worksheet type switcher", () => {
  it("switches to GT mode, hides flashcard input rows, and disables the word library", async () => {
    const user = userEvent.setup();
    render(<Page />);
    await screen.findByRole("button", { name: /suggest & generate/i });
    await user.click(screen.getByRole("tab", { name: /gt thinking/i }));
    expect(screen.queryByPlaceholderText("word")).not.toBeInTheDocument();
    expect(screen.getByText(/flashcard mode only/i)).toBeInTheDocument();
  });
});
