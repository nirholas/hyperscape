import { NavigationView } from "../types";

// Navigation view constants
export const NAVIGATION_VIEWS = {
  ASSETS: "assets",
  GENERATION: "generation",
  EQUIPMENT: "equipment",
  HAND_RIGGING: "handRigging",
  ARMOR_FITTING: "armorFitting",
  RETARGET_ANIMATE: "retargetAnimate",
  WORLD_BUILDER: "worldBuilder",
  MANIFESTS: "manifests",
  // Procedural generators
  BUILDING_GEN: "buildingGen",
  TREE_GEN: "treeGen",
  ROCK_GEN: "rockGen",
  PLANT_GEN: "plantGen",
  TERRAIN_GEN: "terrainGen",
  ROADS_GEN: "roadsGen",
  GRASS_GEN: "grassGen",
} as const satisfies Record<string, NavigationView>;

// Route paths for URL navigation
export const ROUTES = {
  GENERATION: "/generate",
  ASSETS: "/assets",
  BUILDING_GEN: "/generators/buildings",
  TREE_GEN: "/generators/trees",
  ROCK_GEN: "/generators/rocks",
  PLANT_GEN: "/generators/plants",
  TERRAIN_GEN: "/generators/terrain",
  ROADS_GEN: "/generators/roads",
  GRASS_GEN: "/generators/grass",
  HAND_RIGGING: "/hand-rigging",
  EQUIPMENT: "/equipment",
  ARMOR_FITTING: "/armor",
  RETARGET_ANIMATE: "/retarget",
  WORLD_BUILDER: "/world",
  MANIFESTS: "/manifests",
} as const;

// Map routes to navigation views
export const ROUTE_TO_VIEW: Record<string, NavigationView> = {
  [ROUTES.GENERATION]: NAVIGATION_VIEWS.GENERATION,
  [ROUTES.ASSETS]: NAVIGATION_VIEWS.ASSETS,
  [ROUTES.BUILDING_GEN]: NAVIGATION_VIEWS.BUILDING_GEN,
  [ROUTES.TREE_GEN]: NAVIGATION_VIEWS.TREE_GEN,
  [ROUTES.ROCK_GEN]: NAVIGATION_VIEWS.ROCK_GEN,
  [ROUTES.PLANT_GEN]: NAVIGATION_VIEWS.PLANT_GEN,
  [ROUTES.TERRAIN_GEN]: NAVIGATION_VIEWS.TERRAIN_GEN,
  [ROUTES.ROADS_GEN]: NAVIGATION_VIEWS.ROADS_GEN,
  [ROUTES.GRASS_GEN]: NAVIGATION_VIEWS.GRASS_GEN,
  [ROUTES.HAND_RIGGING]: NAVIGATION_VIEWS.HAND_RIGGING,
  [ROUTES.EQUIPMENT]: NAVIGATION_VIEWS.EQUIPMENT,
  [ROUTES.ARMOR_FITTING]: NAVIGATION_VIEWS.ARMOR_FITTING,
  [ROUTES.RETARGET_ANIMATE]: NAVIGATION_VIEWS.RETARGET_ANIMATE,
  [ROUTES.WORLD_BUILDER]: NAVIGATION_VIEWS.WORLD_BUILDER,
  [ROUTES.MANIFESTS]: NAVIGATION_VIEWS.MANIFESTS,
};

// Map navigation views to routes
export const VIEW_TO_ROUTE: Record<NavigationView, string> = {
  [NAVIGATION_VIEWS.GENERATION]: ROUTES.GENERATION,
  [NAVIGATION_VIEWS.ASSETS]: ROUTES.ASSETS,
  [NAVIGATION_VIEWS.BUILDING_GEN]: ROUTES.BUILDING_GEN,
  [NAVIGATION_VIEWS.TREE_GEN]: ROUTES.TREE_GEN,
  [NAVIGATION_VIEWS.ROCK_GEN]: ROUTES.ROCK_GEN,
  [NAVIGATION_VIEWS.PLANT_GEN]: ROUTES.PLANT_GEN,
  [NAVIGATION_VIEWS.TERRAIN_GEN]: ROUTES.TERRAIN_GEN,
  [NAVIGATION_VIEWS.ROADS_GEN]: ROUTES.ROADS_GEN,
  [NAVIGATION_VIEWS.GRASS_GEN]: ROUTES.GRASS_GEN,
  [NAVIGATION_VIEWS.HAND_RIGGING]: ROUTES.HAND_RIGGING,
  [NAVIGATION_VIEWS.EQUIPMENT]: ROUTES.EQUIPMENT,
  [NAVIGATION_VIEWS.ARMOR_FITTING]: ROUTES.ARMOR_FITTING,
  [NAVIGATION_VIEWS.RETARGET_ANIMATE]: ROUTES.RETARGET_ANIMATE,
  [NAVIGATION_VIEWS.WORLD_BUILDER]: ROUTES.WORLD_BUILDER,
  [NAVIGATION_VIEWS.MANIFESTS]: ROUTES.MANIFESTS,
};

// Grid background styles for the app
export const APP_BACKGROUND_STYLES = {
  gridSize: "50px 50px",
  gridImage: `linear-gradient(to right, var(--color-primary) 1px, transparent 1px),
               linear-gradient(to bottom, var(--color-primary) 1px, transparent 1px)`,
} as const;
