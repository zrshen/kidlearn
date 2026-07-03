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
