import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import Navigation from "./components/shared/Navigation";
import NotificationBar from "./components/shared/NotificationBar";
import { APP_BACKGROUND_STYLES, ROUTES } from "./constants";
import { AppProvider } from "./contexts/AppContext";
import { NavigationProvider } from "./contexts/NavigationContext";
import { ArmorFittingPage } from "./pages/ArmorFittingPage";
import { AssetsPage } from "./pages/AssetsPage";
import { EquipmentPage } from "./pages/EquipmentPage";
import { GenerationPage } from "./pages/GenerationPage";
import { HandRiggingPage } from "./pages/HandRiggingPage";
import { ManifestsPage } from "./pages/ManifestsPage";
import { RetargetAnimatePage } from "./pages/RetargetAnimatePage";
import { WorldBuilderPage } from "./pages/WorldBuilderPage";
// Procedural generator pages
import { BuildingGenPage } from "./pages/BuildingGenPage";
import { TreeGenPage } from "./pages/TreeGenPage";
import { RockGenPage } from "./pages/RockGenPage";
import { PlantGenPage } from "./pages/PlantGenPage";
import { TerrainGenPage } from "./pages/TerrainGenPage";
import { RoadsGenPage } from "./pages/RoadsGenPage";
import { GrassGenPage } from "./pages/GrassGenPage";

function AppLayout() {
  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-br from-bg-primary to-bg-secondary relative">
      {/* Subtle grid background */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.02]">
        <div
          className="h-full w-full"
          style={{
            backgroundImage: APP_BACKGROUND_STYLES.gridImage,
            backgroundSize: APP_BACKGROUND_STYLES.gridSize,
          }}
        />
      </div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col min-h-screen">
        <Navigation />
        <NotificationBar />

        <main className="flex-1">
          <Routes>
            {/* Default redirect to generate */}
            <Route
              path="/"
              element={<Navigate to={ROUTES.GENERATION} replace />}
            />

            {/* Main pages */}
            <Route path={ROUTES.GENERATION} element={<GenerationPage />} />
            <Route
              path={ROUTES.ASSETS}
              element={
                <div className="h-full overflow-hidden">
                  <AssetsPage />
                </div>
              }
            />
            <Route path={ROUTES.EQUIPMENT} element={<EquipmentPage />} />
            <Route path={ROUTES.HAND_RIGGING} element={<HandRiggingPage />} />
            <Route path={ROUTES.ARMOR_FITTING} element={<ArmorFittingPage />} />
            <Route
              path={ROUTES.RETARGET_ANIMATE}
              element={<RetargetAnimatePage />}
            />
            <Route path={ROUTES.WORLD_BUILDER} element={<WorldBuilderPage />} />
            <Route path={ROUTES.MANIFESTS} element={<ManifestsPage />} />

            {/* Procedural Generators */}
            <Route path={ROUTES.BUILDING_GEN} element={<BuildingGenPage />} />
            <Route path={ROUTES.TREE_GEN} element={<TreeGenPage />} />
            <Route path={ROUTES.ROCK_GEN} element={<RockGenPage />} />
            <Route path={ROUTES.PLANT_GEN} element={<PlantGenPage />} />
            <Route path={ROUTES.TERRAIN_GEN} element={<TerrainGenPage />} />
            <Route path={ROUTES.ROADS_GEN} element={<RoadsGenPage />} />
            <Route path={ROUTES.GRASS_GEN} element={<GrassGenPage />} />
            <Route path={ROUTES.GRASS_GEN} element={<GrassGenPage />} />

            {/* Catch-all redirect */}
            <Route
              path="*"
              element={<Navigate to={ROUTES.GENERATION} replace />}
            />
          </Routes>
        </main>
      </div>
    </div>
  );
}

function App() {
  return (
    <AppProvider>
      <ErrorBoundary>
        <BrowserRouter>
          <NavigationProvider>
            <AppLayout />
          </NavigationProvider>
        </BrowserRouter>
      </ErrorBoundary>
    </AppProvider>
  );
}

export default App;
