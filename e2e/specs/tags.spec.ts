import { test, expect } from "../fixtures";
import { invokeBridge, readBridge } from "../helpers/bridge";

test.describe("tags", () => {
  test("creating a tag through the bridge populates the tags map", async ({
    page,
  }) => {
    await invokeBridge(page, "create_tag", {
      name: "urgent",
      color: "#e11d48",
    });
    const state = await readBridge(page);
    const tags = state["tags"] as Array<[string, { name: string }]>;
    expect(tags).toHaveLength(1);
    expect(tags[0][1].name).toBe("urgent");
  });

  test("attaching a tag to a prompt is recorded in the join map", async ({
    page,
  }) => {
    const tag = await invokeBridge<{ id: string }>(page, "create_tag", {
      name: "review",
    });
    const prompt = await invokeBridge<{ id: string }>(page, "create_prompt", {
      name: "P",
      content: "P-content",
    });
    await invokeBridge(page, "add_prompt_tag", {
      promptId: prompt.id,
      tagId: tag.id,
    });

    const state = await readBridge(page);
    const entry = (state["promptTags"] as Array<[string, string[]]>).find(
      ([pid]) => pid === prompt.id,
    );
    expect(entry?.[1]).toEqual([tag.id]);
  });

  test("creating two tags shows both in the tags map", async ({ page }) => {
    await invokeBridge(page, "create_tag", { name: "alpha" });
    await invokeBridge(page, "create_tag", { name: "beta" });

    const state = await readBridge(page);
    const tags = state["tags"] as Array<[string, { name: string }]>;
    expect(tags).toHaveLength(2);
    const names = tags.map(([, t]) => t.name).sort();
    expect(names).toEqual(["alpha", "beta"]);
  });

  test("multiple tags attached to one prompt are all recorded", async ({
    page,
  }) => {
    const a = await invokeBridge<{ id: string }>(page, "create_tag", {
      name: "a",
    });
    const b = await invokeBridge<{ id: string }>(page, "create_tag", {
      name: "b",
    });
    const c = await invokeBridge<{ id: string }>(page, "create_tag", {
      name: "c",
    });
    const prompt = await invokeBridge<{ id: string }>(page, "create_prompt", {
      name: "P",
      content: "x",
    });
    for (const tag of [a, b, c]) {
      await invokeBridge(page, "add_prompt_tag", {
        promptId: prompt.id,
        tagId: tag.id,
      });
    }

    const state = await readBridge(page);
    const entry = (state["promptTags"] as Array<[string, string[]]>).find(
      ([pid]) => pid === prompt.id,
    );
    expect(entry?.[1]).toEqual([a.id, b.id, c.id]);
  });

  test("detaching all tags from a prompt empties its join row", async ({
    page,
  }) => {
    const a = await invokeBridge<{ id: string }>(page, "create_tag", {
      name: "stick",
    });
    const b = await invokeBridge<{ id: string }>(page, "create_tag", {
      name: "stay",
    });
    const prompt = await invokeBridge<{ id: string }>(page, "create_prompt", {
      name: "Detach",
      content: "x",
    });

    for (const tag of [a, b]) {
      await invokeBridge(page, "add_prompt_tag", {
        promptId: prompt.id,
        tagId: tag.id,
      });
    }
    for (const tag of [a, b]) {
      await invokeBridge(page, "remove_prompt_tag", {
        promptId: prompt.id,
        tagId: tag.id,
      });
    }

    const state = await readBridge(page);
    const entry = (state["promptTags"] as Array<[string, string[]]>).find(
      ([pid]) => pid === prompt.id,
    );
    expect(entry?.[1] ?? []).toEqual([]);
  });

  test("two prompts can share the same tag in the join map", async ({
    page,
  }) => {
    const tag = await invokeBridge<{ id: string }>(page, "create_tag", {
      name: "shared",
    });
    const p1 = await invokeBridge<{ id: string }>(page, "create_prompt", {
      name: "p1",
      content: "1",
    });
    const p2 = await invokeBridge<{ id: string }>(page, "create_prompt", {
      name: "p2",
      content: "2",
    });

    await invokeBridge(page, "add_prompt_tag", {
      promptId: p1.id,
      tagId: tag.id,
    });
    await invokeBridge(page, "add_prompt_tag", {
      promptId: p2.id,
      tagId: tag.id,
    });

    const state = await readBridge(page);
    const joins = state["promptTags"] as Array<[string, string[]]>;
    expect(joins.find(([id]) => id === p1.id)?.[1]).toEqual([tag.id]);
    expect(joins.find(([id]) => id === p2.id)?.[1]).toEqual([tag.id]);
  });

  test("deleting a tag detaches it from every prompt", async ({ page }) => {
    const tag = await invokeBridge<{ id: string }>(page, "create_tag", {
      name: "doomed",
    });
    const p1 = await invokeBridge<{ id: string }>(page, "create_prompt", {
      name: "p1",
      content: "1",
    });
    const p2 = await invokeBridge<{ id: string }>(page, "create_prompt", {
      name: "p2",
      content: "2",
    });
    await invokeBridge(page, "add_prompt_tag", {
      promptId: p1.id,
      tagId: tag.id,
    });
    await invokeBridge(page, "add_prompt_tag", {
      promptId: p2.id,
      tagId: tag.id,
    });

    await invokeBridge(page, "delete_tag", { id: tag.id });

    const state = await readBridge(page);
    // Tag is removed.
    const tags = state["tags"] as Array<[string, unknown]>;
    expect(tags.find(([id]) => id === tag.id)).toBeUndefined();
    // Tag detaches from every prompt: join entry is `[]`, not removed.
    const joins = state["promptTags"] as Array<[string, string[]]>;
    expect(joins.find(([id]) => id === p1.id)?.[1] ?? []).toEqual([]);
    expect(joins.find(([id]) => id === p2.id)?.[1] ?? []).toEqual([]);
  });
});
