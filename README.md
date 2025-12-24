# Havflow - Order Flow Imbalance Visualizer

A real-time order flow imbalance analyzer for BTC/USD, powered by the [Havklo SDK](https://github.com/hitakshiA/Havklo_sdk).

## What This Demonstrates

I built Havflow to showcase the **Havklo SDK's** ability to analyze market microstructure. The app calculates order flow imbalance from the orderbook depth, helping traders understand buying vs selling pressure.

**Key SDK features demonstrated:**
- **Deep orderbook access** - 25 levels of depth for accurate imbalance calculation
- **Real-time volume analysis** - Bid/ask volumes updated with each tick
- **Spread monitoring** - Track market liquidity in real-time
- **Mid-price calculation** - Instant mid-price from `apply_and_get()`

## Features

- Order flow imbalance gauge (-1.0 to +1.0 scale)
- Pressure indicators (Buy/Sell/Balanced)
- 60-second imbalance history sparkline
- Live bid/ask volume totals
- Spread tracking
- Top 10 depth visualization with volume bars
- Dark theme optimized for trading

## Quick Start

```bash
# Clone the repository
git clone https://github.com/hitakshiA/havflow.git
cd havflow

# Install dependencies
npm install

# Start development server
npm run dev
```

Open http://localhost:5173 in your browser.

## How It Works

The app uses 25 levels of orderbook depth to calculate market imbalance:

```javascript
import initWasm, { WasmOrderbook } from './wasm/kraken_wasm.js'

await initWasm()

// Create orderbook with 25 levels for accurate volume analysis
const book = WasmOrderbook.with_depth('BTC/USD', 25)
book.set_precision(1, 8)

// Get full orderbook state in one call
const result = book.apply_and_get(message, 25)

// Calculate imbalance from bid/ask volumes
const bidVolume = result.bids.reduce((sum, [_, qty]) => sum + qty, 0)
const askVolume = result.asks.reduce((sum, [_, qty]) => sum + qty, 0)
const imbalance = (bidVolume - askVolume) / (bidVolume + askVolume)

// Interpret the signal
// imbalance > 0.1  → Buy pressure (more bids than asks)
// imbalance < -0.1 → Sell pressure (more asks than bids)
// otherwise        → Balanced market
```

## Understanding Imbalance

| Value | Meaning | Market Condition |
|-------|---------|------------------|
| +1.0 | All bids, no asks | Extreme buy pressure |
| +0.3 | 65% bids, 35% asks | Moderate buy pressure |
| 0.0 | Equal bids and asks | Balanced |
| -0.3 | 35% bids, 65% asks | Moderate sell pressure |
| -1.0 | No bids, all asks | Extreme sell pressure |

## Tech Stack

- **React** - UI framework
- **Vite** - Build tool with WASM support
- **Havklo SDK (WASM)** - Kraken orderbook engine
- **Kraken WebSocket v2** - Real-time market data

## About

Built by **Hitakshi Arora** for the Kraken Forge Hackathon.

Part of the Havklo SDK example applications demonstrating real-time Kraken market data integration.

## License

MIT
