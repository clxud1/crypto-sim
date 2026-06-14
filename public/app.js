const socket = io();

let chart;
let candle;

let price = 0;
let lines = {};
let currentSymbol = null;

// =====================
// SOUND
// =====================
const audioCtx =
  new (window.AudioContext || window.webkitAudioContext)();

function sound(freq, time) {
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.value = 0.15;

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start();
  setTimeout(() => osc.stop(), time);
}

function playClick() {
  sound(500, 80);
}

function playBuy() {
  sound(500, 120);
  setTimeout(() => sound(900, 150), 120);
}

function playSell() {
  sound(300, 150);
  setTimeout(() => sound(150, 200), 150);
}

// =====================
// CHART INIT
// =====================
function createChart() {
  chart = LightweightCharts.createChart(
    document.getElementById("chart"),
    {
      layout: {
        background: { color: "#000" },
        textColor: "#94a3b8"
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false }
      }
    }
  );

  candle = chart.addCandlestickSeries();
}

function resetChart() {
  if (chart) chart.remove();
  lines = {};
  createChart();
}

window.onload = () => {
  createChart();
};

// =====================
// MARKET
// =====================
socket.on("market", data => {
  price = data.price;

  // =====================
  // SYMBOL CHANGE
  // =====================
  if (currentSymbol !== data.symbol) {
    resetChart();
    currentSymbol = data.symbol;
  }

  // =====================
  // UI
  // =====================
  coinName.innerHTML = data.symbol;
  coinPrice.innerHTML = price.toLocaleString() + " USDT";

  coinChange.innerHTML =
    (data.change >= 0 ? "+" : "") +
    Number(data.change).toFixed(2) +
    "%";

  candle.setData(data.chart);

  // =====================
  // POSITION LINES (ONLY THIS SYMBOL)
  // =====================
  data.positions.forEach(p => {
    if (p.symbol !== data.symbol) return;

    let line = lines[p.id];

    if (!line) {
      line = chart.addLineSeries({ lineWidth: 2 });

      line.applyOptions({
        color: p.side === "LONG" ? "#16c784" : "#ea3943"
      });

      lines[p.id] = line;
    }

    line.setData([
      { time: data.chart[0].time, value: p.entry },
      { time: data.chart[data.chart.length - 1].time, value: p.entry }
    ]);
  });

  // =====================
  // ⭐ FIXED ASSET CALC (핵심)
  // =====================
  let totalValue = 0;

  data.positions.forEach(p => {
    // ❗ 절대 price 쓰지 않음 (이게 핵심)
    const cp = p.currentPrice ?? p.entry;

    totalValue += p.amount * cp;
  });

  let totalAsset = data.cash + totalValue;

  cash.innerHTML = data.cash.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  asset.innerHTML = totalAsset.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });

  let percent = ((totalAsset - 10000) / 10000) * 100;

  assetPercent.innerHTML =
    "(" +
    (percent >= 0 ? "+" : "") +
    percent.toFixed(2) +
    "%)";

  assetPercent.style.color =
    percent >= 0 ? "#16c784" : "#ef4444";

  render(data.positions);
});

// =====================
// COIN CHANGE
// =====================
coinSelect.onchange = () => {
  playClick();

  fetch("/coin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol: coinSelect.value
    })
  });
};

// =====================
// LEVERAGE
// =====================
leverage.oninput = () => {
  levText.innerHTML = leverage.value + "x";
};

function setLeverage(v) {
  playClick();
  leverage.value = v;
  levText.innerHTML = v + "x";
}

// =====================
// PERCENT
// =====================
function setPercent(v) {
  playClick();

  let money =
    Number(cash.innerHTML.replace(/,/g, "")) * v / 100;

  amount.value = Math.floor(money / price);
}

// =====================
// OPEN
// =====================
function openOrder(side) {
  playBuy();

  fetch("/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      side,
      leverage: Number(leverage.value),
      amount: Number(amount.value),
      price
    })
  });
}

// =====================
// CLOSE
// =====================
function closePosition(id) {
  playSell();

  fetch("/close", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id })
  });
}

// =====================
// RENDER POSITIONS
// =====================
function render(list) {
  let html = "";

  list.forEach(p => {
    const good = p.pnl >= 0;

    html += `
      <div class="pos ${p.side}">
        <b>${p.symbol}</b>
        <br>
        ${p.side}
        <br>
        수량 : ${p.amount}
        <br>
        평단가 : ${p.entry.toFixed(2)}

        <div class="${good ? "profit" : "loss"}">
          ${good ? "+" : ""}
          ${p.pnl.toLocaleString(undefined, {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
          })}
          USDT
          (
          ${good ? "+" : ""}
          ${p.percent.toFixed(2)}%
          )
        </div>

        <button class="closeBtn"
          onclick="closePosition(${p.id})">
          CLOSE
        </button>
      </div>
    `;
  });

  positions.innerHTML = html;
}

// =====================
function changeCoin(symbol) {
  playClick();

  coinSelect.value = symbol;

  fetch("/coin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol })
  });
}