/**
 * `widgets/first-launch` — public surface (FSD encapsulation).
 *
 * Internal modules under `./ImportWizard` and `./WelcomeWidget` MUST
 * NOT be imported directly from outside this widget. The gate is the
 * single entrypoint; subwidgets are exported only for Storybook and
 * tests, where they're imported via the per-widget paths.
 */

export { FirstLaunchGate } from "./FirstLaunchGate";
export { WelcomeWidget } from "./WelcomeWidget";
export { ImportWizard } from "./ImportWizard";
export type { WelcomeWidgetProps } from "./WelcomeWidget";
export type { ImportWizardProps, WizardStage } from "./ImportWizard";
