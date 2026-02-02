/**
 * @hyperscape/procgen/building
 * Procedural building and town generation for Hyperscape
 *
 * NOTE: Viewer components (BuildingViewer, TownViewer, NavigationVisualizer)
 * are NOT exported here to avoid pulling in @hyperscape/shared dependency.
 * Import them separately from "@hyperscape/procgen/building/viewer" if needed.
 */

export * from "./generator";
export * from "./town";
export * from "./materials";
