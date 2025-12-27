import React, { useEffect, useRef, useState } from "react";
import { THREE } from "@hyperscape/shared";
import type { ClientWorld } from "../types";

interface MinimapCompassProps {
  world: ClientWorld;
  onClick: () => void;
  isCollapsed: boolean;
}

// Pre-allocated temp vector for RAF loop - avoids GC pressure
const _tempForward = new THREE.Vector3();

export function MinimapCompass({
  world,
  onClick,
  isCollapsed,
}: MinimapCompassProps) {
  const [yawDeg, setYawDeg] = useState<number>(0);
  // Ref to track previous yaw to avoid unnecessary state updates
  const prevYawRef = useRef<number>(0);

  useEffect(() => {
    let rafId: number | null = null;
    const loop = () => {
      if (world.camera) {
        // Reuse pre-allocated vector instead of creating new one
        world.camera.getWorldDirection(_tempForward);
        _tempForward.y = 0;
        if (_tempForward.lengthSq() > 1e-6) {
          _tempForward.normalize();
          const yaw = Math.atan2(_tempForward.x, -_tempForward.z);
          const newYawDeg = THREE.MathUtils.radToDeg(yaw);
          // Only update state if yaw changed significantly (> 0.1 degrees)
          if (Math.abs(prevYawRef.current - newYawDeg) > 0.1) {
            prevYawRef.current = newYawDeg;
            setYawDeg(newYawDeg);
          }
        }
      }
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => {
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [world]);

  return (
    <div
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      className="w-10 h-10 rounded-full border-2 border-white/30 bg-black/80 flex items-center justify-center cursor-pointer relative shrink-0 shadow-[0_2px_8px_rgba(0,0,0,0.3)]"
      title={isCollapsed ? "Show minimap" : "Hide minimap"}
    >
      <div
        className="relative w-7 h-7 pointer-events-none"
        style={{ transform: `rotate(${yawDeg}deg)` }}
      >
        <div className="absolute inset-0 rounded-full border border-white/50 pointer-events-none" />
        <div className="absolute left-1/2 top-0.5 -translate-x-1/2 text-[11px] text-red-500 font-semibold shadow-[0_1px_1px_rgba(0,0,0,0.8)] pointer-events-none">
          N
        </div>
      </div>
    </div>
  );
}
