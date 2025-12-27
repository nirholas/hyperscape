import { SystemBase } from "../infrastructure/SystemBase";
import type { World } from "../../../core/World";
import { EventType } from "../../../types/events";

/** Handles mob death: despawn, loot drops, animations, respawn timers */
export class MobDeathSystem extends SystemBase {
  private mobRespawnTimers = new Map<string, NodeJS.Timeout>();

  constructor(world: World) {
    super(world, {
      name: "mob-death",
      dependencies: { required: [], optional: [] },
      autoCleanup: true,
    });
  }

  async init(): Promise<void> {
    this.subscribe(
      EventType.ENTITY_DEATH,
      (data: {
        entityId: string;
        killedBy: string;
        entityType: "player" | "mob";
      }) => this.handleMobDeath(data),
    );
  }

  private handleMobDeath(data: {
    entityId: string;
    killedBy: string;
    entityType: "player" | "mob";
  }): void {
    if (data.entityType !== "mob") {
      return;
    }

    const mobId = data.entityId;

    // Handle mob death (despawn, drops, etc.)
    this.despawnMob(mobId);
  }

  private despawnMob(mobId: string): void {
    // Remove mob entity from world
    const mobEntity = this.world.entities?.get?.(mobId);
    if (mobEntity) {
      // Emit despawn event for other systems
      this.emitTypedEvent(EventType.MOB_NPC_DESPAWN, { mobId });

      // Remove from entity manager
      if (this.world.entities && "remove" in this.world.entities) {
        (this.world.entities as { remove: (id: string) => void }).remove(mobId);
      }
    }
  }

  override destroy(): void {
    // Clear all respawn timers
    for (const timer of this.mobRespawnTimers.values()) {
      clearTimeout(timer);
    }
    this.mobRespawnTimers.clear();
  }
}
