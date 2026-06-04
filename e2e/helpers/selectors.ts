/**
 * Central data-testid registry.
 *
 * All selectors used by the suite are co-located here so a refactor of
 * the corresponding widget surfaces a single grep target.
 */

export const sel = {
  // Shell / nav
  // Refactor v3 Wave 1: `mainSidebar` now points at the unified
  // `AppSidebar` testid; the legacy `main-sidebar-root` is gone.
  mainSidebar: "app-sidebar-root",
  topBar: "top-bar",
  spacesSidebar: "spaces-sidebar-root",
  statusBar: "status-bar",

  // Page roots
  promptsPage: "prompts-page-root",
  rolesPage: "roles-page-root",
  skillsPage: "skills-page-root",
  mcpServersPage: "mcp-servers-page-root",
  mcpServersOverview: "mcp-servers-page-overview",

  // Spaces sidebar
  spacesAdd: "spaces-sidebar-add",
  spaceCreate: {
    root: "space-create-dialog",
    name: "space-create-dialog-name-input",
    prefix: "space-create-dialog-prefix-input",
    prefixError: "space-create-dialog-prefix-error",
    projectFolder: "space-create-dialog-project-folder-input",
    save: "space-create-dialog-save",
    cancel: "space-create-dialog-cancel",
  },
  spaceRow: (id: string) => `spaces-sidebar-space-name-${id}`,
  boardRowBtn: (id: string) => `spaces-sidebar-board-row-btn-${id}`,
  boardKebab: (id: string) => `spaces-sidebar-board-kebab-${id}`,

  // Space settings
  spaceSettings: {
    root: "space-settings",
    nameInput: "space-settings-name-input",
    prefix: "space-settings-prefix",
    projectFolderInput: "space-settings-project-folder-input",
    save: "space-settings-save",
    saved: "space-settings-saved",
    delete: "space-settings-delete",
    deleteConfirm: "space-settings-delete-confirm",
  },

  // Board settings
  boardSettings: {
    root: "board-settings",
    back: "board-settings-back",
    nameInput: "board-settings-name-input",
    descriptionInput: "board-settings-description-input",
    save: "board-settings-save",
    saved: "board-settings-saved",
    delete: "board-settings-delete",
    deleteConfirm: "board-settings-delete-confirm",
  },

  // Kanban
  kanban: {
    addColumn: "kanban-board-add-column",
    scroller: "kanban-board-scroller",
    column: (id: string) => `kanban-column-${id}`,
    columnEmpty: (id: string) => `kanban-column-empty-${id}`,
    columnAddTask: (id: string) => `kanban-column-add-task-${id}`,
    columnQuickInput: (id: string) => `kanban-column-quick-input-${id}`,
    optionsButton: "kanban-board-options-button",
  },
  columnCreate: {
    root: "column-create-dialog",
    name: "column-create-dialog-name-input",
    save: "column-create-dialog-save",
    cancel: "column-create-dialog-cancel",
  },

  // Prompts sidebar
  promptsAddPrompt: "prompts-sidebar-prompts-add",
  promptsAddGroup: "prompts-sidebar-groups-add",
  promptsSettingsTrigger: "prompts-sidebar-settings-trigger",
  promptsTagsFilterTrigger: "prompts-sidebar-tags-filter-trigger",
  promptsTagsFilterClear: "prompts-sidebar-tags-filter-clear",
  promptsTagsFilterTag: (id: string) =>
    `prompts-sidebar-tags-filter-tag-${id}`,
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
  groupItem: (id: string) => `prompts-sidebar-groups-item-${id}`,
  groupKebab: (id: string) => `prompts-sidebar-group-kebab-${id}`,
  groupRenameInput: (id: string) =>
    `prompts-sidebar-group-rename-input-${id}`,
  groupCreate: {
    root: "prompt-group-create-dialog",
    name: "prompt-group-create-dialog-name-input",
    save: "prompt-group-create-dialog-save",
    cancel: "prompt-group-create-dialog-cancel",
  },
  promptEditorPanel: {
    root: "prompt-editor-panel",
    nameInput: "prompt-editor-panel-name-input",
    contentTextarea: "prompt-editor-panel-content-textarea",
    save: "prompt-editor-panel-save",
    cancel: "prompt-editor-panel-cancel",
    saveError: "prompt-editor-panel-save-error",
  },
  inlineGroupView: {
    root: "inline-group-view",
    menu: "inline-group-view-menu",
    dropZone: "inline-group-view-drop-zone",
  },
  inlineGroupSettings: {
    root: "inline-group-settings",
    appearance: "inline-group-settings-appearance",
    save: "inline-group-settings-save",
    cancel: "inline-group-settings-cancel",
    back: "inline-group-settings-back",
    delete: "inline-group-settings-delete",
  },

  // Roles
  rolesAdd: "roles-sidebar-add",
  roleCreate: {
    root: "role-create-dialog",
    name: "role-create-dialog-name-input",
    contentTextarea: "role-create-dialog-content-textarea",
    save: "role-create-dialog-save",
    cancel: "role-create-dialog-cancel",
  },
  roleSidebarRow: (id: string) => `roles-sidebar-row-${id}`,
  roleSidebarItem: (id: string) => `roles-sidebar-item-${id}`,
  roleEditor: "role-editor",
  roleEditorPanel: "role-editor-panel",
  roleEditorName: "role-editor-name-input",
  roleEditorContent: "role-editor-content-textarea",
  roleEditorSave: "role-editor-save",
  roleEditorCancel: "role-editor-cancel",
  rolePromptsSelect: "role-editor-prompts-select",
  rolePromptsInput: "role-editor-prompts-select-input",
  rolePromptOption: (id: string) => `role-editor-prompts-select-option-${id}`,
  rolePromptChip: (id: string) => `role-editor-prompts-select-chip-${id}`,
  rolePromptChipRemove: (id: string) =>
    `role-editor-prompts-select-chip-remove-${id}`,
  roleSkillsSelect: "role-editor-skills-select",
  roleSkillsInput: "role-editor-skills-select-input",
  roleSkillOption: (id: string) => `role-editor-skills-select-option-${id}`,
  roleSkillChip: (id: string) => `role-editor-skills-select-chip-${id}`,
  roleSkillChipRemove: (id: string) =>
    `role-editor-skills-select-chip-remove-${id}`,
  roleMcpToolsSelect: "role-editor-mcp-tools-select",
  roleMcpToolsInput: "role-editor-mcp-tools-select-input",
  roleMcpToolOption: (id: string) =>
    `role-editor-mcp-tools-select-option-${id}`,
  roleMcpToolChip: (id: string) =>
    `role-editor-mcp-tools-select-chip-${id}`,
  roleMcpToolChipRemove: (id: string) =>
    `role-editor-mcp-tools-select-chip-remove-${id}`,
  rolePromptsOverflow: "role-editor-prompts-select-overflow",

  // Skills
  skillsAdd: "skills-sidebar-add",
  skillCreate: {
    root: "skill-create-dialog",
    name: "skill-create-dialog-name-input",
    save: "skill-create-dialog-save",
    cancel: "skill-create-dialog-cancel",
  },
  skillSidebarRow: (id: string) => `skills-sidebar-row-${id}`,
  skillSidebarItem: (id: string) => `skills-sidebar-item-${id}`,
  skillEditorPanel: "skill-editor-panel",
  skillEditorName: "skill-editor-name-input",
  skillEditorOverview: "skill-editor-overview-input",
  skillEditorSave: "skill-editor-save",
  skillStepsList: "skill-steps-list",
  skillStepsEmpty: "skill-steps-empty",
  skillStepCard: (id: string) => `skill-step-card-${id}`,

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
  mcpServerSidebarItem: (id: string) => `mcp-servers-sidebar-item-srv:${id}`,
  mcpServerToggle: (id: string) => `mcp-servers-sidebar-toggle-srv:${id}`,
  mcpServerChildren: (id: string) => `mcp-servers-sidebar-children-srv:${id}`,
  mcpToolSidebarRow: (id: string) => `mcp-servers-sidebar-row-tool:${id}`,
  mcpToolSidebarItem: (id: string) => `mcp-servers-sidebar-item-tool:${id}`,
  mcpServerDetail: (id: string) => `mcp-servers-page-detail-${id}`,
  mcpServerDelete: (id: string) => `mcp-servers-page-delete-${id}`,
  mcpServerDeleteConfirm: (id: string) =>
    `mcp-servers-page-delete-confirm-${id}`,
  mcpToolDetail: (id: string) => `mcp-servers-page-tool-detail-${id}`,
  mcpToolName: (id: string) => `mcp-servers-page-tool-name-${id}`,
  mcpToolDescription: (id: string) =>
    `mcp-servers-page-tool-description-${id}`,

  // Settings
  settings: {
    viewScroll: "settings-view-scroll",
    // EntityTree generates `${testIdPrefix}-item-${node.id}` for each row.
    nav: (id: string) => `settings-view-nav-item-${id}`,
    themeLight: "settings-theme-button-light",
    themeDark: "settings-theme-button-dark",
    activeThemeName: "active-theme-name",
    seedPrompts: "settings-data-seed-prompts",
    sidecarStatus: "sidecar-status-pill",
    appVersion: "app-version",
  },
} as const;
