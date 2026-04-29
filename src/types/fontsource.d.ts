// Side-effect-only module declarations for self-hosted variable fonts.
// `@fontsource-variable/*` packages don't ship .d.ts files because they
// only inject CSS @font-face rules at import time — no runtime exports.
//
// Keeping these declarations in a dedicated file (rather than alongside
// `vite-env.d.ts`) so the typing intent is obvious to future readers.

declare module "@fontsource-variable/nunito";
declare module "@fontsource-variable/playfair-display";
declare module "@fontsource-variable/inter";
