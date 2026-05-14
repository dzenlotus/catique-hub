/**
 * Two-pane shell layout shared by every entity page that needs a list
 * rail (Roles, Skills, MCP servers, Tags, …). Exposes the CSS module
 * directly — there's no JSX wrapper because each page already composes
 * the sidebar + content panes itself.
 */

export { default as entityPageShellStyles } from "./EntityPageShell.module.css";
