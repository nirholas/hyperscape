/**
 * Collision Detection Strategies
 */

import type { Point, Rect } from "../../types";

export interface CollisionResult {
  id: string;
  score: number;
}

export type CollisionDetectionStrategy = (
  dragRect: Rect,
  targets: Map<string, Rect>,
) => CollisionResult[];

export function closestCenter(
  dragRect: Rect,
  targets: Map<string, Rect>,
): CollisionResult[] {
  const center: Point = {
    x: dragRect.x + dragRect.width / 2,
    y: dragRect.y + dragRect.height / 2,
  };
  const results: CollisionResult[] = [];
  targets.forEach((rect, id) => {
    const tc = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    const dist = Math.sqrt(
      Math.pow(center.x - tc.x, 2) + Math.pow(center.y - tc.y, 2),
    );
    results.push({ id, score: dist });
  });
  return results.sort((a, b) => a.score - b.score);
}

export function closestCorners(
  dragRect: Rect,
  targets: Map<string, Rect>,
): CollisionResult[] {
  const corners = [
    { x: dragRect.x, y: dragRect.y },
    { x: dragRect.x + dragRect.width, y: dragRect.y },
    { x: dragRect.x, y: dragRect.y + dragRect.height },
    { x: dragRect.x + dragRect.width, y: dragRect.y + dragRect.height },
  ];
  const results: CollisionResult[] = [];
  targets.forEach((rect, id) => {
    const tc = [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x, y: rect.y + rect.height },
      { x: rect.x + rect.width, y: rect.y + rect.height },
    ];
    let min = Infinity;
    for (const dc of corners)
      for (const t of tc) {
        const d = Math.sqrt(Math.pow(dc.x - t.x, 2) + Math.pow(dc.y - t.y, 2));
        if (d < min) min = d;
      }
    results.push({ id, score: min });
  });
  return results.sort((a, b) => a.score - b.score);
}

export function rectIntersection(
  dragRect: Rect,
  targets: Map<string, Rect>,
): CollisionResult[] {
  const results: CollisionResult[] = [];
  targets.forEach((rect, id) => {
    const area = getIntersectionArea(dragRect, rect);
    if (area > 0) results.push({ id, score: -area });
  });
  return results.sort((a, b) => a.score - b.score);
}

export function pointerWithin(
  pointer: Point,
  targets: Map<string, Rect>,
): CollisionResult[] {
  const results: CollisionResult[] = [];
  targets.forEach((rect, id) => {
    if (isPointInRect(pointer, rect))
      results.push({ id, score: rect.width * rect.height });
  });
  return results.sort((a, b) => a.score - b.score);
}

export function isPointInRect(p: Point, r: Rect): boolean {
  return (
    p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height
  );
}

export function getIntersectionArea(a: Rect, b: Rect): number {
  const left = Math.max(a.x, b.x);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const top = Math.max(a.y, b.y);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > left && bottom > top ? (right - left) * (bottom - top) : 0;
}
