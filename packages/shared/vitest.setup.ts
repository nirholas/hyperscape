/**
 * Vitest Global Setup
 *
 * This file runs before all test files to initialize shared resources.
 * It ensures the DataManager and ProcessingDataProvider are properly
 * initialized with manifest data before tests run.
 */

import { beforeAll } from "vitest";
import { dataManager } from "./src/data/DataManager";
import { ProcessingDataProvider } from "./src/data/ProcessingDataProvider";

beforeAll(async () => {
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
});
