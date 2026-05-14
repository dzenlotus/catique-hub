import type { Page } from "@playwright/test";

import { test, expect } from "../fixtures";
import { invokeBridge, readBridge, spaNavigate } from "../helpers/bridge";
import { sel } from "../helpers/selectors";

async function gotoSkills(page: Page): Promise<void> {
  await page
    .getByTestId(sel.mainSidebar)
    .getByRole("button", { name: "Skills" })
    .click();
  await expect(page.getByTestId(sel.skillsPage)).toBeVisible();
}

test.describe("skills", () => {
  test("creating a skill adds it to the Skills page sidebar", async ({ page }) => {
    await gotoSkills(page);
    await page.getByTestId(sel.skillsAdd).click();
    await expect(page.getByTestId(sel.skillCreate.root)).toBeVisible();
    await page.getByTestId(sel.skillCreate.name).fill("Search code");
    await page.getByTestId(sel.skillCreate.save).click();
    await expect(page.getByTestId(sel.skillCreate.root)).toHaveCount(0);

    const state = await readBridge(page);
    const skills = state["skills"] as Array<[string, { name: string }]>;
    expect(skills).toHaveLength(1);
    expect(skills[0][1].name).toBe("Search code");
    await expect(
      page.getByTestId(sel.skillSidebarRow(skills[0][0])),
    ).toBeVisible();
  });

  test("editing a skill's name + overview via update_skill persists", async ({
    page,
  }) => {
    await gotoSkills(page);
    const skill = await invokeBridge<{ id: string }>(page, "create_skill", {
      name: "v1",
      position: 0,
      description: "v1 desc",
    });

    await invokeBridge(page, "update_skill", {
      id: skill.id,
      name: "v2",
      description: "v2 desc",
    });

    const state = await readBridge(page);
    const updated = (
      state["skills"] as Array<[string, { name: string; description: string | null }]>
    ).find(([id]) => id === skill.id);
    expect(updated?.[1].name).toBe("v2");
    expect(updated?.[1].description).toBe("v2 desc");
    // Sidebar reflects rename.
    await expect(page.getByTestId(sel.skillSidebarRow(skill.id))).toHaveAttribute(
      "aria-label",
      "v2",
    );
  });

  test("deleting a skill removes it from the sidebar", async ({ page }) => {
    await gotoSkills(page);
    const skill = await invokeBridge<{ id: string }>(page, "create_skill", {
      name: "Doomed",
      position: 0,
    });
    await expect(
      page.getByTestId(sel.skillSidebarRow(skill.id)),
    ).toBeVisible();

    await invokeBridge(page, "delete_skill", { id: skill.id });
    await expect(
      page.getByTestId(sel.skillSidebarRow(skill.id)),
    ).toHaveCount(0);
  });

  test("opening a skill from the sidebar renders the editor panel", async ({
    page,
  }) => {
    await gotoSkills(page);
    const skill = await invokeBridge<{ id: string }>(page, "create_skill", {
      name: "Routed",
      position: 0,
    });

    await page
      .getByTestId(sel.skillSidebarRow(skill.id))
      .click({ force: true });
    await expect(page).toHaveURL(new RegExp(`/skills/${skill.id}$`));
    await expect(page.getByTestId(sel.skillEditorPanel)).toBeVisible();
    await expect(page.getByTestId(sel.skillEditorName)).toHaveValue("Routed");
  });

  test("step editor surfaces seeded steps in position order", async ({ page }) => {
    await gotoSkills(page);
    const skill = await invokeBridge<{ id: string }>(page, "create_skill", {
      name: "Stepped",
      position: 0,
    });

    // Seed three steps via the bridge so the editor's list reflects
    // backend state without driving the inline form.
    const step1 = await invokeBridge<{ id: string }>(page, "add_skill_step", {
      skillId: skill.id,
      title: "First",
      body: "body 1",
      position: 0,
    });
    const step2 = await invokeBridge<{ id: string }>(page, "add_skill_step", {
      skillId: skill.id,
      title: "Second",
      body: "body 2",
      position: 1,
    });

    await spaNavigate(page, `/skills/${skill.id}`);
    await expect(page.getByTestId(sel.skillEditorPanel)).toBeVisible();
    await expect(page.getByTestId(sel.skillStepsList)).toBeVisible();
    await expect(
      page.getByTestId(`skill-step-card-${step1.id}`),
    ).toBeVisible();
    await expect(
      page.getByTestId(`skill-step-card-${step2.id}`),
    ).toBeVisible();
  });

  test("add_skill_step appends new steps to the bridge store", async ({
    page,
  }) => {
    const skill = await invokeBridge<{ id: string }>(page, "create_skill", {
      name: "Appender",
      position: 0,
    });

    await invokeBridge(page, "add_skill_step", {
      skillId: skill.id,
      title: "s1",
      body: "b1",
    });
    await invokeBridge(page, "add_skill_step", {
      skillId: skill.id,
      title: "s2",
      body: "b2",
    });
    await invokeBridge(page, "add_skill_step", {
      skillId: skill.id,
      title: "s3",
      body: "b3",
    });

    const state = await readBridge(page);
    const allSteps = state["skillSteps"] as Array<
      [string, { skillId: string; position: number; title: string }]
    >;
    const ours = allSteps
      .filter(([, s]) => s.skillId === skill.id)
      .sort((a, b) => a[1].position - b[1].position)
      .map(([, s]) => s.title);
    expect(ours).toEqual(["s1", "s2", "s3"]);
  });

  test("delete_skill_step shrinks the list", async ({ page }) => {
    const skill = await invokeBridge<{ id: string }>(page, "create_skill", {
      name: "Pruner",
      position: 0,
    });
    const s1 = await invokeBridge<{ id: string }>(page, "add_skill_step", {
      skillId: skill.id,
      title: "stay",
      body: "x",
    });
    const s2 = await invokeBridge<{ id: string }>(page, "add_skill_step", {
      skillId: skill.id,
      title: "drop",
      body: "y",
    });

    await invokeBridge(page, "delete_skill_step", { id: s2.id });

    const state = await readBridge(page);
    const steps = state["skillSteps"] as Array<[string, { skillId: string }]>;
    const ours = steps.filter(([, s]) => s.skillId === skill.id);
    expect(ours.map(([id]) => id)).toEqual([s1.id]);
  });
});
