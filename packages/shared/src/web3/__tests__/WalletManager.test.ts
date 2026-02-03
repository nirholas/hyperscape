/**
 * @fileoverview Unit tests for unified WalletManager
 * @module @hyperscape/shared/web3/__tests__/WalletManager.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WalletManager, createWalletManager } from "../WalletManager";
import {
  type ChainType,
  type NetworkId,
  type WalletManagerConfig,
  type UnifiedWallet,
  type WalletEventType,
  WalletError,
  WalletErrorCode,
  NETWORK_METADATA,
  NETWORK_CHAIN_TYPE,
  isEvmNetwork,
  isSolanaNetwork,
  isTestnet,
  truncateAddress,
  formatUsd,
  formatTokenAmount,
  generateWalletId,
  getExplorerTxUrl,
  getExplorerAddressUrl,
} from "../types";

// Mock fetch for RPC calls
const mockFetch = vi.fn();

describe("WalletManager", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("constructor", () => {
    it("should create manager with default config", () => {
      const manager = new WalletManager();
      expect(manager).toBeDefined();
    });

    it("should create manager with custom config", () => {
      const config: WalletManagerConfig = {
        preferredNetworks: ["arbitrum", "solana-mainnet"],
        balanceRefreshInterval: 60000,
      };
      const manager = new WalletManager(config);
      expect(manager).toBeDefined();
    });

    it("should create manager via factory function", () => {
      const manager = createWalletManager();
      expect(manager).toBeDefined();
    });

    it("should create manager via factory with config", () => {
      const manager = createWalletManager({
        preferredNetworks: ["base"],
      });
      expect(manager).toBeDefined();
    });
  });

  describe("wallet operations", () => {
    it("should add EVM wallet", async () => {
      const manager = new WalletManager();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: "0x0",
        }),
      });

      const wallet = await manager.addWallet(
        "evm",
        "arbitrum",
        "0x" + "1".repeat(64),
      );

      expect(wallet).toBeDefined();
      expect(wallet.id).toBeDefined();
      expect(wallet.type).toBe("evm");
      expect(wallet.network).toBe("arbitrum");
      expect(wallet.address).toBeDefined();
    });

    it("should add Solana wallet", async () => {
      const manager = new WalletManager();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { context: { slot: 1 }, value: 0 },
        }),
      });

      const wallet = await manager.addWallet("solana", "solana-devnet");

      expect(wallet).toBeDefined();
      expect(wallet.type).toBe("solana");
      expect(wallet.network).toBe("solana-devnet");
      expect(wallet.address).toBeDefined();
      expect(wallet.address.length).toBeGreaterThanOrEqual(32);
    });

    it("should remove wallet", async () => {
      const manager = new WalletManager();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: "0x0",
        }),
      });

      const wallet = await manager.addWallet(
        "evm",
        "arbitrum",
        "0x" + "1".repeat(64),
      );

      expect(manager.getWallet(wallet.id)).toBeDefined();

      const removed = manager.removeWallet(wallet.id);
      expect(removed).toBe(true);
      expect(manager.getWallet(wallet.id)).toBeUndefined();
    });

    it("should list all wallets", async () => {
      const manager = new WalletManager();

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: "0x0",
        }),
      });

      await manager.addWallet("evm", "arbitrum", "0x" + "1".repeat(64));
      await manager.addWallet("evm", "base", "0x" + "2".repeat(64));

      const wallets = manager.getWallets();
      expect(wallets.length).toBe(2);
    });
  });
});

describe("WalletManager utility functions", () => {
  describe("network type helpers", () => {
    it("should identify EVM networks", () => {
      expect(isEvmNetwork("arbitrum")).toBe(true);
      expect(isEvmNetwork("base")).toBe(true);
      expect(isEvmNetwork("bnb")).toBe(true);
      expect(isEvmNetwork("solana-mainnet")).toBe(false);
    });

    it("should identify Solana networks", () => {
      expect(isSolanaNetwork("solana-mainnet")).toBe(true);
      expect(isSolanaNetwork("solana-devnet")).toBe(true);
      expect(isSolanaNetwork("arbitrum")).toBe(false);
    });

    it("should identify testnets", () => {
      expect(isTestnet("arbitrum-sepolia")).toBe(true);
      expect(isTestnet("bnb-testnet")).toBe(true);
      expect(isTestnet("solana-devnet")).toBe(true);
      expect(isTestnet("arbitrum")).toBe(false);
      expect(isTestnet("solana-mainnet")).toBe(false);
    });
  });

  describe("address formatting", () => {
    it("should truncate addresses", () => {
      const address = "0x1234567890abcdef1234567890abcdef12345678";
      const truncated = truncateAddress(address);
      expect(truncated).toBe("0x1234...5678");
    });

    it("should truncate with custom length", () => {
      const address = "0x1234567890abcdef1234567890abcdef12345678";
      const truncated = truncateAddress(address, 8, 8);
      expect(truncated).toBe("0x123456...12345678");
    });
  });

  describe("currency formatting", () => {
    it("should format USD amounts", () => {
      expect(formatUsd(1234.56)).toContain("1,234.56");
      expect(formatUsd(0.01)).toContain("0.01");
    });

    it("should format token amounts", () => {
      expect(formatTokenAmount("1000000000000000000", 18)).toBe("1");
      expect(formatTokenAmount("1500000000000000000", 18)).toBe("1.5");
    });
  });

  describe("wallet ID generation", () => {
    it("should generate unique IDs", () => {
      const id1 = generateWalletId();
      const id2 = generateWalletId();
      expect(id1).not.toBe(id2);
    });

    it("should generate non-empty IDs", () => {
      const id = generateWalletId();
      expect(id.length).toBeGreaterThan(0);
    });
  });

  describe("explorer URLs", () => {
    it("should generate transaction explorer URLs", () => {
      const url = getExplorerTxUrl("arbitrum", "0x123");
      expect(url).toContain("arbiscan");
      expect(url).toContain("0x123");
    });

    it("should generate address explorer URLs", () => {
      const url = getExplorerAddressUrl("arbitrum", "0x123");
      expect(url).toContain("arbiscan");
      expect(url).toContain("0x123");
    });

    it("should handle Solana explorers", () => {
      const url = getExplorerTxUrl("solana-mainnet", "signature123");
      expect(url).toContain("solscan");
    });
  });

  describe("network metadata", () => {
    it("should have metadata for all networks", () => {
      const networks: NetworkId[] = [
        "arbitrum",
        "base",
        "bnb",
        "solana-mainnet",
        "solana-devnet",
      ];

      for (const network of networks) {
        expect(NETWORK_METADATA[network]).toBeDefined();
        expect(NETWORK_METADATA[network].name).toBeDefined();
        expect(NETWORK_METADATA[network].nativeToken).toBeDefined();
      }
    });

    it("should have chain type for all networks", () => {
      const networks: NetworkId[] = [
        "arbitrum",
        "base",
        "bnb",
        "solana-mainnet",
      ];

      for (const network of networks) {
        expect(NETWORK_CHAIN_TYPE[network]).toBeDefined();
      }
    });
  });
});

describe("WalletError", () => {
  it("should create error with code", () => {
    const error = new WalletError(
      "Test error",
      WalletErrorCode.INVALID_ADDRESS,
    );
    expect(error.message).toBe("Test error");
    expect(error.code).toBe(WalletErrorCode.INVALID_ADDRESS);
    expect(error.name).toBe("WalletError");
  });

  it("should include details", () => {
    const error = new WalletError(
      "Network error",
      WalletErrorCode.NETWORK_ERROR,
      { network: "arbitrum" },
    );
    expect(error.details).toEqual({ network: "arbitrum" });
  });

  it("should have all error codes defined", () => {
    expect(WalletErrorCode.INVALID_ADDRESS).toBeDefined();
    expect(WalletErrorCode.INSUFFICIENT_BALANCE).toBeDefined();
    expect(WalletErrorCode.NETWORK_ERROR).toBeDefined();
    expect(WalletErrorCode.WALLET_NOT_FOUND).toBeDefined();
  });
});
