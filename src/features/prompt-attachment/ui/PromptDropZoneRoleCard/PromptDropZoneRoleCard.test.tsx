import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";

import type { Role } from "@entities/role";
import { PromptDropZoneRoleCard } from "./PromptDropZoneRoleCard";

/**
 * `PromptDropZoneRoleCard` tests.
 *
 * Verifies that the RoleCard content is rendered and that the droppable
 * wrapper doesn't interfere with normal card presentation.
 * Active-over visual (overlay) is not tested here — it requires
 * simulating a DnD pointer event, which is an integration concern.
 */

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: "role-001",
    name: "Технический директор",
    content: "Архитектура и техническое лидерство.",
    color: null,
    createdAt: 0n,
    updatedAt: 0n,
    ...overrides,
  };
}

describe("PromptDropZoneRoleCard", () => {
  it("renders the role name via RoleCard", () => {
    render(
      <DndContext>
        <PromptDropZoneRoleCard
          roleId="role-001"
          role={makeRole({ name: "Продакт-менеджер" })}
        />
      </DndContext>,
    );
    expect(screen.getByText("Продакт-менеджер")).toBeInTheDocument();
  });

  it("renders the RoleCard as a native button (a11y)", () => {
    render(
      <DndContext>
        <PromptDropZoneRoleCard roleId="role-002" role={makeRole()} />
      </DndContext>,
    );
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("does not render the overlay when not dragging over", () => {
    const { container } = render(
      <DndContext>
        <PromptDropZoneRoleCard roleId="role-003" role={makeRole()} />
      </DndContext>,
    );
    const overlay = container.querySelector("[aria-hidden='true']");
    expect(overlay).toBeNull();
  });

  it("renders skeleton when role prop is omitted", () => {
    render(
      <DndContext>
        <PromptDropZoneRoleCard roleId="role-004" />
      </DndContext>,
    );
    expect(screen.getByTestId("role-card-skeleton")).toBeInTheDocument();
  });

  it("calls onSelect with the role id when clicked", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const onSelect = vi.fn();

    render(
      <DndContext>
        <PromptDropZoneRoleCard
          roleId="role-005"
          role={makeRole({ id: "role-005", name: "Дизайнер" })}
          onSelect={onSelect}
        />
      </DndContext>,
    );
    await user.click(screen.getByText("Дизайнер"));
    expect(onSelect).toHaveBeenCalledWith("role-005");
  });

  it("renders a position-relative wrapper (for the absolute overlay)", () => {
    const { container } = render(
      <DndContext>
        <PromptDropZoneRoleCard roleId="role-006" role={makeRole()} />
      </DndContext>,
    );
    const wrapper = container.firstElementChild;
    expect(wrapper?.tagName).toBe("DIV");
  });
});
