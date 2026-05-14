/**
 * Central data-testid registry.
 *
 * All selectors used by the suite are co-located here so a refactor of
 * the corresponding widget surfaces a single grep target.
 */

export const sel = {
  // Shell / nav
  mainSidebar: "main-sidebar-root",
  topBar: "top-bar",
  spacesSidebar: "spaces-sidebar-root",

  // Page roots
  promptsPage: "prompts-page-root",
  rolesPage: "roles-page-root",
  skillsPage: "skills-page-root",
  mcpServersPage: "mcp-servers-page-root",
  mcpServersOverview: "mcp-servers-page-overview",

  // Spaces sidebar
  spacesAdd: "spaces-sidebar-add-space",
  spaceCreate: {
    root: "space-create-dialog",
    name: "space-create-dialog-name-input",
    prefix: "space-create-dialog-prefix-input",
    save: "space-create-dialog-save",
    cancel: "space-create-dialog-cancel",
  },
  spaceRow: (id: string) => `spaces-sidebar-space-name-${id}`,
  boardRowBtn: (id: string) => `spaces-sidebar-board-row-btn-${id}`,
  boardKebab: (id: string) => `spaces-sidebar-board-kebab-${id}`,

  // Prompts sidebar
  promptsAddPrompt: "prompts-sidebar-prompts-add",
  promptsAddGroup: "prompts-sidebar-groups-add",
  promptCreate: {
    root: "prompt-create-dialog",
    name: "prompt-create-dialog-name-input",
    content: "prompt-create-dialog-content-textarea",
    save: "prompt-create-dialog-save",
    cancel: "prompt-create-dialog-cancel",
  },
  promptRow: (id: string) => `prompts-sidebar-prompts-row-${id}`,
  promptItem: (id: string) => `prompts-sidebar-prompts-item-${id}`,
  groupRow: (id: string) => `prompts-sidebar-groups-row-${id}`,
  groupCreate: {
    root: "prompt-group-create-dialog",
    name: "prompt-group-create-dialog-name-input",
    save: "prompt-group-create-dialog-save",
    cancel: "prompt-group-create-dialog-cancel",
  },

  // Roles
  rolesAdd: "roles-sidebar-add",
  roleCreate: {
    root: "role-create-dialog",
    name: "role-create-dialog-name-input",
    save: "role-create-dialog-save",
    cancel: "role-create-dialog-cancel",
  },
  roleSidebarRow: (id: string) => `roles-sidebar-row-${id}`,
  roleEditor: "role-editor",
  rolePromptsSelect: "role-editor-prompts-select",
  rolePromptsInput: "role-editor-prompts-select-input",
  rolePromptOption: (id: string) => `role-editor-prompts-select-option-${id}`,
  rolePromptChip: (id: string) => `role-editor-prompts-select-chip-${id}`,
  rolePromptChipRemove: (id: string) =>
    `role-editor-prompts-select-chip-remove-${id}`,

  // Skills
  skillsAdd: "skills-sidebar-add",
  skillCreate: {
    root: "skill-create-dialog",
    name: "skill-create-dialog-name-input",
    save: "skill-create-dialog-save",
    cancel: "skill-create-dialog-cancel",
  },
  skillSidebarRow: (id: string) => `skills-sidebar-row-${id}`,

  // MCP
  mcpAdd: "mcp-servers-sidebar-add",
  mcpServerCreate: {
    root: "mcp-server-create-dialog",
    name: "mcp-server-create-dialog-name-input",
    command: "mcp-server-create-dialog-command-input",
    save: "mcp-server-create-dialog-save",
    cancel: "mcp-server-create-dialog-cancel",
  },
  mcpServerSidebarRow: (id: string) => `mcp-servers-sidebar-row-srv:${id}`,
} as const;
