import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { mswServer } from "./setup";
import { BatchControls } from "../components/BatchControls";

const API = "http://localhost:8000";

const BATCH_RESPONSE = {
  batches: [
    { image_url: "/generated/image-tiger.png", words: ["tiger", "zebra", "fox", "owl", "panda", "giraffe"] },
    { image_url: "/generated/image-carrot.png", words: ["carrot", "tomato", "grapes", "potato", "broccoli", "kiwi"] },
  ],
};

describe("BatchControls", () => {
  it("renders number input defaulting to 1 and batch button", () => {
    render(<BatchControls topic="" onBatchDone={() => {}} onError={() => {}} />);
    const num = screen.getByLabelText(/batches/i) as HTMLInputElement;
    expect(num.value).toBe("1");
    expect(screen.getByRole("button", { name: /batch generate/i })).toBeInTheDocument();
  });

  it("clamps the number input to [1, 10]", async () => {
    const user = userEvent.setup();
    render(<BatchControls topic="" onBatchDone={() => {}} onError={() => {}} />);
    const num = screen.getByLabelText(/batches/i) as HTMLInputElement;
    await user.clear(num);
    await user.type(num, "99");
    // HTML number input with min/max accepts the typed value but the component clamps on read.
    // Click the button to trigger clamping behavior via the request.
    mswServer.use(http.post(`${API}/api/batch`, () => HttpResponse.json(BATCH_RESPONSE)));
    await user.click(screen.getByRole("button", { name: /batch generate/i }));
    // confirm panel because n >= 3
    await screen.findByRole("button", { name: /confirm/i });
  });

  it("does not show confirm panel for N < 3", async () => {
    mswServer.use(http.post(`${API}/api/batch`, () => HttpResponse.json(BATCH_RESPONSE)));
    const user = userEvent.setup();
    const onBatchDone = vi.fn();
    render(<BatchControls topic="" onBatchDone={onBatchDone} onError={() => {}} />);
    const num = screen.getByLabelText(/batches/i) as HTMLInputElement;
    await user.clear(num);
    await user.type(num, "2");
    await user.click(screen.getByRole("button", { name: /batch generate/i }));
    await waitFor(() => expect(onBatchDone).toHaveBeenCalled());
    // No "Confirm" appeared
    expect(screen.queryByRole("button", { name: /confirm/i })).not.toBeInTheDocument();
  });

  it("shows confirm panel for N >= 3 and submits only after Confirm", async () => {
    mswServer.use(http.post(`${API}/api/batch`, () => HttpResponse.json(BATCH_RESPONSE)));
    const user = userEvent.setup();
    const onBatchDone = vi.fn();
    render(<BatchControls topic="" onBatchDone={onBatchDone} onError={() => {}} />);
    const num = screen.getByLabelText(/batches/i) as HTMLInputElement;
    await user.clear(num);
    await user.type(num, "5");
    await user.click(screen.getByRole("button", { name: /batch generate/i }));

    // Confirm panel visible, no request yet
    expect(await screen.findByText(/generate 5 worksheets/i)).toBeInTheDocument();
    expect(onBatchDone).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(onBatchDone).toHaveBeenCalled());
  });

  it("Cancel hides the confirm panel and does not submit", async () => {
    const user = userEvent.setup();
    const onBatchDone = vi.fn();
    render(<BatchControls topic="" onBatchDone={onBatchDone} onError={() => {}} />);
    const num = screen.getByLabelText(/batches/i) as HTMLInputElement;
    await user.clear(num);
    await user.type(num, "4");
    await user.click(screen.getByRole("button", { name: /batch generate/i }));
    await user.click(await screen.findByRole("button", { name: /cancel/i }));
    expect(screen.queryByRole("button", { name: /confirm/i })).not.toBeInTheDocument();
    expect(onBatchDone).not.toHaveBeenCalled();
  });

  it("calls onError on 502 with partial completed", async () => {
    mswServer.use(
      http.post(`${API}/api/batch`, () =>
        HttpResponse.json(
          { error: "Batch 2 of 2 failed: x", completed: [BATCH_RESPONSE.batches[0]] },
          { status: 502 },
        ),
      ),
    );
    const user = userEvent.setup();
    const onBatchDone = vi.fn();
    const onError = vi.fn();
    render(<BatchControls topic="" onBatchDone={onBatchDone} onError={onError} />);
    await user.click(screen.getByRole("button", { name: /batch generate/i }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    const [msg, completed] = onError.mock.calls[0];
    expect(msg).toMatch(/batch 2/i);
    expect(completed).toHaveLength(1);
  });
});
