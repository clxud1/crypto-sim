const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const axios = require("axios");

const app = express();

// =====================
// ⭐ RENDER PORT FIX
// =====================
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 4000;

// =====================
// MIDDLEWARE
// =====================
app.use(express.static("public"));
app.use(express.json());

// =====================
// STATE
// =====================
let symbol = "BTCUSDT";
let cash = 10000;
let positions = [];

const symbols = ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT"];

let prices = {};
symbols.forEach(s => (prices[s] = 0));

// =====================
// PRICE UPDATE
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
  try {
    const r = await axios.get(
      "https://api.binance.com/api/v3/klines",
      {
        params: {
          symbol,
          interval: "1m",
          limit: 200
        }
      }
    );

    return r.data.map(x => ({
      time: x[0] / 1000,
      open: +x[1],
      high: +x[2],
      low: +x[3],
      close: +x[4]
    }));
  } catch {
    return [];
  }
}

// =====================
// UPDATE LOOP
// =====================
async function update() {
  await updatePrices();

  const chart = await getChart();

  positions.forEach(p => {
    const cp = prices[p.symbol] || p.entry;

    p.currentPrice = cp;

    p.pnl =
      (cp - p.entry) *
      p.amount *
      p.leverage *
      (p.side === "LONG" ? 1 : -1);

    p.percent = p.margin ? (p.pnl / p.margin) * 100 : 0;
  });

  const totalValue = positions.reduce((sum, p) => {
    return sum + p.amount * (p.currentPrice ?? p.entry);
  }, 0);

  const asset = cash + totalValue;

  let change = 0;
  try {
    const r = await axios.get(
      "https://api.binance.com/api/v3/ticker/24hr",
      { params: { symbol } }
    );
    change = +r.data.priceChangePercent;
  } catch {}

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

// =====================
// SOCKET LOOP
// =====================
setInterval(update, 5000);
update();

// =====================
// ROUTES
// =====================
app.get("/", (req, res) => {
  res.send("Crypto Exchange Server Running");
});

// COIN CHANGE
app.post("/coin", (req, res) => {
  symbol = req.body.symbol;
  update();
  res.json({ ok: true });
});

// OPEN
app.post("/open", (req, res) => {
  let { side, leverage, amount, price } = req.body;

  amount = Number(amount);
  leverage = Number(leverage);
  price = Number(price);

  if (!side || amount <= 0) {
    return res.json({ ok: false });
  }

  const margin = amount * price;

  if (margin > cash) {
    return res.json({ ok: false, message: "예수금 부족" });
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

// CLOSE
app.post("/close", (req, res) => {
  const p = positions.find(x => x.id === req.body.id);

  if (!p) return res.json({ ok: false });

  cash += p.margin + p.pnl;

  positions = positions.filter(x => x.id !== p.id);

  update();
  res.json({ ok: true });
});

// =====================
// START SERVER (⭐ RENDER FIX)
// =====================
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
