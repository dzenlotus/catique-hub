import type { ReactElement } from "react";
import {
  PixelPetAnimalsCat,
  PixelCodingAppsWebsitesModule,
  PixelInterfaceEssentialMap,
  PixelFoodDrinkCoffeeCup,
} from "@shared/ui/Icon";
import { IconRenderer } from "@shared/ui";

// ---------------------------------------------------------------------------
// Icon resolvers used inside the SPACES tree.
//
// Two paths:
//   - Custom: when the entity carries an explicit `icon` identifier
//     (round-19d Space + Board both gained `icon: string | null`),
//     render it via `<IconRenderer>` and apply the optional `color`
//     as the glyph tint.
//   - Heuristic fallback: when icon is null, fall back to the original
//     name-based pickers so existing rows keep their look without a
//     migration step on the user's data.
// ---------------------------------------------------------------------------

interface CustomOrNameIconProps {
  name: string;
  icon: string | null;
  color: string | null;
}

export function SpaceIcon({
  name,
  icon,
  color,
}: CustomOrNameIconProps): ReactElement {
  if (icon !== null) {
    return (
      <IconRenderer
        name={icon}
        width={20}
        height={20}
        aria-hidden={true}
        {...(color !== null ? { style: { color } } : {})}
      />
    );
  }
  const normalized = name.toLowerCase();
  if (normalized.includes("side") || normalized.includes("project")) {
    return <PixelFoodDrinkCoffeeCup width={20} height={20} aria-hidden={true} />;
  }
  return <PixelPetAnimalsCat width={20} height={20} aria-hidden={true} />;
}

export function BoardIcon({
  name,
  icon,
  color,
}: CustomOrNameIconProps): ReactElement {
  if (icon !== null) {
    return (
      <IconRenderer
        name={icon}
        width={18}
        height={18}
        aria-hidden={true}
        {...(color !== null ? { style: { color } } : {})}
      />
    );
  }
  if (name.toLowerCase().includes("roadmap")) {
    return <PixelInterfaceEssentialMap width={18} height={18} aria-hidden={true} />;
  }
  return <PixelCodingAppsWebsitesModule width={18} height={18} aria-hidden={true} />;
}
