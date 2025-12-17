"use client";

import { useState, useEffect } from "react";
import {
  Key,
  CreditCard,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  ExternalLink,
  Sparkles,
  Mic,
  Database,
  Box,
  Zap,
  TrendingUp,
  Volume2,
  Clock,
  Users,
} from "lucide-react";
import { StudioPageLayout } from "@/components/layout/StudioPageLayout";
import { GlassPanel } from "@/components/ui/glass-panel";
import { SpectacularButton } from "@/components/ui/spectacular-button";
import { cn } from "@/lib/utils";

interface ApiStatus {
  meshy: {
    configured: boolean;
    keyPrefix: string | null;
  };
  openai: {
    configured: boolean;
    keyPrefix: string | null;
  };
  elevenlabs: {
    configured: boolean;
    keyPrefix: string | null;
  };
  supabase: {
    configured: boolean;
    url: string | null;
  };
  aiGateway: {
    configured: boolean;
    keyPrefix: string | null;
  };
}

interface MeshyBalance {
  configured: boolean;
  balance?: number;
  error?: string;
}

interface AIGatewayCredits {
  configured: boolean;
  balance?: number;
  totalUsed?: number;
  error?: string;
}

interface ElevenLabsSubscription {
  configured: boolean;
  tier?: string;
  status?: string;
  characterCount?: number;
  characterLimit?: number;
  usagePercent?: number;
  voiceLimit?: number;
  voicesUsed?: number;
  resetDate?: string;
  features?: {
    instantVoiceCloning: boolean;
    professionalVoiceCloning: boolean;
  };
  error?: string;
}

export default function SettingsPage() {
  const [apiStatus, setApiStatus] = useState<ApiStatus | null>(null);
  const [meshyBalance, setMeshyBalance] = useState<MeshyBalance | null>(null);
  const [aiGatewayCredits, setAiGatewayCredits] =
    useState<AIGatewayCredits | null>(null);
  const [elevenLabsSub, setElevenLabsSub] =
    useState<ElevenLabsSubscription | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState(true);
  const [isLoadingBalance, setIsLoadingBalance] = useState(true);
  const [isLoadingAiGateway, setIsLoadingAiGateway] = useState(true);
  const [isLoadingElevenLabs, setIsLoadingElevenLabs] = useState(true);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);

  // Fetch API status
  const fetchApiStatus = async () => {
    setIsLoadingStatus(true);
    try {
      const response = await fetch("/api/settings/status");
      if (response.ok) {
        const data = await response.json();
        setApiStatus(data);
      }
    } catch (error) {
      console.error("Failed to fetch API status:", error);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  // Fetch Meshy balance
  const fetchMeshyBalance = async () => {
    setIsLoadingBalance(true);
    try {
      const response = await fetch("/api/settings/balance");
      if (response.ok) {
        const data = await response.json();
        setMeshyBalance(data);
      }
    } catch (error) {
      console.error("Failed to fetch Meshy balance:", error);
      setMeshyBalance({ configured: false, error: "Failed to fetch balance" });
    } finally {
      setIsLoadingBalance(false);
    }
  };

  // Fetch AI Gateway credits
  const fetchAiGatewayCredits = async () => {
    setIsLoadingAiGateway(true);
    try {
      const response = await fetch("/api/settings/ai-gateway");
      if (response.ok) {
        const data = await response.json();
        setAiGatewayCredits(data);
      }
    } catch (error) {
      console.error("Failed to fetch AI Gateway credits:", error);
      setAiGatewayCredits({
        configured: false,
        error: "Failed to fetch credits",
      });
    } finally {
      setIsLoadingAiGateway(false);
    }
  };

  // Fetch ElevenLabs subscription
  const fetchElevenLabsSub = async () => {
    setIsLoadingElevenLabs(true);
    try {
      const response = await fetch("/api/settings/elevenlabs");
      if (response.ok) {
        const data = await response.json();
        setElevenLabsSub(data);
      }
    } catch (error) {
      console.error("Failed to fetch ElevenLabs subscription:", error);
      setElevenLabsSub({
        configured: false,
        error: "Failed to fetch subscription",
      });
    } finally {
      setIsLoadingElevenLabs(false);
      setLastRefreshed(new Date());
    }
  };

  // Refresh all data
  const handleRefresh = () => {
    fetchApiStatus();
    fetchMeshyBalance();
    fetchAiGatewayCredits();
    fetchElevenLabsSub();
  };

  // Load on mount
  useEffect(() => {
    fetchApiStatus();
    fetchMeshyBalance();
    fetchAiGatewayCredits();
    fetchElevenLabsSub();
  }, []);

  const isLoading =
    isLoadingStatus ||
    isLoadingBalance ||
    isLoadingAiGateway ||
    isLoadingElevenLabs;

  return (
    <StudioPageLayout
      title="Settings"
      description="API keys, usage, and billing"
      showVault={false}
    >
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b border-glass-border bg-glass-bg/30">
          <div className="max-w-4xl mx-auto flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold mb-2">Settings</h1>
              <p className="text-muted-foreground">
                Manage your API keys, view usage, and monitor billing.
              </p>
            </div>
            <SpectacularButton
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isLoading}
            >
              <RefreshCw
                className={cn("w-4 h-4 mr-2", isLoading && "animate-spin")}
              />
              Refresh
            </SpectacularButton>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {/* Meshy Credits Card - Prominent display */}
            <GlassPanel className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
                    <CreditCard className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">Meshy API Credits</h2>
                    <p className="text-sm text-muted-foreground">
                      Credits used for 3D model generation
                    </p>
                  </div>
                </div>

                <a
                  href="https://www.meshy.ai/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-cyan-400 hover:text-cyan-300 transition-colors"
                >
                  Manage Credits
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {isLoadingBalance ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
                </div>
              ) : meshyBalance?.configured ? (
                meshyBalance.error ? (
                  <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                    <div className="flex items-center gap-2 text-red-400">
                      <AlertCircle className="w-5 h-5" />
                      <span className="text-sm">{meshyBalance.error}</span>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Balance Display */}
                    <div className="p-6 rounded-xl bg-gradient-to-br from-cyan-500/10 to-blue-600/10 border border-cyan-500/20">
                      <div className="text-sm text-muted-foreground mb-1">
                        Available Balance
                      </div>
                      <div className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">
                        {meshyBalance.balance?.toLocaleString() ?? "—"}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        credits
                      </div>
                    </div>

                    {/* Credit Info */}
                    <div className="p-6 rounded-xl bg-glass-bg/50 border border-glass-border">
                      <div className="text-sm font-medium mb-3">
                        Credit Usage
                      </div>
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        <li className="flex items-center gap-2">
                          <Box className="w-4 h-4 text-cyan-400" />
                          Text-to-3D: ~50-200 credits
                        </li>
                        <li className="flex items-center gap-2">
                          <Box className="w-4 h-4 text-purple-400" />
                          Image-to-3D: ~50-150 credits
                        </li>
                        <li className="flex items-center gap-2">
                          <Box className="w-4 h-4 text-green-400" />
                          Retexture: ~20-50 credits
                        </li>
                      </ul>
                    </div>
                  </div>
                )
              ) : (
                <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <div className="flex items-center gap-2 text-yellow-400">
                    <AlertCircle className="w-5 h-5" />
                    <span className="text-sm">
                      MESHY_API_KEY is not configured. Add it to your .env file.
                    </span>
                  </div>
                  <a
                    href="https://www.meshy.ai/api"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-sm text-yellow-400 hover:text-yellow-300 transition-colors"
                  >
                    Get an API key
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </GlassPanel>

            {/* Vercel AI Gateway Credits Card */}
            <GlassPanel className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center shadow-lg shadow-purple-500/20">
                    <Zap className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">Vercel AI Gateway</h2>
                    <p className="text-sm text-muted-foreground">
                      Credits for AI completions & image generation
                    </p>
                  </div>
                </div>

                <a
                  href="https://vercel.com/docs/ai-gateway"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-purple-400 hover:text-purple-300 transition-colors"
                >
                  View Docs
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {isLoadingAiGateway ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-400" />
                </div>
              ) : aiGatewayCredits?.configured ? (
                aiGatewayCredits.error ? (
                  <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                    <div className="flex items-center gap-2 text-red-400">
                      <AlertCircle className="w-5 h-5" />
                      <span className="text-sm">{aiGatewayCredits.error}</span>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Balance Display */}
                    <div className="p-6 rounded-xl bg-gradient-to-br from-purple-500/10 to-pink-600/10 border border-purple-500/20">
                      <div className="text-sm text-muted-foreground mb-1">
                        Available Balance
                      </div>
                      <div className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-pink-500">
                        ${aiGatewayCredits.balance?.toFixed(2) ?? "—"}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        USD
                      </div>
                    </div>

                    {/* Total Used */}
                    <div className="p-6 rounded-xl bg-glass-bg/50 border border-glass-border">
                      <div className="text-sm text-muted-foreground mb-1 flex items-center gap-1">
                        <TrendingUp className="w-4 h-4" />
                        Total Used
                      </div>
                      <div className="text-3xl font-bold text-foreground">
                        ${aiGatewayCredits.totalUsed?.toFixed(2) ?? "0.00"}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        USD spent
                      </div>
                    </div>

                    {/* Usage Info */}
                    <div className="p-6 rounded-xl bg-glass-bg/50 border border-glass-border">
                      <div className="text-sm font-medium mb-3">
                        Powered Services
                      </div>
                      <ul className="space-y-2 text-sm text-muted-foreground">
                        <li className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-green-400" />
                          GPT-4 / Claude
                        </li>
                        <li className="flex items-center gap-2">
                          <Box className="w-4 h-4 text-cyan-400" />
                          DALL-E / Midjourney
                        </li>
                        <li className="flex items-center gap-2">
                          <Mic className="w-4 h-4 text-purple-400" />
                          Text-to-Speech
                        </li>
                      </ul>
                    </div>
                  </div>
                )
              ) : (
                <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <div className="flex items-center gap-2 text-yellow-400">
                    <AlertCircle className="w-5 h-5" />
                    <span className="text-sm">
                      AI_GATEWAY_API_KEY is not configured. Add it to your .env
                      file.
                    </span>
                  </div>
                  <a
                    href="https://vercel.com/docs/ai-gateway"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-sm text-yellow-400 hover:text-yellow-300 transition-colors"
                  >
                    Learn more about AI Gateway
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </GlassPanel>

            {/* ElevenLabs Subscription Card */}
            <GlassPanel className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                    <Volume2 className="w-6 h-6 text-white" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">ElevenLabs</h2>
                    <p className="text-sm text-muted-foreground">
                      Voice generation & text-to-speech
                    </p>
                  </div>
                </div>

                <a
                  href="https://elevenlabs.io/app/subscription"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
                >
                  Manage Subscription
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>

              {isLoadingElevenLabs ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
                </div>
              ) : elevenLabsSub?.configured ? (
                elevenLabsSub.error ? (
                  <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20">
                    <div className="flex items-center gap-2 text-red-400">
                      <AlertCircle className="w-5 h-5" />
                      <span className="text-sm">{elevenLabsSub.error}</span>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Tier and Status */}
                    <div className="flex items-center gap-3 mb-4">
                      <span className="px-3 py-1 rounded-full bg-indigo-500/20 text-indigo-400 text-sm font-medium capitalize">
                        {elevenLabsSub.tier ?? "Unknown"} Plan
                      </span>
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded text-xs font-medium",
                          elevenLabsSub.status === "active"
                            ? "bg-green-500/20 text-green-400"
                            : "bg-yellow-500/20 text-yellow-400",
                        )}
                      >
                        {elevenLabsSub.status ?? "Unknown"}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {/* Character Usage */}
                      <div className="p-6 rounded-xl bg-gradient-to-br from-indigo-500/10 to-violet-600/10 border border-indigo-500/20 md:col-span-2">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm text-muted-foreground">
                            Character Usage
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {elevenLabsSub.usagePercent ?? 0}%
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full h-3 bg-glass-bg rounded-full overflow-hidden mb-3">
                          <div
                            className={cn(
                              "h-full rounded-full transition-all duration-500",
                              (elevenLabsSub.usagePercent ?? 0) > 90
                                ? "bg-gradient-to-r from-red-500 to-red-400"
                                : (elevenLabsSub.usagePercent ?? 0) > 70
                                  ? "bg-gradient-to-r from-yellow-500 to-orange-400"
                                  : "bg-gradient-to-r from-indigo-500 to-violet-500",
                            )}
                            style={{
                              width: `${Math.min(elevenLabsSub.usagePercent ?? 0, 100)}%`,
                            }}
                          />
                        </div>

                        <div className="flex items-center justify-between">
                          <div className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-violet-500">
                            {elevenLabsSub.characterCount?.toLocaleString() ??
                              0}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            of{" "}
                            {elevenLabsSub.characterLimit?.toLocaleString() ??
                              0}{" "}
                            characters
                          </div>
                        </div>

                        {elevenLabsSub.resetDate && (
                          <div className="flex items-center gap-1 mt-3 text-xs text-muted-foreground">
                            <Clock className="w-3 h-3" />
                            Resets on {elevenLabsSub.resetDate}
                          </div>
                        )}
                      </div>

                      {/* Voice Slots & Features */}
                      <div className="p-6 rounded-xl bg-glass-bg/50 border border-glass-border">
                        <div className="text-sm font-medium mb-3 flex items-center gap-2">
                          <Users className="w-4 h-4 text-indigo-400" />
                          Voice Slots
                        </div>
                        <div className="text-2xl font-bold mb-1">
                          {elevenLabsSub.voicesUsed ?? 0} /{" "}
                          {elevenLabsSub.voiceLimit ?? 0}
                        </div>
                        <div className="text-xs text-muted-foreground mb-4">
                          voices used
                        </div>

                        <div className="space-y-2 text-xs">
                          <div className="flex items-center gap-2">
                            {elevenLabsSub.features?.instantVoiceCloning ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
                            )}
                            <span
                              className={
                                elevenLabsSub.features?.instantVoiceCloning
                                  ? ""
                                  : "text-muted-foreground"
                              }
                            >
                              Instant Voice Cloning
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {elevenLabsSub.features
                              ?.professionalVoiceCloning ? (
                              <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                            ) : (
                              <XCircle className="w-3.5 h-3.5 text-muted-foreground" />
                            )}
                            <span
                              className={
                                elevenLabsSub.features?.professionalVoiceCloning
                                  ? ""
                                  : "text-muted-foreground"
                              }
                            >
                              Professional Cloning
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              ) : (
                <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <div className="flex items-center gap-2 text-yellow-400">
                    <AlertCircle className="w-5 h-5" />
                    <span className="text-sm">
                      ELEVENLABS_API_KEY is not configured. Add it to your .env
                      file.
                    </span>
                  </div>
                  <a
                    href="https://elevenlabs.io/api"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-sm text-yellow-400 hover:text-yellow-300 transition-colors"
                  >
                    Get an API key
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </GlassPanel>

            {/* Last Refreshed */}
            {lastRefreshed && (
              <div className="text-xs text-muted-foreground text-right">
                Last updated: {lastRefreshed.toLocaleTimeString()}
              </div>
            )}

            {/* API Configuration Status */}
            <GlassPanel className="p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-lg bg-glass-bg flex items-center justify-center">
                  <Key className="w-5 h-5 text-muted-foreground" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold">API Configuration</h2>
                  <p className="text-sm text-muted-foreground">
                    Status of configured API keys
                  </p>
                </div>
              </div>

              {isLoadingStatus ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Meshy API */}
                  <div
                    className={cn(
                      "p-4 rounded-lg border transition-all",
                      apiStatus?.meshy.configured
                        ? "bg-green-500/5 border-green-500/20"
                        : "bg-red-500/5 border-red-500/20",
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Box className="w-5 h-5 text-cyan-400" />
                        <span className="font-medium">Meshy</span>
                      </div>
                      {apiStatus?.meshy.configured ? (
                        <CheckCircle2 className="w-5 h-5 text-green-400" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-400" />
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {apiStatus?.meshy.configured
                        ? `Key: ${apiStatus.meshy.keyPrefix}`
                        : "Not configured"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      3D model generation
                    </div>
                  </div>

                  {/* OpenAI API */}
                  <div
                    className={cn(
                      "p-4 rounded-lg border transition-all",
                      apiStatus?.openai.configured
                        ? "bg-green-500/5 border-green-500/20"
                        : "bg-red-500/5 border-red-500/20",
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-5 h-5 text-green-400" />
                        <span className="font-medium">OpenAI</span>
                      </div>
                      {apiStatus?.openai.configured ? (
                        <CheckCircle2 className="w-5 h-5 text-green-400" />
                      ) : (
                        <XCircle className="w-5 h-5 text-red-400" />
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {apiStatus?.openai.configured
                        ? `Key: ${apiStatus.openai.keyPrefix}`
                        : "Not configured"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Prompt enhancement & concept art
                    </div>
                  </div>

                  {/* ElevenLabs API */}
                  <div
                    className={cn(
                      "p-4 rounded-lg border transition-all",
                      apiStatus?.elevenlabs.configured
                        ? "bg-green-500/5 border-green-500/20"
                        : "bg-yellow-500/5 border-yellow-500/20",
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Mic className="w-5 h-5 text-purple-400" />
                        <span className="font-medium">ElevenLabs</span>
                      </div>
                      {apiStatus?.elevenlabs.configured ? (
                        <CheckCircle2 className="w-5 h-5 text-green-400" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-yellow-400" />
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {apiStatus?.elevenlabs.configured
                        ? `Key: ${apiStatus.elevenlabs.keyPrefix}`
                        : "Optional"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Voice generation
                    </div>
                  </div>

                  {/* Supabase */}
                  <div
                    className={cn(
                      "p-4 rounded-lg border transition-all",
                      apiStatus?.supabase.configured
                        ? "bg-green-500/5 border-green-500/20"
                        : "bg-yellow-500/5 border-yellow-500/20",
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Database className="w-5 h-5 text-orange-400" />
                        <span className="font-medium">Supabase</span>
                      </div>
                      {apiStatus?.supabase.configured ? (
                        <CheckCircle2 className="w-5 h-5 text-green-400" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-yellow-400" />
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {apiStatus?.supabase.configured
                        ? `URL: ${apiStatus.supabase.url}`
                        : "Optional (uses local storage)"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Cloud storage for assets
                    </div>
                  </div>

                  {/* Vercel AI Gateway */}
                  <div
                    className={cn(
                      "p-4 rounded-lg border transition-all",
                      apiStatus?.aiGateway?.configured
                        ? "bg-green-500/5 border-green-500/20"
                        : "bg-yellow-500/5 border-yellow-500/20",
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Zap className="w-5 h-5 text-pink-400" />
                        <span className="font-medium">AI Gateway</span>
                      </div>
                      {apiStatus?.aiGateway?.configured ? (
                        <CheckCircle2 className="w-5 h-5 text-green-400" />
                      ) : (
                        <AlertCircle className="w-5 h-5 text-yellow-400" />
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {apiStatus?.aiGateway?.configured
                        ? `Key: ${apiStatus.aiGateway.keyPrefix}`
                        : "Optional (Vercel AI Gateway)"}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      AI completions & billing
                    </div>
                  </div>
                </div>
              )}
            </GlassPanel>

            {/* Environment Variables Guide */}
            <GlassPanel className="p-6">
              <h2 className="text-lg font-semibold mb-4">
                Environment Variables
              </h2>
              <p className="text-sm text-muted-foreground mb-4">
                Add these to your{" "}
                <code className="bg-glass-bg px-1.5 py-0.5 rounded text-cyan-400">
                  .env
                </code>{" "}
                file:
              </p>
              <div className="bg-glass-bg/50 rounded-lg p-4 font-mono text-sm overflow-x-auto">
                <div className="space-y-1">
                  <div>
                    <span className="text-muted-foreground">
                      # Required for 3D generation
                    </span>
                  </div>
                  <div>
                    <span className="text-cyan-400">MESHY_API_KEY</span>
                    <span className="text-muted-foreground">=</span>
                    <span className="text-green-400">
                      msy_your_api_key_here
                    </span>
                  </div>
                  <div className="mt-2">
                    <span className="text-muted-foreground">
                      # Required for prompt enhancement
                    </span>
                  </div>
                  <div>
                    <span className="text-cyan-400">OPENAI_API_KEY</span>
                    <span className="text-muted-foreground">=</span>
                    <span className="text-green-400">sk-your_api_key_here</span>
                  </div>
                  <div className="mt-2">
                    <span className="text-muted-foreground">
                      # Optional: Vercel AI Gateway (usage tracking)
                    </span>
                  </div>
                  <div>
                    <span className="text-cyan-400">AI_GATEWAY_API_KEY</span>
                    <span className="text-muted-foreground">=</span>
                    <span className="text-green-400">
                      your_gateway_key_here
                    </span>
                  </div>
                  <div className="mt-2">
                    <span className="text-muted-foreground">
                      # Optional: Voice generation
                    </span>
                  </div>
                  <div>
                    <span className="text-cyan-400">ELEVENLABS_API_KEY</span>
                    <span className="text-muted-foreground">=</span>
                    <span className="text-green-400">your_api_key_here</span>
                  </div>
                  <div className="mt-2">
                    <span className="text-muted-foreground">
                      # Optional: Cloud storage
                    </span>
                  </div>
                  <div>
                    <span className="text-cyan-400">SUPABASE_URL</span>
                    <span className="text-muted-foreground">=</span>
                    <span className="text-green-400">
                      https://xxx.supabase.co
                    </span>
                  </div>
                  <div>
                    <span className="text-cyan-400">SUPABASE_ANON_KEY</span>
                    <span className="text-muted-foreground">=</span>
                    <span className="text-green-400">your_anon_key_here</span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <a
                  href="https://www.meshy.ai/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/10 text-cyan-400 text-sm hover:bg-cyan-500/20 transition-colors"
                >
                  <Box className="w-4 h-4" />
                  Get Meshy API Key
                  <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 text-green-400 text-sm hover:bg-green-500/20 transition-colors"
                >
                  <Sparkles className="w-4 h-4" />
                  Get OpenAI API Key
                  <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href="https://elevenlabs.io/api"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-400 text-sm hover:bg-indigo-500/20 transition-colors"
                >
                  <Volume2 className="w-4 h-4" />
                  Get ElevenLabs Key
                  <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href="https://vercel.com/docs/ai-gateway"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-pink-500/10 text-pink-400 text-sm hover:bg-pink-500/20 transition-colors"
                >
                  <Zap className="w-4 h-4" />
                  AI Gateway Docs
                  <ExternalLink className="w-3 h-3" />
                </a>
                <a
                  href="https://elevenlabs.io/docs/api-reference/usage/get"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-500/10 text-violet-400 text-sm hover:bg-violet-500/20 transition-colors"
                >
                  <Mic className="w-4 h-4" />
                  ElevenLabs Usage API
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </GlassPanel>
          </div>
        </div>
      </div>
    </StudioPageLayout>
  );
}
