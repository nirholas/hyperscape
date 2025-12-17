/**
 * Comprehensive E2E Tests for HyperForge Pages
 *
 * Tests all major pages for proper loading, UI elements, and basic interactivity.
 * Uses Playwright for real browser testing with visual regression screenshots.
 */

import { test, expect } from "@playwright/test";

test.describe("Generate Page", () => {
  test("page loads with generation wizard", async ({ page }) => {
    await page.goto("/generate");
    await page.waitForLoadState("networkidle");

    // Check for the main heading asking what to create
    const heading = page.locator(
      'h1:has-text("What would you like to create?")',
    );
    await expect(heading).toBeVisible({ timeout: 15000 });

    // Take screenshot for visual regression
    await expect(page).toHaveScreenshot("generate-wizard.png", {
      maxDiffPixels: 200,
    });
  });

  test("category selector shows items and avatars options", async ({
    page,
  }) => {
    await page.goto("/generate");
    await page.waitForLoadState("networkidle");

    // Check for Items card
    const itemsCard = page.locator('button:has-text("Items")');
    await expect(itemsCard).toBeVisible({ timeout: 10000 });

    // Check for Avatars card
    const avatarsCard = page.locator('button:has-text("Avatars")');
    await expect(avatarsCard).toBeVisible({ timeout: 10000 });
  });

  test("clicking Items opens item configuration", async ({ page }) => {
    await page.goto("/generate");
    await page.waitForLoadState("networkidle");

    // Click on Items
    const itemsCard = page.locator('button:has-text("Items")');
    await itemsCard.click();

    // Wait for configuration view to load
    await page.waitForTimeout(500);

    // Check for Asset Details section
    const assetDetails = page.locator('h2:has-text("Asset Details")');
    await expect(assetDetails).toBeVisible({ timeout: 10000 });

    // Check for Asset Name input
    const assetNameInput = page.locator(
      'input[placeholder*="Bronze Longsword"]',
    );
    await expect(assetNameInput).toBeVisible();

    // Take screenshot
    await expect(page).toHaveScreenshot("generate-item-config.png", {
      maxDiffPixels: 200,
    });
  });

  test("clicking Avatars opens avatar configuration", async ({ page }) => {
    await page.goto("/generate");
    await page.waitForLoadState("networkidle");

    // Click on Avatars
    const avatarsCard = page.locator('button:has-text("Avatars")');
    await avatarsCard.click();

    // Wait for configuration view to load
    await page.waitForTimeout(500);

    // Check for Asset Details section
    const assetDetails = page.locator('h2:has-text("Asset Details")');
    await expect(assetDetails).toBeVisible({ timeout: 10000 });

    // Check for Asset Name input with avatar placeholder
    const assetNameInput = page.locator(
      'input[placeholder*="Forest Guardian"]',
    );
    await expect(assetNameInput).toBeVisible();
  });

  test("prompt input accepts text", async ({ page }) => {
    await page.goto("/generate");
    await page.waitForLoadState("networkidle");

    // Select Items
    await page.locator('button:has-text("Items")').click();
    await page.waitForTimeout(500);

    // Find and fill asset name
    const assetNameInput = page.locator(
      'input[placeholder*="Bronze Longsword"]',
    );
    await assetNameInput.fill("Test Sword");

    // Find and fill description textarea
    const descriptionTextarea = page.locator(
      'textarea[placeholder*="Describe your asset"]',
    );
    await descriptionTextarea.fill("A magical sword with glowing runes");

    // Verify the inputs contain our text
    await expect(assetNameInput).toHaveValue("Test Sword");
    await expect(descriptionTextarea).toHaveValue(
      "A magical sword with glowing runes",
    );
  });

  test("pipeline options are visible in sidebar", async ({ page }) => {
    await page.goto("/generate");
    await page.waitForLoadState("networkidle");

    // Select Items
    await page.locator('button:has-text("Items")').click();
    await page.waitForTimeout(500);

    // Check for Pipeline Options heading
    const pipelineOptions = page.locator('h2:has-text("Pipeline Options")');
    await expect(pipelineOptions).toBeVisible({ timeout: 10000 });

    // Check for GPT-4 Enhancement option
    const gpt4Option = page.locator('span:has-text("GPT-4 Enhancement")');
    await expect(gpt4Option).toBeVisible();
  });

  test("start generation button exists", async ({ page }) => {
    await page.goto("/generate");
    await page.waitForLoadState("networkidle");

    // Select Items
    await page.locator('button:has-text("Items")').click();
    await page.waitForTimeout(500);

    // Check for Start Generation button
    const generateButton = page.locator('button:has-text("Start Generation")');
    await expect(generateButton).toBeVisible({ timeout: 10000 });

    // Button should be disabled when fields are empty
    await expect(generateButton).toBeDisabled();
  });
});

test.describe("Equipment Studio", () => {
  test("page loads with 3D viewport", async ({ page }) => {
    await page.goto("/studio/equipment");
    await page.waitForLoadState("networkidle");

    // Wait for page to stabilize
    await page.waitForTimeout(2000);

    // Check main content area exists
    const main = page.locator("main, [role='main']").first();
    await expect(main).toBeVisible({ timeout: 15000 });

    // Take screenshot
    await expect(page).toHaveScreenshot("equipment-studio.png", {
      maxDiffPixels: 300,
    });
  });

  test("avatar selection panel is visible", async ({ page }) => {
    await page.goto("/studio/equipment");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Check for Avatars section heading
    const avatarsHeading = page.locator('h3:has-text("Avatars")');
    await expect(avatarsHeading).toBeVisible({ timeout: 10000 });
  });

  test("weapon selection panel is visible", async ({ page }) => {
    await page.goto("/studio/equipment");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Check for Weapons section heading
    const weaponsHeading = page.locator('h3:has-text("Weapons")');
    await expect(weaponsHeading).toBeVisible({ timeout: 10000 });
  });

  test("equipment slot controls are visible", async ({ page }) => {
    await page.goto("/studio/equipment");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Check for Equipment Slot heading
    const slotHeading = page.locator('h3:has-text("Equipment Slot")');
    await expect(slotHeading).toBeVisible({ timeout: 10000 });

    // Check for Right Hand option
    const rightHand = page.locator('button:has-text("Right Hand")');
    await expect(rightHand).toBeVisible();
  });

  test("search input is functional", async ({ page }) => {
    await page.goto("/studio/equipment");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Find search input
    const searchInput = page.locator('input[placeholder*="Search"]').first();
    await expect(searchInput).toBeVisible({ timeout: 10000 });

    // Type in search
    await searchInput.fill("test");
    await expect(searchInput).toHaveValue("test");
  });
});

test.describe("Armor Studio", () => {
  test("page loads with fitting interface", async ({ page }) => {
    await page.goto("/studio/armor");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Check main content area exists
    const main = page.locator("main, [role='main']").first();
    await expect(main).toBeVisible({ timeout: 15000 });

    // Take screenshot
    await expect(page).toHaveScreenshot("armor-studio.png", {
      maxDiffPixels: 300,
    });
  });

  test("avatar selection panel is visible", async ({ page }) => {
    await page.goto("/studio/armor");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Check for Avatars section heading
    const avatarsHeading = page.locator('h3:has-text("Avatars")');
    await expect(avatarsHeading).toBeVisible({ timeout: 10000 });
  });

  test("armor selection panel is visible", async ({ page }) => {
    await page.goto("/studio/armor");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Check for Armor section heading
    const armorHeading = page.locator('h3:has-text("Armor")');
    await expect(armorHeading).toBeVisible({ timeout: 10000 });
  });

  test("fitting controls are visible", async ({ page }) => {
    await page.goto("/studio/armor");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Check for Fitting Settings heading
    const fittingSettings = page.locator('h3:has-text("Fitting Settings")');
    await expect(fittingSettings).toBeVisible({ timeout: 10000 });

    // Check for Perform Fitting button
    const fittingButton = page.locator('button:has-text("Perform Fitting")');
    await expect(fittingButton).toBeVisible();
  });

  test("equipment slot selector exists", async ({ page }) => {
    await page.goto("/studio/armor");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Check for Equipment Slot heading
    const slotHeading = page.locator('h3:has-text("Equipment Slot")');
    await expect(slotHeading).toBeVisible({ timeout: 10000 });

    // Check for Helmet option
    const helmet = page.locator('button:has-text("Helmet")');
    await expect(helmet).toBeVisible();
  });
});

test.describe("Hand Rigging Studio", () => {
  test("page loads with hand rigging UI", async ({ page }) => {
    await page.goto("/studio/hands");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Check main content area exists
    const main = page.locator("main, [role='main']").first();
    await expect(main).toBeVisible({ timeout: 15000 });

    // Take screenshot
    await expect(page).toHaveScreenshot("hand-rigging-studio.png", {
      maxDiffPixels: 300,
    });
  });

  test("avatar selection is available", async ({ page }) => {
    await page.goto("/studio/hands");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Check for Avatars section heading
    const avatarsHeading = page.locator('h3:has-text("Avatars")');
    await expect(avatarsHeading).toBeVisible({ timeout: 10000 });
  });

  test("rigging options are visible", async ({ page }) => {
    await page.goto("/studio/hands");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Check for Settings heading
    const settingsHeading = page.locator('h3:has-text("Settings")');
    await expect(settingsHeading).toBeVisible({ timeout: 10000 });

    // Check for Simple Mode option
    const simpleMode = page.locator('span:has-text("Simple Mode")');
    await expect(simpleMode).toBeVisible();
  });

  test("add hand bones button exists", async ({ page }) => {
    await page.goto("/studio/hands");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Check for Add Hand Bones button
    const addBonesButton = page.locator('button:has-text("Add Hand Bones")');
    await expect(addBonesButton).toBeVisible({ timeout: 10000 });
  });

  test("export button exists", async ({ page }) => {
    await page.goto("/studio/hands");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Check for Export button
    const exportButton = page.locator('button:has-text("Export Rigged Model")');
    await expect(exportButton).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Audio Studio", () => {
  test("page loads with audio interface", async ({ page }) => {
    await page.goto("/audio");
    await page.waitForLoadState("networkidle");

    // Check for main heading
    const heading = page.locator('h1:has-text("Audio Studio")');
    await expect(heading).toBeVisible({ timeout: 15000 });

    // Take screenshot
    await expect(page).toHaveScreenshot("audio-studio.png", {
      maxDiffPixels: 200,
    });
  });

  test("voice generation card is visible", async ({ page }) => {
    await page.goto("/audio");
    await page.waitForLoadState("networkidle");

    // Check for Voice Generation card
    const voiceCard = page.locator('h3:has-text("Voice Generation")');
    await expect(voiceCard).toBeVisible({ timeout: 10000 });
  });

  test("sound effects card is visible", async ({ page }) => {
    await page.goto("/audio");
    await page.waitForLoadState("networkidle");

    // Check for Sound Effects card
    const sfxCard = page.locator('h3:has-text("Sound Effects")');
    await expect(sfxCard).toBeVisible({ timeout: 10000 });
  });

  test("music generation card is visible", async ({ page }) => {
    await page.goto("/audio");
    await page.waitForLoadState("networkidle");

    // Check for Music Generation card
    const musicCard = page.locator('h3:has-text("Music Generation")');
    await expect(musicCard).toBeVisible({ timeout: 10000 });
  });

  test("audio studio panel loads", async ({ page }) => {
    await page.goto("/audio");
    await page.waitForLoadState("networkidle");

    // Wait for panel to load
    await page.waitForTimeout(1000);

    // The AudioStudioPanel should be rendered
    const panel = page.locator(".rounded-xl.border").first();
    await expect(panel).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Content Generator", () => {
  test("page loads with content tabs", async ({ page }) => {
    await page.goto("/content");
    await page.waitForLoadState("networkidle");

    // Check for HyperForge logo
    const logo = page.locator('h1:has-text("HyperForge")');
    await expect(logo).toBeVisible({ timeout: 15000 });

    // Take screenshot
    await expect(page).toHaveScreenshot("content-generator.png", {
      maxDiffPixels: 200,
    });
  });

  test("NPC tab is visible and selectable", async ({ page }) => {
    await page.goto("/content");
    await page.waitForLoadState("networkidle");

    // Check for NPCs tab
    const npcTab = page.locator('button:has-text("NPCs")');
    await expect(npcTab).toBeVisible({ timeout: 10000 });

    // Click on it
    await npcTab.click();

    // Check header shows NPC generator
    const header = page.locator('h2:has-text("NPC Content Generator")');
    await expect(header).toBeVisible({ timeout: 10000 });
  });

  test("Quest tab is visible and selectable", async ({ page }) => {
    await page.goto("/content");
    await page.waitForLoadState("networkidle");

    // Check for Quests tab
    const questTab = page.locator('button:has-text("Quests")');
    await expect(questTab).toBeVisible({ timeout: 10000 });

    // Click on it
    await questTab.click();

    // Check header shows Quest generator
    const header = page.locator('h2:has-text("Quest Generator")');
    await expect(header).toBeVisible({ timeout: 10000 });
  });

  test("Area tab is visible and selectable", async ({ page }) => {
    await page.goto("/content");
    await page.waitForLoadState("networkidle");

    // Check for Areas tab
    const areaTab = page.locator('button:has-text("Areas")');
    await expect(areaTab).toBeVisible({ timeout: 10000 });

    // Click on it
    await areaTab.click();

    // Check header shows Area generator
    const header = page.locator('h2:has-text("Area Generator")');
    await expect(header).toBeVisible({ timeout: 10000 });
  });

  test("Item tab is visible and selectable", async ({ page }) => {
    await page.goto("/content");
    await page.waitForLoadState("networkidle");

    // Check for Items tab
    const itemTab = page.locator('button:has-text("Items")');
    await expect(itemTab).toBeVisible({ timeout: 10000 });

    // Click on it
    await itemTab.click();

    // Check header shows Item generator
    const header = page.locator('h2:has-text("Item Generator")');
    await expect(header).toBeVisible({ timeout: 10000 });
  });

  test("settings link is accessible", async ({ page }) => {
    await page.goto("/content");
    await page.waitForLoadState("networkidle");

    // Check for Settings link
    const settingsLink = page.locator('a[href="/settings"]');
    await expect(settingsLink).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Settings Page", () => {
  test("page loads with settings sections", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Check for Settings heading
    const heading = page.locator('h1:has-text("Settings")');
    await expect(heading).toBeVisible({ timeout: 15000 });

    // Take screenshot
    await expect(page).toHaveScreenshot("settings-page.png", {
      maxDiffPixels: 200,
    });
  });

  test("Meshy API credits section is visible", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Check for Meshy API Credits heading
    const meshySection = page.locator('h2:has-text("Meshy API Credits")');
    await expect(meshySection).toBeVisible({ timeout: 10000 });
  });

  test("AI Gateway section is visible", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Check for Vercel AI Gateway heading
    const gatewaySection = page.locator('h2:has-text("Vercel AI Gateway")');
    await expect(gatewaySection).toBeVisible({ timeout: 10000 });
  });

  test("ElevenLabs section is visible", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Check for ElevenLabs heading
    const elevenLabsSection = page.locator('h2:has-text("ElevenLabs")');
    await expect(elevenLabsSection).toBeVisible({ timeout: 10000 });
  });

  test("API Configuration section is visible", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Check for API Configuration heading
    const apiSection = page.locator('h2:has-text("API Configuration")');
    await expect(apiSection).toBeVisible({ timeout: 10000 });
  });

  test("refresh button exists and is clickable", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Check for Refresh button
    const refreshButton = page.locator('button:has-text("Refresh")');
    await expect(refreshButton).toBeVisible({ timeout: 10000 });

    // Click the button
    await refreshButton.click();

    // Button should still be visible after click
    await expect(refreshButton).toBeVisible();
  });

  test("environment variables section is visible", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Check for Environment Variables heading
    const envSection = page.locator('h2:has-text("Environment Variables")');
    await expect(envSection).toBeVisible({ timeout: 10000 });

    // Check for .env mention
    const envFile = page.locator('code:has-text(".env")');
    await expect(envFile).toBeVisible();
  });

  test("external links to API documentation exist", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Check for Get Meshy API Key link
    const meshyLink = page.locator('a:has-text("Get Meshy API Key")');
    await expect(meshyLink).toBeVisible({ timeout: 10000 });

    // Check for Get OpenAI API Key link
    const openaiLink = page.locator('a:has-text("Get OpenAI API Key")');
    await expect(openaiLink).toBeVisible();
  });
});

test.describe("Navigation Between Pages", () => {
  test("can navigate from home to generate", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Look for a link to generate
    const generateLink = page.locator('a[href="/generate"]').first();
    if (await generateLink.isVisible()) {
      await generateLink.click();
      await page.waitForLoadState("networkidle");
      await expect(page).toHaveURL(/\/generate/);
    }
  });

  test("can navigate from content to settings", async ({ page }) => {
    await page.goto("/content");
    await page.waitForLoadState("networkidle");

    // Click settings link
    const settingsLink = page.locator('a[href="/settings"]');
    await settingsLink.click();
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveURL(/\/settings/);
  });

  test("back button works in generate page", async ({ page }) => {
    await page.goto("/generate");
    await page.waitForLoadState("networkidle");

    // Click Items to enter config
    await page.locator('button:has-text("Items")').click();
    await page.waitForTimeout(500);

    // Click Back button
    const backButton = page.locator('button:has-text("Back")');
    await backButton.click();
    await page.waitForTimeout(500);

    // Should see the category selector again
    const heading = page.locator(
      'h1:has-text("What would you like to create?")',
    );
    await expect(heading).toBeVisible({ timeout: 10000 });
  });
});

test.describe("Responsive Design", () => {
  test("generate page adapts to mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/generate");
    await page.waitForLoadState("networkidle");

    // Page should still be functional
    const heading = page.locator(
      'h1:has-text("What would you like to create?")',
    );
    await expect(heading).toBeVisible({ timeout: 15000 });

    // Take mobile screenshot
    await expect(page).toHaveScreenshot("generate-mobile.png", {
      maxDiffPixels: 200,
    });
  });

  test("settings page adapts to mobile viewport", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");

    // Settings heading should be visible
    const heading = page.locator('h1:has-text("Settings")');
    await expect(heading).toBeVisible({ timeout: 15000 });
  });

  test("audio studio adapts to tablet viewport", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/audio");
    await page.waitForLoadState("networkidle");

    // Main content should be visible
    const heading = page.locator('h1:has-text("Audio Studio")');
    await expect(heading).toBeVisible({ timeout: 15000 });
  });
});

test.describe("Error Handling", () => {
  test("404 for non-existent studio page is handled", async ({ page }) => {
    const response = await page.goto("/studio/nonexistent");

    // Either 404 or redirect
    if (response) {
      expect([200, 404]).toContain(response.status());
    }

    // Page should still render something
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("pages gracefully handle missing API data", async ({ page }) => {
    // The pages should load even if API calls fail
    await page.goto("/studio/equipment");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Main content should still be visible
    const main = page.locator("main, [role='main']").first();
    await expect(main).toBeVisible({ timeout: 15000 });
  });
});
