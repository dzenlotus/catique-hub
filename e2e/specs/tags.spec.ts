import { test, expect } from "../fixtures";
import { readBridge } from "../helpers/bridge";

test.describe("tags", () => {
  test("creating a tag through the bridge populates the tags map", async ({
    page,
  }) => {
    await page.evaluate(async () => {
      await window.__TAURI_INTERNALS__.invoke("create_tag", {
        name: "urgent",
        color: "#e11d48",
      });
    });
    const state = await readBridge(page);
    const tags = state["tags"] as Array<[string, { name: string }]>;
    expect(tags).toHaveLength(1);
    expect(tags[0][1].name).toBe("urgent");
  });

  test("attaching a tag to a prompt is recorded in the join map", async ({
    page,
  }) => {
    const result = (await page.evaluate(async () => {
      const tag = (await window.__TAURI_INTERNALS__.invoke("create_tag", {
        name: "review",
      })) as { id: string };
      const prompt = (await window.__TAURI_INTERNALS__.invoke(
        "create_prompt",
        { name: "P", content: "P-content" },
      )) as { id: string };
      await window.__TAURI_INTERNALS__.invoke("add_prompt_tag", {
        promptId: prompt.id,
        tagId: tag.id,
      });
      return { tagId: tag.id, promptId: prompt.id };
    })) as { tagId: string; promptId: string };

    const state = await readBridge(page);
    const entry = (state["promptTags"] as Array<[string, string[]]>).find(
      ([pid]) => pid === result.promptId,
    );
    expect(entry?.[1]).toEqual([result.tagId]);
  });
});
