import type { ReactNode } from "react";
import { createPortal } from "react-dom";

export function Portal({ children }: { children: ReactNode }) {
  const portalElement = document.getElementById("core-ui-portal");
  if (!portalElement) return null;
  return createPortal(children, portalElement);
}
