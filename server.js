const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8080;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || process.env.COINGECKO_DEMO_API_KEY || '';
const TRACKED = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT'];

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type });
  if (Buffer.isBuffer(body) || body instanceof Uint8Array) return res.end(body);
  if (typeof body === 'string') return res.end(body);
  return res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) { reject(new Error('Payload too large')); req.destroy(); }
    });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch (err) { reject(err); } });
    req.on('error', reject);
  });
}

async function fetchJSON(url, extraHeaders = {}) {
  const resp = await fetch(url, {
    headers: {
      'User-Agent': 'QuantumCryptoSignalMonitor/1.0',
      ...extraHeaders
    }
  });
  if (!resp.ok) throw new Error(`Fetch failed ${resp.status}`);
  return resp.json();
}

const sma = (arr, p) => arr.slice(-p).reduce((a, b) => a + b, 0) / p;
const ema = (values, period) => {
  const k = 2 / (period + 1);
  let current = values[0] || 0;
  for (let i = 1; i < values.length; i += 1) current = values[i] * k + current * (1 - k);
  return current;
};

function rsi(values, period = 14) {
  if (values.length <= period) return 50;
  let gains = 0; let losses = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  const rs = (gains / period) / ((losses / period) || 1e-9);
  return 100 - (100 / (1 + rs));
}

function macd(values) {
  const macdLine = ema(values.slice(-60), 12) - ema(values.slice(-60), 26);
  const signal = ema(values.slice(-60), 9);
  return { macd: macdLine, signal, histogram: macdLine - signal };
}

function sentimentScore(title = '') {
  const text = title.toLowerCase();
  const bull = ['surge', 'rally', 'bull', 'approval', 'buy', 'breakout', 'inflow'];
  const bear = ['hack', 'lawsuit', 'ban', 'bear', 'dump', 'outflow', 'liquidation'];
  let score = 0;
  bull.forEach((w) => { if (text.includes(w)) score += 1; });
  bear.forEach((w) => { if (text.includes(w)) score -= 1; });
  return score;
}

function syntheticSeries(start, points = 240) {
  const arr = [start];
  for (let i = 1; i < points; i += 1) {
    const drift = (Math.random() - 0.48) * 0.006;
    arr.push(Math.max(0.0001, arr[i - 1] * (1 + drift)));
  }
  return arr;
}

function fallbackMarketSnapshot(reason = 'live providers unreachable') {
  const seeds = { BTCUSDT: 65000, ETHUSDT: 3400, SOLUSDT: 145, XRPUSDT: 0.62, BNBUSDT: 580, ADAUSDT: 0.7, DOGEUSDT: 0.14, AVAXUSDT: 38, LINKUSDT: 19, DOTUSDT: 8 };
  const assets = TRACKED.map((symbol) => {
    const closes = syntheticSeries(seeds[symbol]);
    const volumes = syntheticSeries(1000).map((x) => x * 1000);
    const m = macd(closes);
    const price = closes.at(-1);
    const ma20 = sma(closes, 20); const ma50 = sma(closes, 50); const ma200 = sma(closes, 200);
    return {
      pair: `${symbol.replace('USDT', '')}/USDT`, symbol, price: Number(price.toFixed(4)), dailyChange: Number((((price / closes[0]) - 1) * 100).toFixed(2)),
      volumeSpike: volumes.at(-1) > (volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20) * 1.35,
      volatilityExpansion: ((Math.max(...closes.slice(-24)) - Math.min(...closes.slice(-24))) / price) > 0.03,
      liquiditySweep: price < Math.min(...closes.slice(-12, -1)) || price > Math.max(...closes.slice(-12, -1)),
      fundingRate: Number(((Math.random() - 0.5) * 0.01).toFixed(4)), openInterest: Number((100000 + Math.random() * 100000).toFixed(0)),
      ma20: Number(ma20.toFixed(4)), ma50: Number(ma50.toFixed(4)), ma200: Number(ma200.toFixed(4)),
      rsi: Number(rsi(closes).toFixed(2)), macd: Number(m.macd.toFixed(4)), macdSignal: Number(m.signal.toFixed(4)), macdHist: Number(m.histogram.toFixed(4)),
      vwap: Number((closes.slice(-20).reduce((a, b) => a + b, 0) / 20).toFixed(4)), closes: closes.slice(-80)
    };
  });
  const heatmap = assets.map((a, i) => ({ symbol: a.symbol.replace('USDT', ''), name: a.symbol.replace('USDT', ''), marketCapRank: i + 1, change24h: a.dailyChange }));
  return { ts: new Date().toISOString(), mode: 'fallback', reason, assets, heatmap };
}

async function getLiveMarketSnapshot() {
  try {
    const [tickers, cgTop] = await Promise.all([
      fetchJSON('https://api.binance.com/api/v3/ticker/24hr'),
      fetchJSON(
        'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=1&sparkline=false',
        COINGECKO_API_KEY ? { 'x-cg-demo-api-key': COINGECKO_API_KEY } : {}
      )
    ]);

    const tickerMap = new Map(tickers.filter((t) => TRACKED.includes(t.symbol)).map((t) => [t.symbol, t]));
    const assets = await Promise.all(TRACKED.map(async (symbol) => {
      const t = tickerMap.get(symbol);
      if (!t) return null;
      const [klines, premium, oi] = await Promise.all([
        fetchJSON(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=240`),
        fetchJSON(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`).catch(() => ({ lastFundingRate: 0 })),
        fetchJSON(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`).catch(() => ({ openInterest: 0 }))
      ]);
      const closes = klines.map((k) => Number(k[4]));
      const volumes = klines.map((k) => Number(k[5]));
      const last = closes.at(-1); const m = macd(closes);
      const ma20 = sma(closes, 20); const ma50 = sma(closes, 50); const ma200 = sma(closes, 200);
      const avgVolume = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
      return {
        pair: `${symbol.replace('USDT', '')}/USDT`, symbol, price: Number(last.toFixed(4)), dailyChange: Number(Number(t.priceChangePercent).toFixed(2)),
        volumeSpike: volumes.at(-1) > avgVolume * 1.35,
        volatilityExpansion: ((Math.max(...closes.slice(-24)) - Math.min(...closes.slice(-24))) / (last || 1)) > 0.03,
        liquiditySweep: last < Math.min(...closes.slice(-12, -1)) || last > Math.max(...closes.slice(-12, -1)),
        fundingRate: Number(Number(premium.lastFundingRate || 0).toFixed(4)), openInterest: Number(oi.openInterest || 0),
        ma20: Number(ma20.toFixed(4)), ma50: Number(ma50.toFixed(4)), ma200: Number(ma200.toFixed(4)),
        rsi: Number(rsi(closes).toFixed(2)), macd: Number(m.macd.toFixed(4)), macdSignal: Number(m.signal.toFixed(4)), macdHist: Number(m.histogram.toFixed(4)),
        vwap: Number((closes.slice(-20).reduce((a, b) => a + b, 0) / 20).toFixed(4)), closes: closes.slice(-80)
      };
    }));

    const heatmap = cgTop.slice(0, 100).map((c) => ({ symbol: String(c.symbol).toUpperCase(), name: c.name, marketCapRank: c.market_cap_rank, change24h: Number(c.price_change_percentage_24h || 0) }));
    return { ts: new Date().toISOString(), mode: 'live', assets: assets.filter(Boolean), heatmap };
  } catch (error) {
    return fallbackMarketSnapshot(error.message);
  }
}

async function getNewsFeed() {
  try {
    const cc = await fetchJSON('https://min-api.cryptocompare.com/data/v2/news/?lang=EN');
    return {
      ts: new Date().toISOString(), mode: 'live',
      items: (cc.Data || []).slice(0, 12).map((n) => ({ title: n.title, url: n.url, source: n.source, publishedOn: n.published_on, sentiment: sentimentScore(n.title) }))
    };
  } catch (error) {
    return {
      ts: new Date().toISOString(), mode: 'fallback', reason: error.message,
      items: [
        { title: 'Macro watch: Bitcoin range tightens near key liquidity levels', url: '#', source: 'FallbackDesk', publishedOn: Math.floor(Date.now() / 1000), sentiment: 1 },
        { title: 'Derivatives update: funding mixed as alt volatility expands', url: '#', source: 'FallbackDesk', publishedOn: Math.floor(Date.now() / 1000), sentiment: 0 }
      ]
    };
  }
}

function extractText(output = []) {
  return output.flatMap((item) => item.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join('\n').trim();
}

function councilPrompt(role, market, constraints, news = []) {
  return `You are ${role} in an institutional crypto LLM council.
Return only valid minified JSON with keys:
{"pair":"","direction":"BUY|SELL","entry":number,"stop_loss":number,"take_profit":[number,number,number],"timeframe":"","confidence":number,"analysis":"","risk_management":""}
Rules: Confidence 0-100, RR>=2, include BOS/CHOCH, MA20/50/200, RSI, MACD, VWAP, liquidity, and news context.
Market snapshot: ${JSON.stringify(market)}
News: ${JSON.stringify(news.slice(0, 5))}
Constraints: ${JSON.stringify(constraints)}`;
}

async function runOpenAI(userContent) {
  const resp = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OPENAI_MODEL, input: userContent, temperature: 0.2 })
  });
  if (!resp.ok) throw new Error(`OpenAI API ${resp.status}: ${await resp.text()}`);
  const text = extractText((await resp.json()).output);
  if (!text) throw new Error('No text output from OpenAI response');
  return text;
}

function parseSignal(rawText) {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('No JSON object found in model response');
  const parsed = JSON.parse(match[0]);
  ['pair', 'direction', 'entry', 'stop_loss', 'take_profit', 'timeframe', 'confidence', 'analysis', 'risk_management'].forEach((k) => {
    if (parsed[k] === undefined || parsed[k] === null) throw new Error(`Missing key: ${k}`);
  });
  parsed.entry = Number(parsed.entry); parsed.stop_loss = Number(parsed.stop_loss); parsed.take_profit = parsed.take_profit.map(Number); parsed.confidence = Number(parsed.confidence);
  return parsed;
}

function validateSignal(signal) {
  if (!['BUY', 'SELL'].includes(signal.direction)) return { ok: false, reason: 'Invalid direction' };
  if (!Array.isArray(signal.take_profit) || signal.take_profit.length < 3) return { ok: false, reason: 'TP array invalid' };
  if (signal.confidence < 0 || signal.confidence > 100) return { ok: false, reason: 'Confidence out of range' };
  const oneR = Math.abs(signal.entry - signal.stop_loss); const reward = Math.abs(signal.take_profit[0] - signal.entry); const rr = oneR === 0 ? 0 : reward / oneR;
  if (rr < 2) return { ok: false, reason: `RR < 2 (${rr.toFixed(2)})` };
  return { ok: true, rr: Number(rr.toFixed(2)) };
}

function staticFile(req, res) {
  const rawPath = req.url.split('?')[0];
  const reqPath = rawPath === '/' ? '/index.html' : rawPath;
  const normalized = path.normalize(reqPath).replace(/^[/\\]+/, '');
  if (normalized.startsWith('..')) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  const full = path.join(process.cwd(), normalized);
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    return send(res, 200, data, MIME[path.extname(full).toLowerCase()] || 'application/octet-stream');
  });
}

async function handleCouncil(req, res) {
  try {
    const body = await readJson(req);
    const market = body.market || await getLiveMarketSnapshot();
    const constraints = body.constraints || {};
    const news = body.news || (await getNewsFeed()).items;
    if (!OPENAI_API_KEY) return send(res, 200, { mode: 'simulation', reason: 'OPENAI_API_KEY not configured', signals: [] });

    const roles = ['Trend Specialist', 'Momentum Specialist', 'Liquidity & Derivatives Specialist'];
    const memberOutputs = [];
    for (const role of roles) {
      const signal = parseSignal(await runOpenAI(councilPrompt(role, market, constraints, news)));
      memberOutputs.push({ role, signal, validation: validateSignal(signal) });
    }

    const valid = memberOutputs.filter((m) => m.validation.ok).sort((a, b) => b.signal.confidence - a.signal.confidence);
    if (!valid.length) return send(res, 200, { mode: 'live_llm_council', accepted: false, reason: 'No council signal passed validation', memberOutputs });
    return send(res, 200, { mode: 'live_llm_council', accepted: valid[0].signal.confidence >= 65, chosenBy: 'highest_confidence_validated', memberOutputs, finalSignal: valid[0].signal });
  } catch (err) {
    return send(res, 500, { error: err.message });
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url.startsWith('/health')) {
    return send(res, 200, { status: 'ok', service: 'quantum-crypto-signal-monitor', time: new Date().toISOString() });
  }
  if (req.method === 'GET' && req.url.startsWith('/api/live-market')) return send(res, 200, await getLiveMarketSnapshot());
  if (req.method === 'GET' && req.url.startsWith('/api/news')) return send(res, 200, await getNewsFeed());
  if (req.method === 'POST' && req.url === '/api/llm-council') return handleCouncil(req, res);
  if (req.method === 'GET') return staticFile(req, res);
  return send(res, 405, { error: 'Method not allowed' });
});

server.listen(PORT, () => console.log(`Quantum desk listening on http://0.0.0.0:${PORT}`));
