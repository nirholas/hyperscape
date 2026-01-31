/**
 * InteractionRouter
 *
 * Main coordinator for the interaction system.
 * Replaces the legacy InteractionSystem god class.
 *
 * Responsibilities:
 * - Listen to input events (mouse, touch)
 * - Delegate to RaycastService for entity detection
 * - Route to appropriate handler based on entity type
 * - Manage handler registration
 * - Coordinate visual feedback and context menus
 *
 * This is a slim coordinator (~200 lines) that delegates
 * actual interaction logic to focused handler classes.
 */

import { System } from "../../shared/infrastructure/System";
import type { World } from "../../../core/World";
import type { InteractableEntityType, ContextMenuAction } from "./types";
import type { Position3D } from "../../../types/core/base-types";
import { INPUT, TIMING, MESSAGE_TYPES, DEBUG_INTERACTIONS } from "./constants";
import { EventType } from "../../../types/events/event-types";
import { worldToTile, tileToWorld } from "../../shared/movement/TileSystem";

// Services
import { ActionQueueService } from "./services/ActionQueueService";
import { RaycastService } from "./services/RaycastService";
import { VisualFeedbackService } from "./services/VisualFeedbackService";
import { ContextMenuController } from "./ContextMenuController";

// Handlers
import { BaseInteractionHandler } from "./handlers/BaseInteractionHandler";
import { ItemInteractionHandler } from "./handlers/ItemInteractionHandler";
import { NPCInteractionHandler } from "./handlers/NPCInteractionHandler";
import { MobInteractionHandler } from "./handlers/MobInteractionHandler";
import { ResourceInteractionHandler } from "./handlers/ResourceInteractionHandler";
import { BankInteractionHandler } from "./handlers/BankInteractionHandler";
import { CorpseInteractionHandler } from "./handlers/CorpseInteractionHandler";
import { PlayerInteractionHandler } from "./handlers/PlayerInteractionHandler";
import { CookingSourceInteractionHandler } from "./handlers/CookingSourceInteractionHandler";
import { SmeltingSourceInteractionHandler } from "./handlers/SmeltingSourceInteractionHandler";
import { SmithingSourceInteractionHandler } from "./handlers/SmithingSourceInteractionHandler";
import { AltarInteractionHandler } from "./handlers/AltarInteractionHandler";
import { StarterChestInteractionHandler } from "./handlers/StarterChestInteractionHandler";
import { ForfeitPillarInteractionHandler } from "./handlers/ForfeitPillarInteractionHandler";
import { RunecraftingAltarInteractionHandler } from "./handlers/RunecraftingAltarInteractionHandler";

/**
 * Targeting mode state for "Use X on Y" interactions
 */
interface TargetingModeState {
  active: boolean;
  sourceItem: { id: string; slot: number; name?: string } | null;
  validTargetIds: Set<string>;
  actionType: "firemaking" | "cooking" | "smelting" | "none";
}

export class InteractionRouter extends System {
  private canvas: HTMLCanvasElement | null = null;

  // Services
  private actionQueue: ActionQueueService;
  private raycastService: RaycastService;
  private visualFeedback: VisualFeedbackService;
  private contextMenu: ContextMenuController;

  // Handlers by entity type
  private handlers = new Map<InteractableEntityType, BaseInteractionHandler>();

  // Input state
  private isDragging = false;
  private mouseDownButton: number | null = null;
  private mouseDownClientPos: { x: number; y: number } | null = null;
  private touchStart: { x: number; y: number; time: number } | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;

  // Targeting mode state (OSRS "Use X on Y")
  private targetingMode: TargetingModeState = {
    active: false,
    sourceItem: null,
    validTargetIds: new Set(),
    actionType: "none",
  };

  constructor(world: World) {
    super(world);

    // Initialize services
    this.actionQueue = new ActionQueueService(world);
    this.raycastService = new RaycastService(world);
    this.visualFeedback = new VisualFeedbackService(world);
    this.contextMenu = new ContextMenuController();

    // Register handlers
    this.registerHandlers();
  }

  /**
   * Get the shared RaycastService instance
   *
   * Other systems (e.g., ClientCameraSystem) should use this
   * instead of creating their own instance, to benefit from
   * shared caching (16ms frame-based cache).
   */
  getRaycastService(): RaycastService {
    return this.raycastService;
  }

  private registerHandlers(): void {
    this.handlers.set(
      "item",
      new ItemInteractionHandler(this.world, this.actionQueue),
    );
    this.handlers.set(
      "npc",
      new NPCInteractionHandler(this.world, this.actionQueue),
    );
    this.handlers.set(
      "mob",
      new MobInteractionHandler(this.world, this.actionQueue),
    );
    this.handlers.set(
      "resource",
      new ResourceInteractionHandler(this.world, this.actionQueue),
    );
    this.handlers.set(
      "bank",
      new BankInteractionHandler(this.world, this.actionQueue),
    );
    this.handlers.set(
      "corpse",
      new CorpseInteractionHandler(this.world, this.actionQueue),
    );
    this.handlers.set(
      "headstone",
      new CorpseInteractionHandler(this.world, this.actionQueue),
    );
    this.handlers.set(
      "player",
      new PlayerInteractionHandler(this.world, this.actionQueue),
    );
    // Cooking sources (fires and ranges)
    const cookingHandler = new CookingSourceInteractionHandler(
      this.world,
      this.actionQueue,
    );
    this.handlers.set("fire", cookingHandler);
    this.handlers.set("range", cookingHandler);

    // Smelting source (furnaces)
    this.handlers.set(
      "furnace",
      new SmeltingSourceInteractionHandler(this.world, this.actionQueue),
    );

    // Smithing source (anvils)
    this.handlers.set(
      "anvil",
      new SmithingSourceInteractionHandler(this.world, this.actionQueue),
    );

    // Altar (prayer recharge)
    this.handlers.set(
      "altar",
      new AltarInteractionHandler(this.world, this.actionQueue),
    );

    // Runecrafting altar (essence → runes)
    this.handlers.set(
      "runecrafting_altar",
      new RunecraftingAltarInteractionHandler(this.world, this.actionQueue),
    );

    // Starter chest (new player equipment)
    this.handlers.set(
      "starter_chest",
      new StarterChestInteractionHandler(this.world, this.actionQueue),
    );

    // Forfeit pillar (duel arena surrender)
    this.handlers.set(
      "forfeit_pillar",
      new ForfeitPillarInteractionHandler(this.world, this.actionQueue),
    );
  }

  override start(): void {
    this.canvas = this.world.graphics?.renderer?.domElement ?? null;
    if (!this.canvas) {
      console.warn(`[InteractionRouter] No canvas found, graphics not ready`);
      return;
    }

    // Initialize visual feedback
    this.visualFeedback.initialize();

    // Bind event handlers
    this.onCanvasClick = this.onCanvasClick.bind(this);
    this.onContextMenu = this.onContextMenu.bind(this);
    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onTouchStart = this.onTouchStart.bind(this);
    this.onTouchEnd = this.onTouchEnd.bind(this);

    // Add event listeners
    this.canvas.addEventListener("click", this.onCanvasClick, false);
    this.canvas.addEventListener("contextmenu", this.onContextMenu, true);
    this.canvas.addEventListener("mousedown", this.onMouseDown, true);
    this.canvas.addEventListener("mouseup", this.onMouseUp, false);
    this.canvas.addEventListener("mousemove", this.onMouseMove, false);
    this.canvas.addEventListener("touchstart", this.onTouchStart, true);
    this.canvas.addEventListener("touchend", this.onTouchEnd, true);

    // Listen for camera tap events on mobile
    this.world.on(EventType.CAMERA_TAP, this.onCameraTap);

    // Listen for entity modification events to detect movement completion
    // This is critical for accurate item pickup (range 0 actions)
    this.world.on(EventType.ENTITY_MODIFIED, this.onEntityModified);

    // Listen for targeting mode events (OSRS "Use X on Y")
    this.world.on(EventType.TARGETING_START, this.onTargetingStart);
    this.world.on(EventType.TARGETING_COMPLETE, this.onTargetingComplete);
    this.world.on(EventType.TARGETING_CANCEL, this.onTargetingCancel);
  }

  override update(): void {
    // Update action queue (check if player reached targets)
    this.actionQueue.update();

    // Update visual feedback (animate markers)
    this.visualFeedback.update();
  }

  /**
   * Cancel any pending client-side action (walk-to, interaction).
   * Used when player teleports to prevent stale actions from executing.
   */
  cancelCurrentAction(): void {
    this.actionQueue.cancelCurrentAction();
    this.visualFeedback.hideTargetMarker();
  }

  override destroy(): void {
    if (this.canvas) {
      this.canvas.removeEventListener("click", this.onCanvasClick);
      this.canvas.removeEventListener("contextmenu", this.onContextMenu);
      this.canvas.removeEventListener("mousedown", this.onMouseDown);
      this.canvas.removeEventListener("mouseup", this.onMouseUp);
      this.canvas.removeEventListener("mousemove", this.onMouseMove);
      this.canvas.removeEventListener("touchstart", this.onTouchStart);
      this.canvas.removeEventListener("touchend", this.onTouchEnd);
    }

    this.world.off(EventType.CAMERA_TAP, this.onCameraTap);
    this.world.off(EventType.ENTITY_MODIFIED, this.onEntityModified);
    this.world.off(EventType.TARGETING_START, this.onTargetingStart);
    this.world.off(EventType.TARGETING_COMPLETE, this.onTargetingComplete);
    this.world.off(EventType.TARGETING_CANCEL, this.onTargetingCancel);

    this.actionQueue.destroy();
    this.visualFeedback.destroy();
    this.contextMenu.destroy();

    // Clear handlers map to prevent memory leaks on recreation
    this.handlers.clear();

    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
    }

    super.destroy();
  }

  // === Input Handlers ===

  private onCanvasClick = (event: MouseEvent): void => {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (!this.canvas || !this.areControlsEnabled()) return;
    if (this.isEventFromModal(event)) return;

    // Check for entity at click position
    const target = this.raycastService.getEntityAtPosition(
      event.clientX,
      event.clientY,
      this.canvas,
    );

    // OSRS-style targeting mode: handle world entity clicks for cooking
    if (this.targetingMode.active) {
      event.preventDefault();

      if (target && this.isValidWorldTarget(target.entityId)) {
        // Valid target clicked - emit TARGETING_SELECT
        const player = this.world.getPlayer();
        if (player && this.targetingMode.sourceItem) {
          this.world.emit(EventType.TARGETING_SELECT, {
            playerId: player.id,
            sourceItemId: this.targetingMode.sourceItem.id,
            sourceSlot: this.targetingMode.sourceItem.slot,
            targetId: target.entityId,
            targetType: "world_entity" as const,
          });
        }
      } else {
        // Clicked empty space or invalid target - cancel targeting mode
        const player = this.world.getPlayer();
        if (player) {
          this.world.emit(EventType.TARGETING_CANCEL, { playerId: player.id });
        }
      }
      return;
    }

    if (target) {
      // Show red X click indicator
      this.visualFeedback.showClickIndicator(target.hitPoint, "entity");

      // Route to handler
      const handler = this.handlers.get(target.entityType);
      if (handler) {
        event.preventDefault();
        handler.onLeftClick(target);
        return;
      }
    }

    // No entity - handle as movement click
    event.preventDefault();
    this.handleMoveClick(event.clientX, event.clientY, event.shiftKey);
  };

  private onContextMenu = (event: MouseEvent): void => {
    if (!this.areControlsEnabled()) return;
    if (!this.canvas) return;
    if (this.isEventFromModal(event)) return;

    if (DEBUG_INTERACTIONS) console.time("[ContextMenu] Total");
    if (DEBUG_INTERACTIONS) console.time("[ContextMenu] Raycast");

    const target = this.raycastService.getEntityAtPosition(
      event.clientX,
      event.clientY,
      this.canvas,
    );

    if (DEBUG_INTERACTIONS) console.timeEnd("[ContextMenu] Raycast");

    if (target) {
      // Entity right-click - show entity-specific menu
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      const handler = this.handlers.get(target.entityType);
      if (handler) {
        if (DEBUG_INTERACTIONS) console.time("[ContextMenu] GetActions");
        const actions = handler.getContextMenuActions(target);
        if (DEBUG_INTERACTIONS) console.timeEnd("[ContextMenu] GetActions");

        if (DEBUG_INTERACTIONS) console.time("[ContextMenu] ShowMenu");
        this.contextMenu.showMenu(
          target,
          actions,
          event.clientX,
          event.clientY,
        );
        if (DEBUG_INTERACTIONS) console.timeEnd("[ContextMenu] ShowMenu");
      }
    } else {
      // Terrain right-click - show "Walk here" menu
      this.showTerrainContextMenu(event.clientX, event.clientY, event.shiftKey);
    }

    if (DEBUG_INTERACTIONS) console.timeEnd("[ContextMenu] Total");
  };

  /**
   * Show terrain context menu with "Walk here" and "Cancel" options
   * Used by both desktop right-click and mobile long-press
   */
  private showTerrainContextMenu(
    screenX: number,
    screenY: number,
    shiftKey: boolean = false,
  ): void {
    if (!this.canvas) return;

    const terrainPos = this.raycastService.getTerrainPosition(
      screenX,
      screenY,
      this.canvas,
    );

    if (!terrainPos) return;

    const walkAction: ContextMenuAction = {
      id: "walk-here",
      label: "Walk here",
      enabled: true,
      priority: 0,
      handler: () => {
        this.handleMoveClick(screenX, screenY, shiftKey);
      },
    };

    const cancelAction: ContextMenuAction = {
      id: "cancel",
      label: "Cancel",
      enabled: true,
      priority: 100,
      handler: () => {
        // Just close the menu - no action needed
      },
    };

    this.contextMenu.showMenu(
      null,
      [walkAction, cancelAction],
      screenX,
      screenY,
    );
  }

  private onMouseDown = (event: MouseEvent): void => {
    if (!this.areControlsEnabled()) return;

    // Skip if event originated from a modal or UI overlay
    if (this.isEventFromModal(event)) return;

    if (event.button === 2) {
      // Right-click - let onContextMenu handle the menu (avoid duplicate raycast)
      // Just track the mouse state here
    } else {
      // Left-click - close menus
      this.contextMenu.closeMenu();
    }

    this.isDragging = false;
    this.mouseDownButton = event.button;
    this.mouseDownClientPos = { x: event.clientX, y: event.clientY };
  };

  private onMouseUp = (_event: MouseEvent): void => {
    this.isDragging = false;
    this.mouseDownButton = null;
    this.mouseDownClientPos = null;
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (this.mouseDownButton === null || !this.mouseDownClientPos) return;

    const dx = event.clientX - this.mouseDownClientPos.x;
    const dy = event.clientY - this.mouseDownClientPos.y;

    if (
      !this.isDragging &&
      (Math.abs(dx) > INPUT.DRAG_THRESHOLD_PX ||
        Math.abs(dy) > INPUT.DRAG_THRESHOLD_PX)
    ) {
      this.isDragging = true;
    }
  };

  private onTouchStart = (event: TouchEvent): void => {
    if (!this.areControlsEnabled()) return;
    if (this.isEventFromModal(event)) return;

    const touch = event.touches[0];
    if (!touch) return;

    this.touchStart = {
      x: touch.clientX,
      y: touch.clientY,
      time: Date.now(),
    };

    // Long-press timer for context menu
    this.longPressTimer = setTimeout(() => {
      if (this.touchStart && this.canvas) {
        // Capture coordinates before clearing touchStart
        const touchX = this.touchStart.x;
        const touchY = this.touchStart.y;

        const target = this.raycastService.getEntityAtPosition(
          touchX,
          touchY,
          this.canvas,
        );

        if (target) {
          event.preventDefault();
          event.stopPropagation();

          const handler = this.handlers.get(target.entityType);
          if (handler) {
            const actions = handler.getContextMenuActions(target);
            this.contextMenu.showMenu(target, actions, touchX, touchY);
          }
        } else {
          // Terrain long-press - show "Walk here" menu (like right-click on desktop)
          this.showTerrainContextMenu(touchX, touchY, false);
        }
        this.touchStart = null;
      }
    }, TIMING.LONG_PRESS_MS);
  };

  private onTouchEnd = (_event: TouchEvent): void => {
    if (this.longPressTimer) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }

    if (
      this.touchStart &&
      Date.now() - this.touchStart.time < TIMING.LONG_PRESS_MS
    ) {
      this.touchStart = null;
      return;
    }

    this.touchStart = null;
  };

  private onCameraTap = (event: { x: number; y: number }): void => {
    if (!this.canvas || !this.areControlsEnabled()) return;

    // Check if tapping on entity
    const target = this.raycastService.getEntityAtPosition(
      event.x,
      event.y,
      this.canvas,
    );
    if (target) {
      return; // Handled by entity interaction
    }

    // Handle as movement
    this.handleMoveClick(event.x, event.y, false);
  };

  /**
   * Handle entity modification events to detect movement completion
   *
   * When player becomes "idle" (movement finished), check queued actions
   * using the server-authoritative position for accurate range checking.
   *
   * This is the OSRS-style pattern for reliable item pickup:
   * - Server sends final position in changes.p
   * - We use that exact position to check if player reached the item
   * - No reliance on interpolated client position
   */
  private onEntityModified = (data: {
    id: string;
    changes: { e?: string; p?: number[] };
  }): void => {
    // Only care about "idle" state (movement completed)
    if (data.changes.e !== "idle") return;

    // Only care about the local player
    const player = this.world.getPlayer();
    if (!player || player.id !== data.id) return;

    // Extract server-authoritative position from changes.p
    // CRITICAL: This is the accurate position, not the interpolated player.position
    let serverPosition: Position3D;

    // Validate position data to prevent NaN propagation
    const p = data.changes.p;
    if (
      Array.isArray(p) &&
      p.length >= 3 &&
      Number.isFinite(p[0]) &&
      Number.isFinite(p[1]) &&
      Number.isFinite(p[2])
    ) {
      serverPosition = { x: p[0], y: p[1], z: p[2] };
    } else {
      // Fallback to player position if data is malformed
      if (DEBUG_INTERACTIONS && p !== undefined) {
        console.warn(
          `[InteractionRouter] Invalid position data in ENTITY_MODIFIED:`,
          p,
        );
      }
      serverPosition = player.position;
    }

    // Notify action queue that player is now idle at this position
    this.actionQueue.onPlayerIdle(serverPosition);
  };

  // === Movement ===

  private handleMoveClick(
    screenX: number,
    screenY: number,
    shiftKey: boolean,
  ): void {
    if (!this.canvas || !this.world.camera) return;

    const terrainPos = this.raycastService.getTerrainPosition(
      screenX,
      screenY,
      this.canvas,
    );
    if (!terrainPos) return;

    // Show yellow X click indicator
    this.visualFeedback.showClickIndicator(
      { x: terrainPos.x, y: terrainPos.y, z: terrainPos.z },
      "ground",
    );

    // Cancel any pending action
    this.actionQueue.cancelCurrentAction();

    // Clamp distance from player
    const player = this.world.getPlayer();
    if (player) {
      const dx = terrainPos.x - player.position.x;
      const dz = terrainPos.z - player.position.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist > INPUT.MAX_CLICK_DISTANCE_TILES) {
        const scale = INPUT.MAX_CLICK_DISTANCE_TILES / dist;
        terrainPos.x = player.position.x + dx * scale;
        terrainPos.z = player.position.z + dz * scale;
      }
    }

    // Snap to tile center
    const tile = worldToTile(terrainPos.x, terrainPos.z);
    const snappedPos = tileToWorld(tile);

    // Show target marker
    this.visualFeedback.showTargetMarker({
      x: snappedPos.x,
      y: terrainPos.y,
      z: snappedPos.z,
    });

    // Send move request
    if (this.world.network?.send) {
      let runMode = shiftKey;
      const playerEntity = this.world.getPlayer() as {
        runMode?: boolean;
      } | null;
      if (playerEntity && typeof playerEntity.runMode === "boolean") {
        runMode = playerEntity.runMode;
      }

      this.world.network.send(MESSAGE_TYPES.MOVE_REQUEST, {
        target: [snappedPos.x, terrainPos.y, snappedPos.z],
        targetTile: { x: tile.x, z: tile.z },
        runMode,
        cancel: false,
      });
    }
  }

  // === Utilities ===

  private areControlsEnabled(): boolean {
    const input = this.world.getSystem("client-input") as {
      isEnabled?: () => boolean;
      _controlsEnabled?: boolean;
    } | null;

    if (input) {
      if (typeof input.isEnabled === "function") {
        return input.isEnabled();
      }
      if (typeof input._controlsEnabled === "boolean") {
        return input._controlsEnabled;
      }
    }

    return true;
  }

  /**
   * Check if an event originated from within a modal overlay.
   * This prevents game interactions when clicking on modal UI elements.
   */
  private isEventFromModal(event: MouseEvent | TouchEvent): boolean {
    const target = event.target as HTMLElement | null;
    if (!target) return false;

    // Check if the target is inside a modal (role="dialog" or data-modal attribute)
    const modal = target.closest('[role="dialog"], [data-modal="true"]');
    if (modal) return true;

    // Check if the target has a high z-index overlay (modal backdrop)
    // Modals typically use z-index >= 10000
    let el: HTMLElement | null = target;
    while (el) {
      const style = window.getComputedStyle(el);
      const zIndex = parseInt(style.zIndex, 10);
      if (!isNaN(zIndex) && zIndex >= 10000) {
        return true;
      }
      el = el.parentElement;
    }

    return false;
  }

  // === Targeting Mode (OSRS "Use X on Y") ===

  /**
   * Enter targeting mode when player uses an item.
   */
  private onTargetingStart = (payload: unknown): void => {
    const data = payload as {
      sourceItem: { id: string; slot: number; name?: string };
      validTargetTypes: string[];
      validTargetIds: string[];
      actionType: "firemaking" | "cooking" | "smelting" | "none";
    };

    this.targetingMode = {
      active: true,
      sourceItem: data.sourceItem,
      validTargetIds: new Set(data.validTargetIds),
      actionType: data.actionType,
    };

    // Change cursor during targeting mode
    if (this.canvas) {
      this.canvas.style.cursor = "crosshair";
    }
  };

  /**
   * Exit targeting mode after successful action.
   */
  private onTargetingComplete = (): void => {
    this.exitTargetingMode();
  };

  /**
   * Exit targeting mode when cancelled.
   */
  private onTargetingCancel = (): void => {
    this.exitTargetingMode();
  };

  /**
   * Reset targeting mode state.
   */
  private exitTargetingMode(): void {
    this.targetingMode = {
      active: false,
      sourceItem: null,
      validTargetIds: new Set(),
      actionType: "none",
    };

    // Restore default cursor
    if (this.canvas) {
      this.canvas.style.cursor = "";
    }
  }

  /**
   * Check if an entity ID is a valid target in current targeting mode.
   */
  private isValidWorldTarget(entityId: string): boolean {
    if (!this.targetingMode.active) return false;

    // Check if entity ID is in valid targets
    if (this.targetingMode.validTargetIds.has(entityId)) {
      return true;
    }

    // For cooking, check if entity is a fire or range by ID pattern
    if (this.targetingMode.actionType === "cooking") {
      if (entityId.startsWith("fire_") || entityId.includes("range")) {
        return true;
      }
    }

    // For smelting, check if entity is a furnace by ID pattern
    if (this.targetingMode.actionType === "smelting") {
      if (entityId.startsWith("furnace_") || entityId.includes("furnace")) {
        return true;
      }
    }

    return false;
  }
}
