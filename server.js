const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));
app.use(express.json());

let symbol = "BTCUSDT";
let cash = 10000;
let positions = [];

const symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"];

let prices = {};
symbols.forEach(s => prices[s] = 0);

// =====================
// PRICE
// =====================
async function updatePrices() {
  await Promise.all(
    symbols.map(async (s) => {
      try {
        const r = await axios.get(
          "https://api.binance.com/api/v3/ticker/price",
          { params: { symbol: s } }
        );
        prices[s] = +r.data.price;
      } catch (e) {}
    })
  );
}

// =====================
// CHART
// =====================
async function getChart() {
  const r = await axios.get(
    "https://api.binance.com/api/v3/klines",
    { params: { symbol, interval: "1m", limit: 200 } }
  );

  return r.data.map(x => ({
    time: x[0] / 1000,
    open: +x[1],
    high: +x[2],
    low: +x[3],
    close: +x[4]
  }));
}

// =====================
// UPDATE
// =====================
async function update() {
  await updatePrices();

  const chart = await getChart();

  // ⭐ 핵심: 포지션마다 자기 코인 가격 확정
  positions.forEach(p => {
    const cp = prices[p.symbol] || p.entry;

    p.currentPrice = cp;

    p.pnl = (cp - p.entry) * p.amount * p.leverage * (p.side === "LONG" ? 1 : -1);
    p.percent = p.margin ? (p.pnl / p.margin) * 100 : 0;
  });

  // ⭐ 핵심: 평가금액은 currentPrice 기반만 사용
  const totalValue = positions.reduce((sum, p) => {
    return sum + (p.amount * (p.currentPrice || p.entry));
  }, 0);

  const asset = cash + totalValue;

  let change = 0;

  try {
    const r = await axios.get(
      "https://api.binance.com/api/v3/ticker/24hr",
      { params: { symbol } }
    );
    change = +r.data.priceChangePercent;
  } catch (e) {}

  io.emit("market", {
    symbol,
    price: prices[symbol] || 0,
    change,
    chart,
    cash,
    asset,
    positions
  });
}

setInterval(update, 5000);
update();

// =====================
// COIN CHANGE
// =====================
app.post("/coin", (req, res) => {
  symbol = req.body.symbol;
  update();
  res.json({ ok: true });
});

// =====================
// OPEN
// =====================
app.post("/open", (req, res) => {
  let { side, leverage, amount, price } = req.body;

  amount = Number(amount);
  leverage = Number(leverage);
  price = Number(price);

  if (!side || amount <= 0) {
    return res.json({ message: "error" });
  }

  const margin = amount * price;

  if (margin > cash) {
    return res.json({ message: "예수금 부족" });
  }

  cash -= margin;

  positions.push({
    id: Date.now(),
    symbol,
    side,
    leverage,
    amount,
    entry: price,
    margin,
    pnl: 0,
    percent: 0,
    currentPrice: price
  });

  update();
  res.json({ ok: true });
});

// =====================
// CLOSE
// =====================
app.post("/close", (req, res) => {
  const p = positions.find(x => x.id === req.body.id);
  if (!p) return res.json({ ok: false });

  cash += p.margin + p.pnl;

  positions = positions.filter(x => x.id !== p.id);

  update();
  res.json({ ok: true });
});

server.listen(3000, () => {
  console.log("http://localhost:3000");
});
