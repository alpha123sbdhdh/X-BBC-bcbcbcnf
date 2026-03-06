# Quantum Crypto Signal Monitor

A functional website for institutional-style crypto signal monitoring with active agents, live/fallback market feeds, historical indicator analysis, and optional LLM council validation.

## Website features
- Full web dashboard at `/` with:
  - Desk controls (Refresh now / Pause cycle)
  - Health status badge (`/health`)
  - Live signals + JSON payload preview
  - Market heatmap
  - News feed
  - Community broadcast blocks
- Data modes shown directly in UI:
  - `LIVE` when upstream APIs are reachable
  - `FALLBACK` when network providers are blocked/unavailable

## Live data sources
- Binance Spot API (24h ticker + historical candles)
- Binance Futures API (funding + open interest)
- CoinGecko API (top-cap heatmap)
- CryptoCompare API (news)

## Agent swarm
- MarketDataAgent
- TechnicalAnalysisAgent
- StrategyAgent
- AIConfidenceAgent
- SignalExplanationAgent
- CommunityBroadcastAgent
- LLMCouncilAgent

## Risk rules
- Max 3 open trades
- Pause 2 hours after 2 consecutive losses
- Reject confidence under 65
- Require trend + volume + liquidity confirmation
- Require RR >= 1:2

## Run

```bash
export OPENAI_API_KEY="your_key_here"        # optional
export OPENAI_MODEL="gpt-4.1-mini"           # optional
export COINGECKO_API_KEY="your_demo_key"     # optional

npm start
```

Open: `http://localhost:8080`

## API endpoints
- `GET /health`
- `GET /api/live-market`
- `GET /api/news`
- `POST /api/llm-council`

> Note: In restricted environments where external APIs are blocked, the server automatically uses fallback synthetic market/news data so the website remains usable.
