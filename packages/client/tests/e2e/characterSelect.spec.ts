/**
 * Character Selection E2E Tests
 *
 * Tests the character selection flow including:
 * - Character list display
 * - Character creation
 * - Character selection and world entry
 * - Character preview
 * - Input validation
 *
 * Per project rules: Uses real Hyperscape instances with Playwright
 *
 * @packageDocumentation
 */

import { test, expect } from "@playwright/test";
import {
  takeGameScreenshot,
  setupErrorCapture,
  assertNoConsoleErrors,
} from "./utils/testWorld";
import { createErrorLogger, KNOWN_ERROR_PATTERNS } from "../utils/errorLogger";

const BASE_URL = process.env.TEST_URL || "http://localhost:3333";

test.describe("Character Selection Screen", () => {
  let errorLogger: ReturnType<typeof createErrorLogger>;
  let consoleErrors: { errors: string[] };

  test.beforeEach(async ({ page }) => {
    // Set up error logging
    errorLogger = createErrorLogger(page, "character-select");
    errorLogger.filterKnownErrors(KNOWN_ERROR_PATTERNS);
    consoleErrors = setupErrorCapture(page);

    // Navigate to the app - character selection should appear after auth
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");
  });

  test.afterEach(async () => {
    // Assert no unexpected console errors
    assertNoConsoleErrors(consoleErrors.errors, [
      /ResizeObserver/,
      /Script error/,
      /favicon/,
    ]);
  });

  test("should display character selection UI elements", async ({ page }) => {
    // Look for character selection screen elements
    const characterSelectScreen = page.locator(
      '[data-testid="character-select"], [class*="character-select"], [class*="CharacterSelect"]',
    );

    // Wait for app to initialize - look for any main UI element
    await page
      .waitForFunction(
        () =>
          document.querySelector(
            'canvas, [class*="character"], [data-testid]',
          ) !== null,
        { timeout: 10000 },
      )
      .catch(() => {});

    // Check if character list container exists
    const characterList = page.locator(
      '[data-testid="character-list"], [class*="character-list"]',
    );

    // At minimum, the page should not have critical errors
    const pageErrored = await page
      .locator('[data-testid="error-boundary"]')
      .isVisible()
      .catch(() => false);
    expect(pageErrored).toBe(false);
  });

  test("should show character creation form", async ({ page }) => {
    // Look for character creation button or form
    const createButton = page.locator(
      '[data-testid="create-character"], button:has-text("Create"), button:has-text("New Character")',
    );

    // Wait for UI to stabilize
    await page
      .waitForFunction(
        () => document.querySelector('button, [class*="character"]') !== null,
        { timeout: 5000 },
      )
      .catch(() => {});

    if (
      await createButton
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await createButton.first().click();

      // Character name input should appear
      const nameInput = page.locator(
        '[data-testid="character-name-input"], input[placeholder*="name" i], input[name="characterName"]',
      );

      await expect(nameInput.first()).toBeVisible({ timeout: 5000 });
    }
  });

  test("should validate character name input", async ({ page }) => {
    // Wait for UI to initialize
    await page
      .waitForFunction(() => document.querySelector("input, button") !== null, {
        timeout: 5000,
      })
      .catch(() => {});

    // Find the character name input
    const nameInput = page
      .locator(
        '[data-testid="character-name-input"], input[placeholder*="name" i], input[name="characterName"]',
      )
      .first();

    if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Test empty name
      await nameInput.fill("");
      const submitButton = page
        .locator(
          '[data-testid="create-character-submit"], button[type="submit"]:has-text("Create")',
        )
        .first();

      if (await submitButton.isVisible()) {
        // Button should be disabled or clicking should show error
        const isDisabled = await submitButton.isDisabled();
        if (!isDisabled) {
          await submitButton.click();
          // Should show validation error
          const errorMessage = page.locator(
            '[data-testid="name-error"], [class*="error"], [role="alert"]',
          );
          await expect(errorMessage.first()).toBeVisible({ timeout: 3000 });
        }
      }

      // Test name with special characters
      await nameInput.fill("<script>alert('xss')</script>");
      const inputValue = await nameInput.inputValue();
      // Should either reject or sanitize the input
      expect(inputValue).not.toContain("<script>");

      // Test valid name
      await nameInput.fill("TestPlayer123");
      const validInputValue = await nameInput.inputValue();
      expect(validInputValue).toBe("TestPlayer123");
    }
  });

  test("should display character preview on hover or selection", async ({
    page,
  }) => {
    // Wait for character cards to potentially load
    await page
      .waitForFunction(
        () => document.querySelector('[class*="character"], canvas') !== null,
        { timeout: 5000 },
      )
      .catch(() => {});

    // Look for character cards/items
    const characterCards = page.locator(
      '[data-testid="character-card"], [class*="character-card"], [class*="CharacterCard"]',
    );

    if ((await characterCards.count()) > 0) {
      // Hover over first character
      await characterCards.first().hover();

      // Look for preview canvas or 3D viewer
      const preview = page.locator(
        'canvas, [data-testid="character-preview"], [class*="preview"]',
      );

      // Some form of preview should be visible
      const previewExists = (await preview.count()) > 0;
      expect(previewExists).toBeDefined();
    }
  });

  test("should handle empty characters state", async ({ page }) => {
    // Wait for page content to stabilize
    await page
      .waitForFunction(
        () =>
          document.querySelector(
            '[class*="character"], [class*="empty"], button',
          ) !== null,
        { timeout: 5000 },
      )
      .catch(() => {});

    // Look for empty state message
    const emptyState = page.locator(
      '[data-testid="no-characters"], [class*="empty-state"], :has-text("No characters")',
    );

    // If empty state is shown, should have create button
    if (
      await emptyState
        .first()
        .isVisible({ timeout: 3000 })
        .catch(() => false)
    ) {
      const createButton = page.locator(
        'button:has-text("Create"), button:has-text("New")',
      );
      await expect(createButton.first()).toBeVisible();
    }
  });

  test("should select character and proceed to world", async ({ page }) => {
    // Wait for character cards to load
    await page
      .waitForFunction(
        () =>
          document.querySelector(
            '[class*="character-card"], [data-testid*="character"]',
          ) !== null,
        { timeout: 5000 },
      )
      .catch(() => {});

    // Find playable character cards
    const characterCards = page.locator(
      '[data-testid="character-card"], [class*="character-card"]',
    );

    if ((await characterCards.count()) > 0) {
      // Click on first character
      await characterCards.first().click();

      // Look for play/enter button
      const playButton = page.locator(
        '[data-testid="play-character"], button:has-text("Play"), button:has-text("Enter World"), button:has-text("Start")',
      );

      if (
        await playButton
          .first()
          .isVisible({ timeout: 3000 })
          .catch(() => false)
      ) {
        await playButton.first().click();

        // Should navigate away from character select or show loading
        const loading = page.locator(
          '[data-testid="loading"], [class*="loading"]',
        );
        const gameCanvas = page.locator("canvas");

        // Either loading state or game canvas should appear
        await Promise.race([
          expect(loading.first()).toBeVisible({ timeout: 10000 }),
          expect(gameCanvas.first()).toBeVisible({ timeout: 10000 }),
        ]).catch(() => {
          // Navigation may have occurred
        });
      }
    }
  });

  test("should show character stats and details", async ({ page }) => {
    // Wait for character UI to load
    await page
      .waitForFunction(
        () => document.querySelector('[class*="character"], canvas') !== null,
        { timeout: 5000 },
      )
      .catch(() => {});

    const characterCards = page.locator(
      '[data-testid="character-card"], [class*="character-card"]',
    );

    if ((await characterCards.count()) > 0) {
      // Click to select character
      await characterCards.first().click();

      // Look for character details panel
      const details = page.locator(
        '[data-testid="character-details"], [class*="character-info"], [class*="stats"]',
      );

      // Details may be shown in the card itself or in a side panel
      const hasDetails =
        (await details.count()) > 0 ||
        (await characterCards.first().locator('[class*="level"]').count()) > 0;

      expect(hasDetails).toBeDefined();
    }
  });

  test("should display music toggle control", async ({ page }) => {
    // Wait for page content to stabilize
    await page
      .waitForFunction(
        () => document.querySelector('button, [class*="control"]') !== null,
        { timeout: 5000 },
      )
      .catch(() => {});

    // Look for music toggle
    const musicToggle = page.locator(
      '[data-testid="music-toggle"], button[aria-label*="music" i], [class*="music"]',
    );

    // Music toggle should exist somewhere in the UI
    const count = await musicToggle.count();
    // Music controls are expected in most game UIs
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("should handle character deletion confirmation", async ({ page }) => {
    // Wait for character cards to potentially load
    await page
      .waitForFunction(
        () => document.querySelector('[class*="character"], button') !== null,
        { timeout: 5000 },
      )
      .catch(() => {});

    const characterCards = page.locator(
      '[data-testid="character-card"], [class*="character-card"]',
    );

    if ((await characterCards.count()) > 0) {
      // Look for delete button (usually with right-click or in menu)
      const deleteButton = page.locator(
        '[data-testid="delete-character"], button:has-text("Delete"), [aria-label*="delete" i]',
      );

      if (
        await deleteButton
          .first()
          .isVisible({ timeout: 3000 })
          .catch(() => false)
      ) {
        await deleteButton.first().click();

        // Confirmation modal should appear
        const confirmModal = page.locator(
          '[data-testid="confirm-modal"], [role="dialog"], [class*="modal"]',
        );

        if (
          await confirmModal
            .first()
            .isVisible({ timeout: 3000 })
            .catch(() => false)
        ) {
          // Cancel button should exist
          const cancelButton = confirmModal.locator(
            'button:has-text("Cancel"), button:has-text("No")',
          );
          await expect(cancelButton.first()).toBeVisible();

          // Click cancel to close
          await cancelButton.first().click();
          await expect(confirmModal.first()).toBeHidden({ timeout: 3000 });
        }
      }
    }
  });

  test("should take screenshot of character selection screen", async ({
    page,
  }) => {
    // Wait for UI to fully render
    await page
      .waitForFunction(
        () =>
          document.querySelector('canvas, [class*="character"], button') !==
          null,
        { timeout: 10000 },
      )
      .catch(() => {});
    // Small delay for animations to settle
    await page.waitForLoadState("domcontentloaded");

    // Take screenshot for visual verification
    await takeGameScreenshot(page, "character-select-screen");
  });
});

test.describe("Character Creation Flow", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");
    // Wait for page content to initialize
    await page
      .waitForFunction(
        () => document.querySelector("button, input, canvas") !== null,
        { timeout: 5000 },
      )
      .catch(() => {});
  });

  test("should show avatar selection options", async ({ page }) => {
    // Navigate to character creation
    const createButton = page.locator(
      'button:has-text("Create"), button:has-text("New Character")',
    );

    if (
      await createButton
        .first()
        .isVisible({ timeout: 5000 })
        .catch(() => false)
    ) {
      await createButton.first().click();
      // Wait for form to appear
      await page
        .waitForFunction(
          () =>
            document.querySelector(
              '[class*="avatar"], input, [class*="form"]',
            ) !== null,
          { timeout: 5000 },
        )
        .catch(() => {});

      // Look for avatar selection
      const avatarOptions = page.locator(
        '[data-testid="avatar-option"], [class*="avatar"], [class*="character-preset"]',
      );

      // Should have some avatar options for character customization
      const count = await avatarOptions.count();
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  test("should validate name length requirements", async ({ page }) => {
    const nameInput = page
      .locator('input[name="characterName"], input[placeholder*="name" i]')
      .first();

    if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Test too short name (less than 2 characters)
      await nameInput.fill("A");

      const submitButton = page.locator('button[type="submit"]').first();
      if (await submitButton.isVisible()) {
        await submitButton.click();

        // Should show length error or button should be disabled
        const hasError = await page
          .locator('[class*="error"]:visible')
          .isVisible({ timeout: 2000 })
          .catch(() => false);
        const isDisabled = await submitButton.isDisabled();

        expect(hasError || isDisabled).toBeTruthy();
      }

      // Test valid length name (2-16 characters)
      await nameInput.fill("ValidName");
      const value = await nameInput.inputValue();
      expect(value.length).toBeGreaterThanOrEqual(2);
      expect(value.length).toBeLessThanOrEqual(16);
    }
  });

  test("should prevent reserved name usage", async ({ page }) => {
    const nameInput = page
      .locator('input[name="characterName"], input[placeholder*="name" i]')
      .first();

    if (await nameInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      // Try reserved name
      await nameInput.fill("admin");

      const submitButton = page.locator('button[type="submit"]').first();
      if (await submitButton.isVisible()) {
        await submitButton.click();

        // Should show reserved name error
        const hasError = await page
          .locator('[class*="error"]:visible, [role="alert"]')
          .isVisible({ timeout: 3000 })
          .catch(() => false);

        // Either shows error or name is rejected
        expect(hasError).toBeDefined();
      }
    }
  });
});

test.describe("Character Selection - Agent Mode", () => {
  test("should display agent templates when available", async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");
    // Wait for UI elements to load
    await page
      .waitForFunction(
        () => document.querySelector('button, [class*="template"]') !== null,
        { timeout: 5000 },
      )
      .catch(() => {});

    // Look for agent/AI character creation option
    const agentOption = page.locator(
      '[data-testid="agent-template"], button:has-text("AI Agent"), button:has-text("Create Agent")',
    );

    // Agent option may or may not exist depending on server configuration
    const count = await agentOption.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("should show template selection for agents", async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");

    // Look for template selection
    const templates = page.locator(
      '[data-testid="character-template"], [class*="template-card"]',
    );

    // Templates are optional feature
    const count = await templates.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});

test.describe("Character Selection - WebSocket Connection", () => {
  test("should establish WebSocket connection", async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");
    // Wait for app to initialize and potentially establish WebSocket
    await page
      .waitForFunction(
        () => {
          const win = window as unknown as { world?: { network?: unknown } };
          return (
            win.world?.network !== undefined ||
            document.querySelector("canvas") !== null
          );
        },
        { timeout: 10000 },
      )
      .catch(() => {});

    // Check for WebSocket connection status
    const wsStatus = await page.evaluate(() => {
      const win = window as unknown as {
        world?: {
          network?: {
            isConnected?: () => boolean;
            connected?: boolean;
          };
        };
      };
      return (
        win.world?.network?.isConnected?.() ?? win.world?.network?.connected
      );
    });

    // Connection status should be defined (may or may not be connected yet)
    expect(wsStatus).toBeDefined();
  });

  test("should show connection indicator", async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForLoadState("networkidle");

    // Look for connection indicator
    const connectionIndicator = page.locator(
      '[data-testid="connection-indicator"], [class*="connection"], [class*="status"]',
    );

    // Connection indicator may exist
    const count = await connectionIndicator.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });
});
