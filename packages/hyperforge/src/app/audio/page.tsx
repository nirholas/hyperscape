"use client";

import { StudioPageLayout } from "@/components/layout/StudioPageLayout";
import { AudioStudioPanel } from "@/components/modules/AudioStudioPanel";
import { AudioAssetsViewer } from "@/components/audio/AudioAssetsViewer";

export default function AudioStudioPage() {
  return (
    <StudioPageLayout
      title="Audio Studio"
      description="Generate voice, sound effects, and music with ElevenLabs AI"
      showVault={false}
    >
      <div className="h-full flex">
        {/* Main Audio Panel */}
        <div className="flex-1 p-6 overflow-auto">
          <div className="max-w-4xl mx-auto">
            <div className="mb-8">
              <h1 className="text-3xl font-bold mb-2">Audio Studio</h1>
              <p className="text-muted-foreground">
                Generate professional voice acting, sound effects, and
                background music for your game using ElevenLabs AI.
              </p>
            </div>

            {/* Feature Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="p-6 rounded-xl border border-glass-border bg-glass-bg/30 backdrop-blur-sm">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center mb-4">
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
                    />
                  </svg>
                </div>
                <h3 className="font-semibold text-lg mb-2">Voice Generation</h3>
                <p className="text-sm text-muted-foreground">
                  Convert NPC dialogue to lifelike speech with 8+ character
                  voice presets.
                </p>
              </div>

              <div className="p-6 rounded-xl border border-glass-border bg-glass-bg/30 backdrop-blur-sm">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center mb-4">
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                    />
                  </svg>
                </div>
                <h3 className="font-semibold text-lg mb-2">Sound Effects</h3>
                <p className="text-sm text-muted-foreground">
                  Generate game SFX like sword swings, footsteps, and UI sounds
                  from text.
                </p>
              </div>

              <div className="p-6 rounded-xl border border-glass-border bg-glass-bg/30 backdrop-blur-sm">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center mb-4">
                  <svg
                    className="w-6 h-6 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
                    />
                  </svg>
                </div>
                <h3 className="font-semibold text-lg mb-2">Music Generation</h3>
                <p className="text-sm text-muted-foreground">
                  Create ambient music, combat themes, and zone soundtracks.
                </p>
              </div>
            </div>

            {/* Audio Studio Panel */}
            <div className="rounded-xl border border-glass-border bg-glass-bg/30 backdrop-blur-sm overflow-hidden mb-8">
              <AudioStudioPanel />
            </div>

            {/* Audio Assets Viewer */}
            <AudioAssetsViewer />
          </div>
        </div>
      </div>
    </StudioPageLayout>
  );
}
