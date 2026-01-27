/**
 * Window Renderer
 *
 * Renders all visible windows with appropriate wrappers based on window type.
 * Handles action bars, menu bars, minimap, and regular panel windows.
 *
 * @packageDocumentation
 */

import React from "react";
import { Window, TabBar, type WindowState } from "@/ui";
import type { ClientWorld } from "../../types";
import {
  WindowContent,
  DraggableContentWrapper,
  ActionBarWrapper,
  MenuBarWrapper,
  MinimapWrapper,
} from "./InterfacePanels";

/** Props for WindowRenderer component */
interface WindowRendererProps {
  /** All window configurations */
  windows: WindowState[];
  /** The game world instance */
  world: ClientWorld | null;
  /** Whether edit mode is active */
  isUnlocked: boolean;
  /** Whether edit mode feature is enabled */
  editModeEnabled: boolean;
  /** Whether window combining is enabled */
  windowCombiningEnabled: boolean;
  /** Function to render panel content */
  renderPanel: (
    panelId: string,
    world?: ClientWorld,
    windowId?: string,
  ) => React.ReactNode;
}

/**
 * Renders all visible windows with appropriate wrappers
 */
export function WindowRenderer({
  windows,
  world,
  isUnlocked,
  editModeEnabled,
  windowCombiningEnabled,
  renderPanel,
}: WindowRendererProps): React.ReactElement {
  const visibleWindows = windows.filter((w) => w.visible);
  const isEditMode = isUnlocked && editModeEnabled;

  return (
    <div
      className="fixed inset-0 pointer-events-none"
      style={{ zIndex: isEditMode ? 600 : 300 }}
    >
      {visibleWindows.map((windowState) => (
        <WindowItem
          key={windowState.id}
          windowState={windowState}
          world={world}
          isEditMode={isEditMode}
          windowCombiningEnabled={windowCombiningEnabled}
          renderPanel={renderPanel}
        />
      ))}
    </div>
  );
}

/** Props for individual window item */
interface WindowItemProps {
  windowState: WindowState;
  world: ClientWorld | null;
  isEditMode: boolean;
  windowCombiningEnabled: boolean;
  renderPanel: (
    panelId: string,
    world?: ClientWorld,
    windowId?: string,
  ) => React.ReactNode;
}

/**
 * Renders a single window with the appropriate content wrapper
 */
function WindowItem({
  windowState,
  world,
  isEditMode,
  windowCombiningEnabled,
  renderPanel,
}: WindowItemProps): React.ReactElement {
  const isActionBar = windowState.id.startsWith("actionbar-");
  const isMenuBar = windowState.id === "menubar-window";
  const isMinimap = windowState.id === "minimap-window";
  const hasMultipleTabs = windowState.tabs.length > 1;
  const showTabBar =
    !isActionBar && !isMenuBar && !isMinimap && hasMultipleTabs;
  const needsDraggableWrapper =
    !isActionBar && !isMenuBar && !isMinimap && !hasMultipleTabs;

  return (
    <div style={{ pointerEvents: "auto" }}>
      <Window
        windowId={windowState.id}
        windowState={windowState}
        isUnlocked={isEditMode}
        windowCombiningEnabled={windowCombiningEnabled}
      >
        {isActionBar ? (
          <ActionBarWrapper
            activeTabIndex={windowState.activeTabIndex}
            tabs={windowState.tabs}
            renderPanel={renderPanel}
            windowId={windowState.id}
          />
        ) : isMenuBar ? (
          <MenuBarWrapper
            activeTabIndex={windowState.activeTabIndex}
            tabs={windowState.tabs}
            renderPanel={renderPanel}
            windowId={windowState.id}
            isUnlocked={isEditMode}
          />
        ) : isMinimap ? (
          <MinimapWrapper world={world} isUnlocked={isEditMode} />
        ) : showTabBar ? (
          <TabBar windowId={windowState.id} />
        ) : null}

        {!isActionBar && !isMenuBar && !isMinimap && needsDraggableWrapper ? (
          <DraggableContentWrapper
            windowId={windowState.id}
            activeTabIndex={windowState.activeTabIndex}
            tabs={windowState.tabs}
            renderPanel={renderPanel}
            isUnlocked={isEditMode}
          />
        ) : !isActionBar && !isMenuBar && !isMinimap ? (
          <WindowContent
            activeTabIndex={windowState.activeTabIndex}
            tabs={windowState.tabs}
            renderPanel={renderPanel}
            windowId={windowState.id}
            isUnlocked={isEditMode}
          />
        ) : null}
      </Window>
    </div>
  );
}
