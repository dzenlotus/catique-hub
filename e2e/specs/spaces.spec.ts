import { test, expect } from "../fixtures";
import { invokeBridge, readBridge } from "../helpers/bridge";
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

    await expect(page.getByText("No projects yet")).toHaveCount(0);
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
    await expect(page.getByText("No projects yet")).toBeVisible();
  });

  test("invalid prefix surfaces an error and Save stays disabled", async ({
    page,
  }) => {
    await page.getByTestId(sel.spacesAdd).click();
    await page.getByTestId(sel.spaceCreate.name).fill("Bad prefix");
    await page.getByTestId(sel.spaceCreate.prefix).fill("Has Caps");

    // Inline validation message under the prefix input.
    await expect(page.getByTestId(sel.spaceCreate.prefixError)).toBeVisible();
    // Save button is disabled until prefix passes validation.
    await expect(page.getByTestId(sel.spaceCreate.save)).toBeDisabled();

    // Fixing the prefix re-enables Save and lets the dialog complete.
    await page.getByTestId(sel.spaceCreate.prefix).fill("ok");
    await expect(page.getByTestId(sel.spaceCreate.save)).toBeEnabled();
    await page.getByTestId(sel.spaceCreate.save).click();
    await expect(page.getByTestId(sel.spaceCreate.root)).toHaveCount(0);

    const state = await readBridge(page);
    expect((state["spaces"] as unknown[]).length).toBe(1);
  });

  test("renaming a space from settings updates the sidebar", async ({
    page,
  }) => {
    // Drive entry creation via the dialog so the navigation side-effect
    // (active-space pinning + auto-redirect to /spaces/:id/settings on
    // click) happens through the real code path.
    await page.getByTestId(sel.spacesAdd).click();
    await page.getByTestId(sel.spaceCreate.name).fill("Old");
    await page.getByTestId(sel.spaceCreate.prefix).fill("old");
    await page.getByTestId(sel.spaceCreate.save).click();
    await expect(page.getByTestId(sel.spaceCreate.root)).toHaveCount(0);

    const before = await readBridge(page);
    const spaceId = (before["spaces"] as Array<[string, unknown]>)[0][0];
    await page.getByTestId(sel.spaceRow(spaceId)).click({ force: true });
    await expect(page.getByTestId(sel.spaceSettings.root)).toBeVisible();

    await page.getByTestId(sel.spaceSettings.nameInput).fill("Renamed");
    await page.getByTestId(sel.spaceSettings.save).click();
    await expect(page.getByTestId(sel.spaceSettings.saved)).toBeVisible();

    // Sidebar row's aria-label reflects the new name (and active state).
    await expect(page.getByTestId(sel.spaceRow(spaceId))).toHaveAttribute(
      "aria-label",
      /Renamed/,
    );
  });

  test("active space-id matches the most recently clicked sidebar row", async ({
    page,
  }) => {
    await page.getByTestId(sel.spacesAdd).click();
    await page.getByTestId(sel.spaceCreate.name).fill("First");
    await page.getByTestId(sel.spaceCreate.prefix).fill("first");
    await page.getByTestId(sel.spaceCreate.save).click();
    await expect(page.getByTestId(sel.spaceCreate.root)).toHaveCount(0);

    const state = await readBridge(page);
    const spaces = state["spaces"] as Array<[string, { name: string }]>;
    expect(spaces).toHaveLength(1);
    const spaceId = spaces[0][0];

    await expect(page.getByTestId(sel.spaceRow(spaceId))).toHaveAttribute(
      "aria-label",
      /First \(active space\)/,
    );
  });

  test("two spaces independently track their selected state", async ({
    page,
  }) => {
    // First space — becomes active on create.
    await page.getByTestId(sel.spacesAdd).click();
    await page.getByTestId(sel.spaceCreate.name).fill("Alpha");
    await page.getByTestId(sel.spaceCreate.prefix).fill("alpha");
    await page.getByTestId(sel.spaceCreate.save).click();
    await expect(page.getByTestId(sel.spaceCreate.root)).toHaveCount(0);

    // Second space — should take over active state on create.
    await page.getByTestId(sel.spacesAdd).click();
    await page.getByTestId(sel.spaceCreate.name).fill("Beta");
    await page.getByTestId(sel.spaceCreate.prefix).fill("beta");
    await page.getByTestId(sel.spaceCreate.save).click();
    await expect(page.getByTestId(sel.spaceCreate.root)).toHaveCount(0);

    const state = await readBridge(page);
    const spaces = state["spaces"] as Array<[string, { name: string }]>;
    const alpha = spaces.find(([, s]) => s.name === "Alpha");
    const beta = spaces.find(([, s]) => s.name === "Beta");
    if (!alpha || !beta) throw new Error("seed spaces missing");

    // Beta is the latest pick, so it's the active space; Alpha is not.
    await expect(page.getByTestId(sel.spaceRow(beta[0]))).toHaveAttribute(
      "aria-label",
      /Beta \(active space\)/,
    );
    await expect(page.getByTestId(sel.spaceRow(alpha[0]))).toHaveAttribute(
      "aria-label",
      /^Alpha$/,
    );

    // Clicking Alpha's row navigates to its settings AND flips active.
    await page.getByTestId(sel.spaceRow(alpha[0])).click({ force: true });
    await expect(page).toHaveURL(new RegExp(`/spaces/${alpha[0]}/settings$`));
    await expect(page.getByTestId(sel.spaceRow(alpha[0]))).toHaveAttribute(
      "aria-label",
      /Alpha \(active space\)/,
    );
  });

  test("space icon + name round-trip through settings persists to the bridge", async ({
    page,
  }) => {
    await page.getByTestId(sel.spacesAdd).click();
    await page.getByTestId(sel.spaceCreate.name).fill("Round trip");
    await page.getByTestId(sel.spaceCreate.prefix).fill("rt");
    await page.getByTestId(sel.spaceCreate.save).click();
    await expect(page.getByTestId(sel.spaceCreate.root)).toHaveCount(0);

    const state = await readBridge(page);
    const spaceId = (state["spaces"] as Array<[string, unknown]>)[0][0];

    // Drive the settings update via the same IPC the page-level form
    // dispatches. Lets us prove the bridge stores the full payload
    // (color + icon) without juggling the IconColorPicker popover.
    await invokeBridge(page, "update_space", {
      id: spaceId,
      name: "Round trip 2",
      color: "#22c55e",
      icon: "PixelContentFilesFolderOpen",
    });

    const after = await readBridge(page);
    const updated = (after["spaces"] as Array<[string, {
      name: string;
      color: string | null;
      icon: string | null;
    }]>).find(([id]) => id === spaceId);
    expect(updated?.[1].name).toBe("Round trip 2");
    expect(updated?.[1].color).toBe("#22c55e");
    expect(updated?.[1].icon).toBe("PixelContentFilesFolderOpen");
  });

  test("project-folder path persists through update_space via the bridge", async ({
    page,
  }) => {
    await page.getByTestId(sel.spacesAdd).click();
    await page.getByTestId(sel.spaceCreate.name).fill("Project");
    await page.getByTestId(sel.spaceCreate.prefix).fill("proj");
    await page
      .getByTestId(sel.spaceCreate.projectFolder)
      .fill("/Users/test/projects/p1");
    await page.getByTestId(sel.spaceCreate.save).click();
    await expect(page.getByTestId(sel.spaceCreate.root)).toHaveCount(0);

    const state = await readBridge(page);
    const space = (state["spaces"] as Array<[string, {
      projectFolderPath: string | null;
    }]>)[0];
    expect(space[1].projectFolderPath).toBe("/Users/test/projects/p1");

    // After update_space the new path should show through.
    await invokeBridge(page, "update_space", {
      id: space[0],
      projectFolderPath: "/Users/test/projects/p2",
    });

    const after = await readBridge(page);
    const updated = (after["spaces"] as Array<[string, {
      projectFolderPath: string | null;
    }]>)[0];
    expect(updated[1].projectFolderPath).toBe("/Users/test/projects/p2");
  });
});
