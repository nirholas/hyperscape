/**
 * Vitest Global Setup
 *
 * This file runs before all test files to initialize shared resources.
 * It ensures the DataManager and ProcessingDataProvider are properly
 * initialized with manifest data before tests run.
 *
 * Note: We use top-level await to ensure initialization happens BEFORE
 * any test code runs (including module imports that might trigger lazy
 * initialization of singletons like ProcessingDataProvider).
 */

import { dataManager } from "./src/data/DataManager";
import { ProcessingDataProvider } from "./src/data/ProcessingDataProvider";

// Use top-level initialization to ensure it runs before any tests
// This is critical because test file imports can trigger singleton initialization
try {
  // Initialize DataManager to load all manifests
  await dataManager.initialize();

  // Force rebuild ProcessingDataProvider to use loaded data
  const provider = ProcessingDataProvider.getInstance();
  provider.rebuild();

  console.log(
    "[Test Setup] DataManager and ProcessingDataProvider initialized",
  );
} catch (error) {
  // In CI/test environments without manifest files, warn but continue
  console.warn(
    "[Test Setup] DataManager initialization failed - some tests may be skipped:",
    error,
  );
}
