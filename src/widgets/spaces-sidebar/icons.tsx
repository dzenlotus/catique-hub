import type { ReactElement } from "react";
import {
  PixelPetAnimalsCat,
  PixelCodingAppsWebsitesModule,
  PixelInterfaceEssentialMap,
  PixelFoodDrinkCoffeeCup,
} from "@shared/ui/Icon";

// ---------------------------------------------------------------------------
// Name-based icon pickers used inside the SPACES tree.
// Heuristics here are intentionally tiny — once the backend exposes an
// explicit icon field on Space / Board the picker should switch to it.
// ---------------------------------------------------------------------------

interface IconByNameProps {
  name: string;
}

export function SpaceIcon({ name }: IconByNameProps): ReactElement {
  const normalized = name.toLowerCase();
  if (normalized.includes("side") || normalized.includes("project")) {
    return <PixelFoodDrinkCoffeeCup width={20} height={20} aria-hidden={true} />;
  }

  return <PixelPetAnimalsCat width={20} height={20} aria-hidden={true} />;
}

export function BoardIcon({ name }: IconByNameProps): ReactElement {
  if (name.toLowerCase().includes("roadmap")) {
    return <PixelInterfaceEssentialMap width={18} height={18} aria-hidden={true} />;
  }

  return <PixelCodingAppsWebsitesModule width={18} height={18} aria-hidden={true} />;
}
