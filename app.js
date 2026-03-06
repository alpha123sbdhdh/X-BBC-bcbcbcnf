const TIMEFRAMES = ["15M", "1H", "4H"];
const CYCLE_MS = 12000;

const state = {
  openTrades: [],
  closedTrades: [],
  profitPct: 0,
  lossStreak: 0,
  pauseUntil: null,
  signals: [],
  latestSnapshot: null,
  latestNews: [],
  running: true,
  timer: null
};

const el = {
  clock: document.getElementById("clock"),
  deskState: document.getElementById("deskState"),
  dataMode: document.getElementById("dataMode"),
  health: document.getElementById("health"),
  llmMode: document.getElementById("llmMode"),
  refreshNow: document.getElementById("refreshNow"),
  toggleRun: document.getElementById("toggleRun"),
  winRate: document.getElementById("winRate"),
  openTrades: document.getElementById("openTrades"),
  closedTrades: document.getElementById("closedTrades"),
  profitPct: document.getElementById("profitPct"),
  lastConfidence: document.getElementById("lastConfidence"),
  lossStreak: document.getElementById("lossStreak"),
  heatmap: document.getElementById("heatmap"),
  feed: document.getElementById("feed"),
  signals: document.getElementById("signals"),
  news: document.getElementById("news"),
  latestJson: document.getElementById("latestJson"),
  discord: document.getElementById("discord"),
  telegram: document.getElementById("telegram"),
  twitter: document.getElementById("twitter")
};

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const rnd = (min, max) => Math.random() * (max - min) + min;

async function fetchJSON(url, opts = {}) {
  const resp = await fetch(url, opts);
  if (!resp.ok) throw new Error(`${url} failed ${resp.status}`);
  return resp.json();
}

class MarketDataAgent {
  async snapshot() {
    const [market, news] = await Promise.all([
      fetchJSON("/api/live-market"),
      fetchJSON("/api/news").catch(() => ({ mode: "fallback", items: [] }))
    ]);
    return { ...market, news: news.items || [], newsMode: news.mode || "fallback" };
  }
}

class TechnicalAnalysisAgent {
  analyze(asset) {
    const bullish = asset.price > asset.ma50 && asset.ma50 > asset.ma200;
    const bearish = asset.price < asset.ma50 && asset.ma50 < asset.ma200;
    const direction = bullish ? "BUY" : bearish ? "SELL" : asset.price >= asset.ma20 ? "BUY" : "SELL";
    const marketStructure = bullish ? "bullish" : bearish ? "bearish" : "range";

    return {
      pair: asset.pair,
      direction,
      timeframe: pick(TIMEFRAMES),
      marketStructure,
      bos: direction === "BUY" ? asset.price > Math.max(...asset.closes.slice(-8, -1)) : asset.price < Math.min(...asset.closes.slice(-8, -1)),
      choch: direction === "BUY"
        ? asset.price > asset.ma20 && asset.closes.slice(-5).some((c) => c < asset.ma20)
        : asset.price < asset.ma20 && asset.closes.slice(-5).some((c) => c > asset.ma20),
      liquidityZone: asset.liquiditySweep,
      maAlignment: bullish || bearish,
      rsi: asset.rsi,
      macdHist: asset.macdHist,
      vwap: asset.price > asset.vwap ? "price above VWAP" : "price below VWAP",
      volumeProfile: asset.volumeSpike ? "volume expansion confirmed" : "balanced participation"
    };
  }
}

class StrategyAgent {
  buildSignal(analysis, asset) {
    const entry = asset.price;
    const atrProxy = Math.max(entry * 0.004, Math.abs(asset.ma20 - asset.ma50));
    const stop = analysis.direction === "BUY" ? entry - atrProxy : entry + atrProxy;
    const oneR = Math.abs(entry - stop);

    return {
      pair: analysis.pair,
      direction: analysis.direction,
      entry: Number(entry.toFixed(4)),
      stop_loss: Number(stop.toFixed(4)),
      take_profit: [2, 3, 4].map((r) => Number((analysis.direction === "BUY" ? entry + r * oneR : entry - r * oneR).toFixed(4))),
      timeframe: analysis.timeframe,
      riskPerTradePct: Number(rnd(0.5, 2.0).toFixed(2))
    };
  }
}

class AIConfidenceAgent {
  score(analysis, asset, signal, newsItems) {
    const indicatorAlignment = [analysis.bos, analysis.maAlignment, analysis.macdHist * (signal.direction === "BUY" ? 1 : -1) > 0].filter(Boolean).length / 3;
    const volumeConfirmation = asset.volumeSpike ? 1 : 0.4;
    const momentumStrength = Math.min(1, Math.abs(asset.macdHist) * 5);
    const liquidityConditions = asset.liquiditySweep || Math.abs(asset.fundingRate) > 0.004 ? 0.85 : 0.5;
    const trendDirection = analysis.marketStructure === "range" ? 0.5 : (analysis.marketStructure === (signal.direction === "BUY" ? "bullish" : "bearish") ? 1 : 0.35);
    const newsBias = this.newsBias(newsItems, signal.direction);
    const score = (indicatorAlignment * 0.22 + volumeConfirmation * 0.18 + momentumStrength * 0.17 + liquidityConditions * 0.15 + trendDirection * 0.18 + newsBias * 0.1) * 100;
    return Math.max(0, Math.min(99, Number(score.toFixed(1))));
  }

  newsBias(newsItems, direction) {
    if (!newsItems?.length) return 0.55;
    const sentiment = newsItems.slice(0, 6).reduce((a, n) => a + (n.sentiment || 0), 0);
    if (sentiment === 0) return 0.55;
    return direction === "BUY" ? (sentiment > 0 ? 0.8 : 0.35) : (sentiment < 0 ? 0.8 : 0.35);
  }
}

class SignalExplanationAgent {
  explain(signal, analysis, newsItems) {
    const headline = newsItems?.[0]?.title || "No major headline spike";
    return {
      analysis: `${analysis.marketStructure.toUpperCase()} with ${analysis.bos ? "BOS" : "CHOCH"}, RSI ${analysis.rsi}, MACD hist ${analysis.macdHist}, ${analysis.vwap}, ${analysis.volumeProfile}. News: ${headline}.`,
      risk_management: `Risk ${signal.riskPerTradePct}% per trade. SL at ${signal.stop_loss}, scale out TP1/TP2/TP3, move SL to breakeven after TP1, one re-entry only.`
    };
  }
}

class CommunityBroadcastAgent {
  format(signal) {
    const body = `🚨 CRYPTO SIGNAL 🚨\n\nPair: ${signal.pair}\nDirection: ${signal.direction}\n\nEntry: ${signal.entry}\nStop Loss: ${signal.stop_loss}\n\nTargets:\nTP1: ${signal.take_profit[0]}\nTP2: ${signal.take_profit[1]}\nTP3: ${signal.take_profit[2]}\n\nTimeframe: ${signal.timeframe}\nConfidence: ${signal.confidence}%\n\nReason:\n${signal.analysis}`;
    return { discord: body, telegram: body, twitter: `🚨 ${signal.pair} ${signal.direction} | Entry ${signal.entry} | SL ${signal.stop_loss} | TP ${signal.take_profit.join("/")} | ${signal.timeframe} | Conf ${signal.confidence}%` };
  }
}

class LLMCouncilAgent {
  async deliberate(snapshot, news) {
    return fetchJSON("/api/llm-council", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market: snapshot, news, constraints: { minRR: 2, minConfidence: 65, maxOpenTrades: 3, riskPerTrade: "0.5%-2%" } })
    });
  }
}

const swarm = {
  market: new MarketDataAgent(),
  technical: new TechnicalAnalysisAgent(),
  strategy: new StrategyAgent(),
  confidence: new AIConfidenceAgent(),
  explain: new SignalExplanationAgent(),
  broadcast: new CommunityBroadcastAgent(),
  council: new LLMCouncilAgent()
};

function nowTime() { return new Date().toLocaleTimeString(); }

function appendFeed(msg) {
  const div = document.createElement("div");
  div.className = "feed-item";
  div.innerHTML = `<div class="time">${nowTime()}</div><div>${msg}</div>`;
  el.feed.prepend(div);
  if (el.feed.children.length > 50) el.feed.removeChild(el.feed.lastChild);
}

function renderHeatmap(snapshot) {
  const market = (snapshot.heatmap || []).slice(0, 20);
  el.heatmap.innerHTML = "";
  market.forEach((a) => {
    const tile = document.createElement("div");
    tile.className = "heat";
    const alpha = Math.min(0.8, Math.abs(a.change24h) / 10);
    tile.style.background = a.change24h >= 0 ? `rgba(16,185,129,${alpha})` : `rgba(239,68,68,${alpha})`;
    tile.innerHTML = `${a.symbol}<br>${a.change24h.toFixed(2)}%`;
    el.heatmap.appendChild(tile);
  });
}

function renderNews(news) {
  el.news.innerHTML = "";
  news.slice(0, 8).forEach((n) => {
    const div = document.createElement("div");
    div.className = "feed-item";
    div.innerHTML = `<div class="time">${new Date((n.publishedOn || 0) * 1000).toLocaleTimeString()}</div><div><a href="${n.url}" target="_blank" rel="noreferrer">${n.title}</a></div>`;
    el.news.appendChild(div);
  });
}

function renderSignals() {
  el.signals.innerHTML = "";
  state.signals.slice(0, 12).forEach((s) => {
    const div = document.createElement("div");
    div.className = "signal-item";
    div.innerHTML = `<strong>${s.pair}</strong> <span class="${s.direction === "BUY" ? "buy" : "sell"}">${s.direction}</span> • Conf ${s.confidence}%<br>Entry ${s.entry} | SL ${s.stop_loss} | TP ${s.take_profit.join(" / ")}<br><span class="time">${s.timeframe} • ${s.ts} • ${s.source}</span>`;
    el.signals.appendChild(div);
  });
}

function updateMetrics(lastConfidence = "--") {
  const wins = state.closedTrades.filter((t) => t.pnl > 0).length;
  const total = state.closedTrades.length;
  el.winRate.textContent = `${total ? ((wins / total) * 100).toFixed(1) : "0.0"}%`;
  el.openTrades.textContent = state.openTrades.length;
  el.closedTrades.textContent = total;
  el.profitPct.textContent = `${state.profitPct.toFixed(2)}%`;
  el.lastConfidence.textContent = typeof lastConfidence === "number" ? `${lastConfidence}%` : lastConfidence;
  el.lossStreak.textContent = state.lossStreak;
}

function settleTrade() {
  if (!state.openTrades.length || Math.random() > 0.55) return;
  const trade = state.openTrades.shift();
  const pnl = Math.random() > 0.42 ? rnd(0.3, 2.4) : -rnd(0.3, 1.3);
  state.closedTrades.push({ ...trade, pnl: Number(pnl.toFixed(2)) });
  state.profitPct += pnl;
  state.lossStreak = pnl < 0 ? state.lossStreak + 1 : 0;
  if (state.lossStreak >= 2) {
    state.pauseUntil = Date.now() + 2 * 60 * 60 * 1000;
    appendFeed("Risk Engine: 2 losses in a row. Desk paused 2 hours.");
  }
}

function deskPaused() { return state.pauseUntil && Date.now() < state.pauseUntil; }

function qualityPass(ta, asset) {
  const trendOk = ta.maAlignment && (ta.bos || ta.choch);
  const volumeOk = asset.volumeSpike;
  const liquidityOk = asset.liquiditySweep || Math.abs(asset.fundingRate) > 0.004 || asset.openInterest > 0;
  return trendOk && volumeOk && liquidityOk;
}

function updateDataModeBadge(mode) {
  if (mode === "live") {
    el.dataMode.textContent = "Data: LIVE";
    el.dataMode.className = "badge active";
  } else {
    el.dataMode.textContent = "Data: FALLBACK";
    el.dataMode.className = "badge paused";
  }
}

async function checkHealth() {
  try {
    const h = await fetchJSON("/health");
    el.health.textContent = `Server: ${h.status.toUpperCase()}`;
    el.health.className = "badge active";
  } catch {
    el.health.textContent = "Server: DOWN";
    el.health.className = "badge paused";
  }
}

async function generateCycle() {
  if (!state.running) return;

  el.clock.textContent = nowTime();
  settleTrade();

  const paused = deskPaused();
  el.deskState.textContent = paused ? "Desk Paused" : "Desk Active";
  el.deskState.className = `badge ${paused ? "paused" : "active"}`;

  const snapshot = await swarm.market.snapshot();
  state.latestSnapshot = snapshot;
  state.latestNews = snapshot.news || [];

  updateDataModeBadge(snapshot.mode || "fallback");
  renderHeatmap(snapshot);
  renderNews(state.latestNews);
  appendFeed(`MarketDataAgent: ${snapshot.mode || "fallback"} snapshot (${snapshot.assets?.length || 0} assets), news ${state.latestNews.length}.`);

  if (paused) return updateMetrics("PAUSED");
  if (state.openTrades.length >= 3) {
    appendFeed("Risk Engine: max 3 open trades reached.");
    return updateMetrics("LIMIT");
  }

  let signal = null;
  let source = "LOCAL";

  try {
    const council = await swarm.council.deliberate(snapshot, state.latestNews);
    if (council.mode === "live_llm_council") {
      el.llmMode.textContent = "LLM Council: LIVE";
      el.llmMode.className = "badge active";
      if (council.accepted && council.finalSignal) {
        signal = council.finalSignal;
        source = "LLM-COUNCIL";
      }
    } else {
      el.llmMode.textContent = "LLM Council: SIM";
      el.llmMode.className = "badge paused";
    }
  } catch (err) {
    el.llmMode.textContent = "LLM Council: ERROR";
    el.llmMode.className = "badge paused";
    appendFeed(`LLM council error: ${err.message}`);
  }

  if (!signal) {
    const asset = pick(snapshot.assets || []);
    if (!asset) return updateMetrics("NO-DATA");

    const ta = swarm.technical.analyze(asset);
    const baseSignal = swarm.strategy.buildSignal(ta, asset);

    if (!qualityPass(ta, asset)) {
      appendFeed(`Signal rejected for ${asset.pair} by quality filter.`);
      return updateMetrics("REJECT");
    }

    const confidence = swarm.confidence.score(ta, asset, baseSignal, state.latestNews);
    if (confidence < 65) {
      appendFeed(`Confidence rejection ${asset.pair}: ${confidence}%`);
      return updateMetrics(confidence);
    }

    const explain = swarm.explain.explain(baseSignal, ta, state.latestNews);
    signal = { ...baseSignal, confidence, analysis: explain.analysis, risk_management: explain.risk_management };
  }

  const oneR = Math.abs(signal.entry - signal.stop_loss);
  const rr = oneR ? Math.abs(signal.take_profit[0] - signal.entry) / oneR : 0;
  if (rr < 2 || signal.confidence < 65) {
    appendFeed(`Risk gate blocked signal RR=${rr.toFixed(2)} conf=${signal.confidence}%.`);
    return updateMetrics(signal.confidence || "REJECT");
  }

  signal.ts = nowTime();
  signal.source = source;

  state.signals.unshift(signal);
  state.openTrades.push(signal);

  const broadcast = swarm.broadcast.format(signal);
  el.discord.textContent = broadcast.discord;
  el.telegram.textContent = broadcast.telegram;
  el.twitter.textContent = broadcast.twitter;

  const signalJson = {
    pair: signal.pair,
    direction: signal.direction,
    entry: signal.entry,
    stop_loss: signal.stop_loss,
    take_profit: signal.take_profit,
    timeframe: signal.timeframe,
    confidence: signal.confidence,
    analysis: signal.analysis,
    risk_management: signal.risk_management
  };

  el.latestJson.textContent = JSON.stringify(signalJson, null, 2);
  appendFeed(`Signal broadcasted ${signal.pair} ${signal.direction} (${source}).`);
  renderSignals();
  updateMetrics(signal.confidence);

  console.log(JSON.stringify(signalJson));
}

function bootstrap() {
  appendFeed("System: website initialized. Click Refresh Now to run instantly.");
  checkHealth();
  el.refreshNow.addEventListener("click", () => generateCycle().catch((e) => appendFeed(`Cycle error: ${e.message}`)));
  el.toggleRun.addEventListener("click", () => {
    state.running = !state.running;
    el.toggleRun.textContent = state.running ? "Pause Cycle" : "Resume Cycle";
    appendFeed(`Scheduler ${state.running ? "resumed" : "paused"}.`);
  });
  state.timer = setInterval(() => generateCycle().catch((e) => appendFeed(`Cycle error: ${e.message}`)), CYCLE_MS);
  generateCycle().catch((e) => appendFeed(`Init error: ${e.message}`));
}

bootstrap();
