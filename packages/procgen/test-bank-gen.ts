import { BuildingGenerator } from "./src/building/generator/BuildingGenerator";

const generator = new BuildingGenerator();

// Test multiple seeds to see layout variations
const seeds = ["bank-1", "test_bank", "bank_12345", "origin_bank"];

for (const seed of seeds) {
  const generated = generator.generate("bank", { seed });

  if (!generated) {
    console.log(`Seed "${seed}": Failed to generate bank!`);
    continue;
  }

  console.log(`\n=== BANK (seed: ${seed}) ===`);
  console.log(
    `Width: ${generated.layout.width} cells, Depth: ${generated.layout.depth} cells, Floors: ${generated.layout.floors}`,
  );

  console.log("Footprint (T=walkable, .=hole):");
  const fp = generated.layout.floorPlans[0].footprint;
  for (let row = 0; row < fp.length; row++) {
    let line = "  Row " + row + ": ";
    for (let col = 0; col < fp[row].length; col++) {
      line += fp[row][col] ? "T " : ". ";
    }
    console.log(line);
  }

  // Calculate what tile (10, 10) would be in
  const width = generated.layout.width;
  const depth = generated.layout.depth;
  const cellSize = 4;

  // For tile (10, 10) when building center is at (10, 10):
  // localX = worldX - centerX = 0
  // localZ = worldZ - centerZ = 0
  // cell.col = localX / cellSize + width/2 - 0.5
  // cell.row = localZ / cellSize + depth/2 - 0.5

  // Inverse calculation: what cell is tile (10, 10) in?
  const tileX = 10,
    tileZ = 10;
  const centerX = 10,
    centerZ = 10;

  // The tile (10, 10) is at local position (0, 0) from building center
  // Each cell is cellSize meters, and we need to find which cell contains this

  // From cellToWorldTile:
  // worldX = centerX + (col - width/2 + 0.5) * cellSize
  // Solve for col:
  // worldX - centerX = (col - width/2 + 0.5) * cellSize
  // (worldX - centerX) / cellSize = col - width/2 + 0.5
  // col = (worldX - centerX) / cellSize + width/2 - 0.5

  const col = Math.floor((tileX - centerX) / cellSize + width / 2);
  const row = Math.floor((tileZ - centerZ) / cellSize + depth / 2);

  console.log(
    `  Tile (10, 10) when centered at (10, 10) -> cell (col=${col}, row=${row})`,
  );

  if (row >= 0 && row < fp.length && col >= 0 && col < fp[row].length) {
    const isWalkable = fp[row][col];
    console.log(`  Cell walkable: ${isWalkable}`);
  } else {
    console.log(`  Cell OUT OF BOUNDS!`);
  }
}
