const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const axios=require("axios");
const fs=require("fs");

const app=express();
const server=http.createServer(app);
const io=new Server(server);

app.use(express.static("public"));
app.use(express.json());



// =====================
// USERS (IP BASED)
// =====================

let users={};

function loadUsers(){
if(fs.existsSync("users.json")){
users=JSON.parse(fs.readFileSync("users.json"));
}else{
users={}
}
}

function saveUsers(){
fs.writeFileSync("users.json",JSON.stringify(users,null,2));
}

loadUsers();

function getIP(req){
return (req.headers["x-forwarded-for"] || req.socket.remoteAddress)
.split(",")[0].trim();
}

function getUser(req){

let ip=getIP(req);

if(!users[ip]){
users[ip]={
cash:10000,
positions:[]
};
}

return users[ip];
}



// =====================
// MARKET
// =====================

let symbol="BTCUSDT";

const BASE_URLS=[
"https://api.binance.com",
"https://data.binance.com",
"https://api1.binance.com"
];

async function safeRequest(url,config){

try{

const r=await axios.get(url,config);
return r.data;

}catch(e){
return null;
}

}



// =====================
// CHART (SAFE)
// =====================

async function getChart(){

for(let base of BASE_URLS){

const data=await safeRequest(
`${base}/api/v3/klines`,
{
params:{
symbol,
interval:"1m",
limit:100
},
timeout:5000
}
);

if(data){

return data.map(x=>({
time:x[0]/1000,
open:+x[1],
high:+x[2],
low:+x[3],
close:+x[4]
}));

}

}

return [];

}



// =====================
// TICKER (SAFE)
// =====================

async function getTicker(){

for(let base of BASE_URLS){

const data=await safeRequest(
`${base}/api/v3/ticker/24hr`,
{
params:{symbol},
timeout:5000
}
);

if(data && data.lastPrice){

return{
price:Number(data.lastPrice),
change:Number(data.priceChangePercent)
};

}

}

return{
price:0,
change:0
};

}



// =====================
// PNL
// =====================

function calculate(p,price){

if(p.side==="LONG"){
return (price-p.entry)*p.amount*p.leverage;
}else{
return (p.entry-price)*p.amount*p.leverage;
}

}



// =====================
// UPDATE LOOP
// =====================

async function update(){

let chart=await getChart();
let ticker=await getTicker();

let price=ticker.price;

for(let ip in users){

let user=users[ip];

for(let p of user.positions){
p.pnl=calculate(p,price);
p.percent=(p.pnl/p.margin)*100;
}

let totalPNL=user.positions.reduce((a,b)=>a+b.pnl,0);
user._asset=user.cash+totalPNL;

}

io.emit("market",{
symbol,
price,
change:ticker.change,
chart
});

}

setInterval(update,2000);



// =====================
// COIN
// =====================

app.post("/coin",(req,res)=>{
symbol=req.body.symbol;
res.json({ok:true});
});



// =====================
// OPEN
// =====================

app.post("/open",(req,res)=>{

let user=getUser(req);

let {side,leverage,amount,price}=req.body;

amount=Math.floor(Number(amount));

if(amount<=0){
return res.json({message:"수량 오류"});
}

let margin=amount*price/leverage;

if(margin>user.cash){
return res.json({message:"예수금 부족"});
}

user.cash-=margin;

let same=user.positions.find(
p=>p.symbol===symbol && p.side===side
);

if(same){

let total=same.amount+amount;

same.entry=
(same.entry*same.amount+price*amount)/total;

same.amount=total;
same.margin+=margin;

}else{

user.positions.push({
id:Date.now(),
symbol,
side,
leverage,
amount,
entry:price,
margin,
pnl:0,
percent:0
});

}

saveUsers();

update();

res.json({message:"OPEN"});

});



// =====================
// CLOSE
// =====================

app.post("/close",(req,res)=>{

let user=getUser(req);

let p=user.positions.find(x=>x.id===req.body.id);

if(!p){
return res.json({message:"no"});
}

user.cash+=p.margin+p.pnl;

user.positions=user.positions.filter(x=>x.id!==p.id);

saveUsers();

update();

res.json({message:"CLOSE"});

});



// =====================
// MINI CHART
// =====================

app.get("/mini/:coin",async(req,res)=>{

let old=symbol;

symbol=req.params.coin;

let chart=await getChart();
let ticker=await getTicker();

symbol=old;

res.json({
price:ticker.price,
chart
});

});



// =====================
// SERVER
// =====================

const PORT = process.env.PORT || 3000;

server.listen(PORT,()=>{
console.log("server running on",PORT);
});
