import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const USED_WORDS_PATH = path.resolve(__dirname, "../../used_words.json");
const SEED = JSON.stringify(["alpha", "beta"]) + "\n";

test.beforeEach(() => {
  fs.writeFileSync(USED_WORDS_PATH, SEED);
});

const ROWS = [
  { word: "carrot", sentence: "A rabbit eats a carrot." },
  { word: "tomato", sentence: "The tomato is red." },
  { word: "grapes", sentence: "I share my grapes." },
  { word: "potato", sentence: "We bake a potato." },
  { word: "broccoli", sentence: "I dip broccoli." },
  { word: "kiwi", sentence: "A kiwi is green." },
];

test("generate happy path", async ({ page }) => {
  // Install the print spy BEFORE the page loads so it survives navigation.
  await page.addInitScript(() => {
    (window as unknown as { __printCalled: boolean }).__printCalled = false;
    window.print = () => {
      (window as unknown as { __printCalled: boolean }).__printCalled = true;
    };
  });

  await page.goto("/");

  await expect(page.getByText("Used Words")).toBeVisible();
  await expect(page.getByText("(2)")).toBeVisible();

  const wordInputs = page.getByPlaceholder("word");
  const sentInputs = page.getByPlaceholder("sentence");
  for (let i = 0; i < 6; i++) {
    await wordInputs.nth(i).fill(ROWS[i].word);
    await sentInputs.nth(i).fill(ROWS[i].sentence);
  }

  await page.getByRole("button", { name: "Generate", exact: true }).click();

  const preview = page.getByTestId("preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", /\/generated\/image-carrot\.png$/);
  await expect(page.getByText("(8)")).toBeVisible();

  await page.getByRole("button", { name: "Print" }).click();
  const printed = await page.evaluate(
    () => (window as unknown as { __printCalled: boolean }).__printCalled,
  );
  expect(printed).toBe(true);
});

test("empty rows: combined Suggest & Generate fills rows and renders preview", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __printCalled: boolean }).__printCalled = false;
    window.print = () => {
      (window as unknown as { __printCalled: boolean }).__printCalled = true;
    };
  });

  await page.goto("/");
  await expect(page.getByText("Used Words")).toBeVisible();

  await page.getByPlaceholder(/animals/i).fill("wildlife");
  await page.getByRole("button", { name: /Suggest & Generate/ }).click();

  // Suggest stub returns: tiger, zebra, giraffe, fox, panda, owl
  await expect(page.getByPlaceholder("word").nth(0)).toHaveValue("tiger");
  await expect(page.getByPlaceholder("word").nth(5)).toHaveValue("owl");

  const preview = page.getByTestId("preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("src", /\/generated\/image-tiger\.png$/);
});

test("batch N=1 renders one tile and hides the single preview", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Used Words")).toBeVisible();

  // Set N=1 explicitly (default is 1, but exercise the input)
  const num = page.getByLabel(/batches/i);
  await num.fill("1");

  await page.getByRole("button", { name: /Batch Generate/ }).click();

  // The stub returns tiger as first word, so the image will be image-tiger.png
  const tile = page.getByTestId("batch-preview-0");
  await expect(tile).toBeVisible();
  await expect(tile).toHaveAttribute("src", /\/generated\/image-tiger\.png$/);

  // Single-preview slot should not be present
  await expect(page.getByTestId("preview")).toHaveCount(0);

  // Used words grew (2 + 6 = 8)
  await expect(page.getByText("(8)")).toBeVisible();
});
