const express=require("express");
const http=require("http");
const {Server}=require("socket.io");
const axios=require("axios");
const fs=require("fs");
const WebSocket=require("ws");

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
// MARKET STATE
// =====================

let symbol="btcusdt";
let price=0;
let change=0;



// =====================
// BINANCE WEB SOCKET (FIX)
// =====================

function connectWS(){

const ws=new WebSocket(`wss://stream.binance.com:9443/ws/${symbol}@ticker`);

ws.on("message",(msg)=>{

let data=JSON.parse(msg);

price=Number(data.c);
change=Number(data.P);

});

ws.on("close",()=>{
setTimeout(connectWS,3000);
});

ws.on("error",()=>{
ws.close();
});

}

connectWS();



// =====================
// CHART (REST OK)
// =====================

async function getChart(){

try{

const r=await axios.get(
"https://api.binance.com/api/v3/klines",
{
params:{
symbol:symbol.toUpperCase(),
interval:"1m",
limit:100
},
timeout:5000
}
);

return r.data.map(x=>({
time:x[0]/1000,
open:+x[1],
high:+x[2],
low:+x[3],
close:+x[4]
}));

}catch(e){
return [];
}

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
// UPDATE LOOP (NO REST PRICE)
// =====================

async function update(){

let chart=await getChart();

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
symbol:symbol.toUpperCase(),
price,
change,
chart
});

}

setInterval(update,1000);



// =====================
// COIN CHANGE
// =====================

app.post("/coin",(req,res)=>{

symbol=req.body.symbol.toLowerCase();

// WS 재연결
connectWS();

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

try{

const r=await axios.get(
"https://api.binance.com/api/v3/klines",
{
params:{
symbol:req.params.coin.toUpperCase(),
interval:"1m",
limit:100
},
timeout:5000
}
);

res.json({
price,
chart:r.data.map(x=>({
time:x[0]/1000,
open:+x[1],
high:+x[2],
low:+x[3],
close:+x[4]
}))
});

}catch(e){

res.json({price,chart:[]});

}

});



// =====================
// SERVER
// =====================

const PORT=process.env.PORT||3000;

server.listen(PORT,()=>{
console.log("running on",PORT);
});
