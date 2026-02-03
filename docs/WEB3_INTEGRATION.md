# Hyperscape Web3 Integration

> **Multi-chain wallet management and payment infrastructure for AI-powered gaming**

Hyperscape integrates multiple blockchain networks to power in-game economies, AI agent payments, and tokenized assets. This document covers the architecture, supported chains, and integration patterns.

## Overview

Hyperscape supports three primary blockchain ecosystems:

| Chain | Use Case | Native Token | Key Features |
|-------|----------|--------------|--------------|
| **x402/Arbitrum/Base** | AI Agent Payments | ETH/USDs | Auto-yield stablecoin, gasless transactions |
| **BNB Chain (BSC)** | Game Tokens & NFTs | BNB | Low fees, fast finality |
| **Solana** | Fast Transactions | SOL | SPL tokens, sub-second confirmations |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     WalletManager (Unified)                      │
├──────────────────┬──────────────────┬──────────────────────────┤
│   X402Client     │    BNBClient     │   SolanaWalletService    │
│   (EVM/USDs)     │    (BSC)         │   (SPL Tokens)           │
├──────────────────┼──────────────────┼──────────────────────────┤
│  Arbitrum RPC    │    BSC RPC       │    Solana RPC            │
│  Base RPC        │    opBNB RPC     │    (Mainnet/Devnet)      │
└──────────────────┴──────────────────┴──────────────────────────┘
```

## Supported Chains

### x402 Payment Protocol (Arbitrum, Base)

The x402 protocol enables AI agents to make autonomous HTTP-402 payments using USDs stablecoin (Sperax) with built-in auto-yield.

**Supported Networks:**
- `arbitrum` - Arbitrum One (mainnet)
- `arbitrum-sepolia` - Arbitrum Sepolia (testnet)
- `base` - Base (mainnet)
- `ethereum` - Ethereum mainnet
- `polygon` - Polygon PoS
- `optimism` - Optimism mainnet

### BNB Chain (BSC)

BNB Smart Chain integration for game tokens, NFTs, and DeFi operations.

**Supported Networks:**
- `bnb` - BNB Smart Chain mainnet (Chain ID: 56)
- `bnb-testnet` - BSC Testnet (Chain ID: 97)
- `opbnb` - opBNB L2 (Chain ID: 204)

### Solana

High-performance blockchain for fast transactions and SPL token operations.

**Supported Clusters:**
- `solana-mainnet` - Mainnet Beta
- `solana-devnet` - Devnet (testing)
- `solana-testnet` - Testnet

---

## Quick Start

### For AI Agents (ElizaOS)

AI agents in Hyperscape can use natural language commands to interact with wallets:

```
"Check my balance"
"Send 10 USDs to 0x742d35Cc6634C0532925a3b844Bc9e7595f..."
"What's the current price of ETH?"
"Create a new Solana wallet"
"Generate a vanity address starting with 'HYPER'"
```

These commands are handled by the `@hyperscape/plugin-hyperscape` ElizaOS plugin.

### For Developers

#### Installation

```bash
# From workspace root
bun install
```

#### Using the Unified Wallet Manager

The `WalletManager` provides a consistent interface across all chains:

```typescript
import { WalletManager } from '@hyperscape/shared';

// Create manager
const manager = new WalletManager({
  preferredNetworks: ['arbitrum', 'solana-mainnet'],
  balanceCacheTtl: 30000, // 30 second cache
});

// Add EVM wallet (Arbitrum/Base)
const evmWallet = await manager.addWallet(
  'evm', 
  'arbitrum', 
  process.env.PRIVATE_KEY
);

// Add Solana wallet (generates new keypair if no key provided)
const solanaWallet = await manager.addWallet('solana', 'solana-devnet');

// Get unified balance
const balance = await manager.getBalance(evmWallet.id);
console.log(`Native: ${balance.native} ${balance.nativeSymbol}`);
console.log(`Tokens:`, balance.tokens);

// Send transaction
const tx = await manager.send({
  walletId: evmWallet.id,
  to: '0x...',
  amount: '10',
  token: 'USDs',
});

// Subscribe to events
manager.on('balance-updated', (event) => {
  console.log(`Balance updated for ${event.walletId}`);
});
```

#### Using Individual Clients

For more control, use the chain-specific clients directly:

##### x402 Payments

```typescript
import { 
  X402Client, 
  X402Network,
  createArbitrumClient,
  createMockX402Client 
} from '@hyperscape/shared';

// Create client
const client = new X402Client({
  chain: X402Network.Arbitrum,
  privateKey: process.env.X402_PRIVATE_KEY,
  facilitatorUrl: 'https://x402-facilitator.hyperscape.ai',
  gasless: true, // Use meta-transactions
});

// Or use factory helpers
const arbitrumClient = createArbitrumClient({
  privateKey: process.env.X402_PRIVATE_KEY,
});

// Get balance
const balance = await client.getBalance('0x...');
console.log(`USDs: ${balance.usds}`);
console.log(`ETH: ${balance.native}`);

// Check yield earnings
const yieldInfo = await client.getYieldInfo('0x...');
console.log(`APY: ${yieldInfo.apy}%`);
console.log(`Earned: ${yieldInfo.earned} USDs`);

// Make payment
const payment = await client.pay({
  recipient: '0x...',
  amount: '10.00',
  token: 'USDs',
  memo: 'Game item purchase',
});

// For testing, use mock client
const mockClient = createMockX402Client();
```

##### BNB Chain

```typescript
import { 
  BNBClient, 
  BSC_MAINNET,
  BSC_MAINNET_TOKENS,
  toWei,
  fromWei 
} from '@hyperscape/shared';

// Create client
const client = new BNBClient({
  rpcUrl: BSC_MAINNET.rpcUrl,
  chainId: BSC_MAINNET.chainId,
  privateKey: process.env.BNB_PRIVATE_KEY, // Optional for read-only
});

// Or use static factories
const mainnetClient = BNBClient.mainnet();
const testnetClient = BNBClient.testnet();

// Get BNB balance
const balance = await client.getBalance('0x...');
console.log(`BNB: ${balance.bnb}`);

// Get token balance
const usdtBalance = await client.getTokenBalance(
  '0x...',
  BSC_MAINNET_TOKENS.USDT
);
console.log(`USDT: ${usdtBalance}`);

// Get token info
const tokenInfo = await client.getTokenInfo(BSC_MAINNET_TOKENS.USDT);
console.log(`${tokenInfo.name} (${tokenInfo.symbol})`);

// Estimate gas
const estimate = await client.estimateGas({
  to: '0x...',
  amount: '1.0',
});
console.log(`Gas cost: ${estimate.estimatedCost} BNB`);

// Transfer (requires privateKey)
const tx = await client.transfer({
  to: '0x...',
  amount: '0.1',
});
```

##### Solana

```typescript
import { 
  SolanaWalletService,
  SPLTokenService,
  DEVNET_RPC_URL,
  lamportsToSol,
  solToLamports 
} from '@hyperscape/shared';

// Generate new wallet
const wallet = SolanaWalletService.generate();
const address = SolanaWalletService.toBase58(wallet.publicKey);
console.log(`Address: ${address}`);

// Generate vanity address
const vanity = await SolanaWalletService.generateVanity({
  prefix: 'HYPER',
  maxAttempts: 1000000,
  timeout: 30000,
  onProgress: (progress) => {
    console.log(`Attempts: ${progress.attempts}, Rate: ${progress.rate}/s`);
  },
});
console.log(`Vanity address: ${SolanaWalletService.toBase58(vanity.wallet.publicKey)}`);

// Create service for RPC operations
const service = new SolanaWalletService({ rpcUrl: DEVNET_RPC_URL });

// Get balance
const balance = await service.getBalance(address);
console.log(`SOL: ${balance.sol}`);

// Request airdrop (devnet only)
const airdrop = await service.requestAirdrop(address, solToLamports(1).toString());
console.log(`Airdrop signature: ${airdrop.signature}`);

// SPL Token operations
const spl = new SPLTokenService({ rpcUrl: DEVNET_RPC_URL });
const tokens = await spl.getAllTokenBalances(address);
console.log(`Token balances:`, tokens);

// Securely clear wallet from memory
SolanaWalletService.zeroize(wallet);
```

---

## Configuration

### Environment Variables

```bash
# ==================== x402 Payments ====================
# Private key for x402 payments (required for send)
X402_PRIVATE_KEY=0x...

# Default chain (arbitrum, base, ethereum, polygon, optimism)
X402_CHAIN=arbitrum

# Custom facilitator URL (optional)
X402_FACILITATOR_URL=https://x402-facilitator.hyperscape.ai

# Enable gasless meta-transactions (default: true)
X402_GASLESS=true

# ==================== BNB Chain ====================
# RPC URL (defaults to public endpoint)
BNB_RPC_URL=https://bsc-dataseed.binance.org/

# Private key for transactions (optional for read-only)
BNB_PRIVATE_KEY=0x...

# Chain ID (56 = mainnet, 97 = testnet)
BNB_CHAIN_ID=56

# ==================== Solana ====================
# RPC URL (defaults to devnet)
SOLANA_RPC_URL=https://api.devnet.solana.com

# Cluster name (mainnet-beta, devnet, testnet)
SOLANA_CLUSTER=devnet

# ==================== Market Data ====================
# Enable real-time price feeds
ENABLE_PRICE_FEED=true

# Symbols to track (comma-separated)
PRICE_FEED_SYMBOLS=BTCUSDT,ETHUSDT,SOLUSDT,BNBUSDT

# Update interval in milliseconds
PRICE_FEED_INTERVAL=5000

# Use WebSocket for real-time updates
PRICE_FEED_USE_WEBSOCKET=true
```

---

## Plugin Integration (ElizaOS)

The `@hyperscape/plugin-hyperscape` package provides ElizaOS actions and providers for Web3 functionality.

### Available Actions

#### Payment Actions (`payments.ts`)
- `CHECK_BALANCE` - Check wallet balance
- `SEND_PAYMENT` - Send tokens to an address
- `CHECK_YIELD` - Check USDs yield earnings
- `PAY_FOR_SERVICE` - Make x402 HTTP payment

#### Trading Actions (`trading.ts`)
- `CHECK_PRICE` - Get current crypto price
- `PRICE_HISTORY` - Get historical price data
- `SET_PRICE_ALERT` - Create price alert

#### Solana Actions (`solana.ts`)
- `GENERATE_SOLANA_WALLET` - Create new Solana wallet
- `CHECK_SOLANA_BALANCE` - Get SOL and SPL balances
- `SEND_SOL` - Transfer SOL tokens
- `GENERATE_VANITY_ADDRESS` - Create vanity address
- `REQUEST_SOLANA_AIRDROP` - Request devnet SOL

### Available Providers

- `walletProvider` - x402 wallet state and balances
- `marketProvider` - Real-time crypto prices
- `solanaWalletProvider` - Solana wallet state

### Plugin Configuration

```typescript
// In your ElizaOS agent configuration
import { hyperscapePlugin } from '@hyperscape/plugin-hyperscape';

const agentConfig = {
  plugins: [hyperscapePlugin],
  settings: {
    HYPERSCAPE_SERVER_URL: 'ws://localhost:5555/ws',
    X402_PRIVATE_KEY: process.env.X402_PRIVATE_KEY,
    // ... other settings
  }
};
```

---

## Server Integration

### Market Data System

The server includes a Binance price feed for real-time crypto prices:

```typescript
import { 
  initializeServerSystems,
  shutdownServerSystems,
  getGlobalPriceFeed 
} from '@hyperscape/server/startup';

// During server startup
const systems = await initializeServerSystems(config);

// Access price feed anywhere
const feed = getGlobalPriceFeed();
if (feed) {
  const btcPrice = feed.getPrice('BTCUSDT');
  console.log(`BTC: $${btcPrice?.price.toLocaleString()}`);
  
  // Subscribe to price updates
  const unsubscribe = feed.subscribe({
    symbols: ['BTCUSDT', 'ETHUSDT'],
    callback: (tick) => {
      console.log(`${tick.symbol}: $${tick.price}`);
    },
    minInterval: 1000,
  });
  
  // Get historical data
  const candles = await feed.getHistoricalPrices('BTCUSDT', '1h', 24);
}

// During shutdown
await shutdownServerSystems(systems);
```

---

## Security Considerations

### Private Key Management

⚠️ **Never commit private keys to source control**

```typescript
// ❌ BAD - Never do this
const client = new X402Client({
  privateKey: '0x1234567890abcdef...',
});

// ✅ GOOD - Use environment variables
const client = new X402Client({
  privateKey: process.env.X402_PRIVATE_KEY,
});

// ✅ BETTER - Use secure vaults
import { getSecret } from './secure-vault';
const client = new X402Client({
  privateKey: await getSecret('x402-private-key'),
});
```

### Memory Security

For Solana wallets, clear sensitive data when done:

```typescript
const wallet = SolanaWalletService.generate();
try {
  // Use wallet...
} finally {
  SolanaWalletService.zeroize(wallet);
}
```

### Network Security

- Always test on testnets first (`arbitrum-sepolia`, `bnb-testnet`, `solana-devnet`)
- Enable rate limiting for production RPC endpoints
- Use dedicated RPC providers (Alchemy, QuickNode, Helius) for production
- Validate all addresses before sending transactions

### Transaction Security

```typescript
// Always validate addresses
if (!X402Client.isValidAddress(recipient)) {
  throw new Error('Invalid recipient address');
}

// Confirm amounts before sending
const balance = await client.getBalance(address);
if (parseFloat(amount) > parseFloat(balance.usds)) {
  throw new Error('Insufficient balance');
}

// Use maximum slippage protection
const tx = await client.pay({
  recipient,
  amount,
  maxSlippage: 0.01, // 1% max slippage
});
```

---

## Testing

### Running Tests

```bash
# Run all web3 tests
bun test packages/shared/src/web3

# Run specific test file
bun test packages/shared/src/web3/__tests__/x402.test.ts

# Run with coverage
bun test --coverage packages/shared/src/web3
```

### Mock Clients

Use mock clients for unit testing:

```typescript
import { createMockX402Client } from '@hyperscape/shared';

const mockClient = createMockX402Client({
  balance: { usds: '100', native: '1.0' },
  simulateDelay: 100,
});

// Mock client returns predictable values
const balance = await mockClient.getBalance('0x...');
expect(balance.usds).toBe('100');
```

---

## API Reference

For detailed API documentation, see the generated TypeDoc:

```bash
# Generate API docs
bun run typedoc

# View at docs/api/index.html
```

### Quick Reference

| Module | Main Exports |
|--------|--------------|
| `@hyperscape/shared/web3/x402` | `X402Client`, `X402Network`, `PaymentStatus` |
| `@hyperscape/shared/web3/bnb` | `BNBClient`, `BSC_MAINNET`, `toWei`, `fromWei` |
| `@hyperscape/shared/web3/solana` | `SolanaWalletService`, `SPLTokenService`, `lamportsToSol` |
| `@hyperscape/shared/web3` | `WalletManager`, `createWalletManager` + all above |

---

## Troubleshooting

### Common Issues

**"Invalid private key"**
- Ensure key is 64 hex characters with `0x` prefix
- Check for extra whitespace in environment variable

**"Network error" / "RPC timeout"**
- Check RPC endpoint is reachable
- Try alternative RPC URL
- Increase timeout in client config

**"Insufficient balance"**
- Ensure wallet has enough native token for gas
- For USDs, ensure token balance is sufficient

**"Address validation failed"**
- EVM addresses: Must be 40 hex chars with `0x` prefix
- Solana addresses: Must be valid Base58 (32-44 chars)

### Debug Mode

Enable debug logging for troubleshooting:

```typescript
const client = new X402Client({
  chain: X402Network.Arbitrum,
  debug: true, // Enables verbose logging
});
```

---

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines on contributing to the Web3 integration.

---

## License

MIT © Hyperscape AI
