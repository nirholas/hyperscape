import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { logger } from "@/lib/utils";

const log = logger.child("API:game:stores");

export interface StoreItem {
  id: string;
  itemId: string;
  name: string;
  price: number;
  stockQuantity: number; // -1 means unlimited
  restockTime: number;
  description?: string;
  category?: string;
}

export interface Store {
  id: string;
  name: string;
  buyback: boolean;
  buybackRate: number;
  description?: string;
  items: StoreItem[];
  location?: {
    zone: string;
    position: { x: number; y: number; z: number };
  };
}

export interface ItemStoreInfo {
  storeId: string;
  storeName: string;
  price: number;
  stock: number | "unlimited";
  buybackRate?: number;
}

// Path to the manifests directory (shared between packages)
const MANIFESTS_DIR = path.join(
  process.cwd(),
  "..",
  "server",
  "world",
  "assets",
  "manifests",
);

/**
 * GET /api/game/stores
 * Returns all stores or filter by itemId query param
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const itemId = searchParams.get("itemId");

    // Read stores manifest
    const storesPath = path.join(MANIFESTS_DIR, "stores.json");
    let stores: Store[] = [];

    try {
      const content = await fs.readFile(storesPath, "utf-8");
      stores = JSON.parse(content);
    } catch (error) {
      log.error("Failed to read stores manifest:", error);
      // Return empty stores if file doesn't exist
      return NextResponse.json({ stores: [], itemStores: [] });
    }

    // If itemId is provided, find which stores sell this item
    if (itemId) {
      const itemStores: ItemStoreInfo[] = [];

      for (const store of stores) {
        const storeItem = store.items.find(
          (item) => item.itemId === itemId || item.id === itemId,
        );
        if (storeItem) {
          itemStores.push({
            storeId: store.id,
            storeName: store.name,
            price: storeItem.price,
            stock:
              storeItem.stockQuantity === -1
                ? "unlimited"
                : storeItem.stockQuantity,
            buybackRate: store.buyback ? store.buybackRate : undefined,
          });
        }
      }

      return NextResponse.json({
        itemId,
        stores: itemStores,
        totalStores: itemStores.length,
      });
    }

    // Return all stores with item counts
    const storesWithCounts = stores.map((store) => ({
      id: store.id,
      name: store.name,
      description: store.description,
      itemCount: store.items.length,
      buyback: store.buyback,
      buybackRate: store.buybackRate,
      location: store.location,
    }));

    return NextResponse.json({
      stores: storesWithCounts,
      totalStores: stores.length,
    });
  } catch (error) {
    log.error("Failed to get stores:", error);
    return NextResponse.json(
      { error: "Failed to get stores" },
      { status: 500 },
    );
  }
}
