import { test, expect } from "../fixtures";
import { readBridge } from "../helpers/bridge";
import { sel } from "../helpers/selectors";

test.describe("spaces", () => {
  test("creating a space via the dialog adds it to the sidebar", async ({
    page,
  }) => {
    await page.getByTestId(sel.spacesAdd).click();
    await expect(page.getByTestId(sel.spaceCreate.root)).toBeVisible();
    await page.getByTestId(sel.spaceCreate.name).fill("Engineering");
    await page.getByTestId(sel.spaceCreate.prefix).fill("eng");
    await page.getByTestId(sel.spaceCreate.save).click();

    await expect(page.getByText("No spaces yet")).toHaveCount(0);
    const state = await readBridge(page);
    const spaces = state["spaces"] as Array<[string, { name: string }]>;
    expect(spaces[0][1].name).toBe("Engineering");
    await expect(page.getByTestId(sel.spaceRow(spaces[0][0]))).toBeVisible();
  });

  test("the newly-created space becomes the active space", async ({ page }) => {
    await page.getByTestId(sel.spacesAdd).click();
    await page.getByTestId(sel.spaceCreate.name).fill("Atelier");
    await page.getByTestId(sel.spaceCreate.prefix).fill("at");
    await page.getByTestId(sel.spaceCreate.save).click();

    const state = await readBridge(page);
    const spaces = state["spaces"] as Array<[string, { name: string }]>;
    expect(spaces).toHaveLength(1);
    expect(spaces[0][1].name).toBe("Atelier");

    await expect(page.getByTestId(sel.spaceRow(spaces[0][0]))).toHaveAttribute(
      "aria-label",
      /Atelier \(active space\)/,
    );
  });

  test("opening a space's settings shows its name in the URL/title context", async ({
    page,
  }) => {
    await page.getByTestId(sel.spacesAdd).click();
    await page.getByTestId(sel.spaceCreate.name).fill("Studio");
    await page.getByTestId(sel.spaceCreate.prefix).fill("st");
    await page.getByTestId(sel.spaceCreate.save).click();
    // Dialog dismisses on success — wait for it to actually leave the
    // tree before targeting the sidebar row so we don't race against
    // RAC's exit animation.
    await expect(page.getByTestId(sel.spaceCreate.root)).toHaveCount(0);

    const state = await readBridge(page);
    const spaces = state["spaces"] as Array<[string, unknown]>;
    const spaceId = spaces[0][0];

    // The `<li>` ancestor carries `aria-disabled="true"` from dnd-kit's
    // sortable activator, which Playwright treats as disabled. Force the
    // click because the keyboard-drag affordance is irrelevant here —
    // we're driving the inner label-button, not the activator.
    await page.getByTestId(sel.spaceRow(spaceId)).click({ force: true });
    await expect(page).toHaveURL(new RegExp(`/spaces/${spaceId}/settings$`));
  });

  test("cancelling the create dialog does not add a space", async ({ page }) => {
    await page.getByTestId(sel.spacesAdd).click();
    await page.getByTestId(sel.spaceCreate.name).fill("Aborted");
    await page.getByTestId(sel.spaceCreate.cancel).click();
    await expect(page.getByText("No spaces yet")).toBeVisible();
  });
});
