import { useCallback, useMemo } from "react";
import { useEditStore } from "../../stores/editStore";
import type { GridResult, Point, Size } from "../../types";

/** Major grid is every 4th line */
const MAJOR_GRID_MULTIPLIER = 4;

/**
 * Hook for grid snapping calculations
 *
 * @example
 * ```tsx
 * function GridOverlay({ viewport }: { viewport: Size }) {
 *   const { getGridLines, gridSize, majorGridSize } = useGrid();
 *
 *   const { x, y, majorX, majorY } = getGridLines(viewport);
 *
 *   return (
 *     <svg style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
 *       {y.map((py) => (
 *         <line key={py} x1={0} y1={py} x2={viewport.width} y2={py} stroke="#333" />
 *       ))}
 *       {x.map((px) => (
 *         <line key={px} x1={px} y1={0} x2={px} y2={viewport.height} stroke="#333" />
 *       ))}
 *       {majorY.map((py) => (
 *         <line key={py} x1={0} y1={py} x2={viewport.width} y2={py} stroke="#555" />
 *       ))}
 *       {majorX.map((px) => (
 *         <line key={px} x1={px} y1={0} x2={px} y2={viewport.height} stroke="#555" />
 *       ))}
 *     </svg>
 *   );
 * }
 * ```
 */
export function useGrid(): GridResult {
  const gridSize = useEditStore((s) => s.gridSize);

  const majorGridSize = useMemo(
    () => gridSize * MAJOR_GRID_MULTIPLIER,
    [gridSize],
  );

  const snapToGrid = useCallback(
    (value: number): number => {
      if (gridSize <= 0) return value;
      return Math.round(value / gridSize) * gridSize;
    },
    [gridSize],
  );

  const snapPointToGrid = useCallback(
    (point: Point): Point => {
      return {
        x: snapToGrid(point.x),
        y: snapToGrid(point.y),
      };
    },
    [snapToGrid],
  );

  const getGridLines = useCallback(
    (
      viewport: Size,
    ): { x: number[]; y: number[]; majorX: number[]; majorY: number[] } => {
      if (gridSize <= 0) {
        return { x: [], y: [], majorX: [], majorY: [] };
      }

      const x: number[] = [];
      const y: number[] = [];
      const majorX: number[] = [];
      const majorY: number[] = [];

      // Vertical lines (x positions)
      for (let px = 0; px <= viewport.width; px += gridSize) {
        if (px % majorGridSize === 0) {
          majorX.push(px);
        } else {
          x.push(px);
        }
      }

      // Horizontal lines (y positions)
      for (let py = 0; py <= viewport.height; py += gridSize) {
        if (py % majorGridSize === 0) {
          majorY.push(py);
        } else {
          y.push(py);
        }
      }

      return { x, y, majorX, majorY };
    },
    [gridSize, majorGridSize],
  );

  return {
    snapToGrid,
    snapPointToGrid,
    getGridLines,
    majorGridSize,
  };
}
