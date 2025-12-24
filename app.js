/* Glass Budget — Telegram Mini App
   Fixes:
   - canvas draw: reset transforms (no cumulative scaling)
   - guard against 0 width/height
   - safe rendering for 1-point arrays
   - chart redraw after layout (double rAF)
*/

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const STORAGE_KEY = "glass_budget_v1";

const CATEGORIES = {
  expense: [
    { key:"food", name:"Еда", emoji:"🍜" },
    { key:"coffee", name:"Кофе", emoji:"☕" },
    { key:"transport", name:"Транспорт", emoji:"🚇" },
    { key:"home", name:"Дом", emoji:"🏠" },
    { key:"health", name:"Здоровье", emoji:"🩺" },
    { key:"fun", name:"Развлечения", emoji:"🎮" },
    { key:"shopping", name:"Покупки", emoji:"🛍️" },
    { key:"subscriptions", name:"Подписки", emoji:"💳" },
    { key:"other", name:"Другое", emoji:"⋯" }
  ],
  income: [
    { key:"salary", name:"Зарплата", emoji:"💼" },
    { key:"freelance", name:"Фриланс", emoji:"🧩" },
    { key:"gift", name:"Подарок", emoji:"🎁" },
    { key:"refund", name:"Возврат", emoji:"↩️" },
    { key:"other", name:"Другое", emoji:"⋯" }
  ]
};

const state = {
  type: "expense",
  range: 7, // 7 | 30 | "all"
  filterType: "all",
  chip: "all",
  search: "",
  items: []
};

const tg = window.Telegram?.WebApp;

function haptic(type="impact", style="light"){
  try{
    if(!tg?.HapticFeedback) return;
    if(type === "impact") tg.HapticFeedback.impactOccurred(style);
    if(type === "notify") tg.HapticFeedback.notificationOccurred(style);
    if(type === "select") tg.HapticFeedback.selectionChanged();
  }catch(_){}
}

function toast(msg){
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(()=> el.classList.remove("show"), 1700);
}

function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function todayISO(){
  const d = new Date();
  const tz = d.getTimezoneOffset()*60000;
  return new Date(d - tz).toISOString().slice(0,10);
}

function formatMoney(n){
  const v = Number(n || 0);
  const isInt = Math.abs(v - Math.round(v)) < 1e-9;
  const opts = isInt ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return v.toLocaleString("ru-RU", opts) + " ₽";
}

function parseMoney(str){
  const v = Number(str);
  return Number.isFinite(v) ? v : 0;
}

function load(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return;
    const data = JSON.parse(raw);
    if(Array.isArray(data.items)) state.items = data.items;
  }catch(_){}
}

function save(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: state.items }));
}

function applyTelegramTheme(){
  if(!tg) return;

  try{
    tg.expand?.();
    tg.setHeaderColor?.("secondary_bg_color");
    tg.setBackgroundColor?.(tg.themeParams?.bg_color || "#0b0f1a");
  }catch(_){}

  try{
    const bg = tg.themeParams?.bg_color;
    if(bg){
      const c = bg.replace("#","");
      const r = parseInt(c.slice(0,2),16), g = parseInt(c.slice(2,4),16), b = parseInt(c.slice(4,6),16);
      const luminance = (0.2126*r + 0.7152*g + 0.0722*b)/255;
      document.documentElement.classList.toggle("light", luminance > 0.62);
    }
  }catch(_){}
}

function setType(type){
  state.type = type;
  $$(".toggle__btn").forEach(b => b.classList.toggle("is-active", b.dataset.type === type));
  rebuildCategorySelect();
}

function rebuildCategorySelect(){
  const sel = $("#category");
  sel.innerHTML = "";
  const list = CATEGORIES[state.type];
  for(const c of list){
    const opt = document.createElement("option");
    opt.value = c.key;
    opt.textContent = `${c.emoji} ${c.name}`;
    sel.appendChild(opt);
  }
}

function withinRange(dateISO){
  if(state.range === "all") return true;
  const days = Number(state.range);
  const d = new Date(dateISO + "T00:00:00");
  const now = new Date();
  const start = new Date(now);
  start.setHours(0,0,0,0);
  start.setDate(start.getDate() - (days - 1));
  return d >= start && d <= now;
}

function categoryMeta(type, key){
  return (CATEGORIES[type] || []).find(c => c.key === key) || { name:"Другое", emoji:"⋯", key:"other" };
}
function categoryName(type, key){
  return categoryMeta(type, key).name;
}

function getFilteredItems(){
  let items = [...state.items];

  items = items.filter(x => withinRange(x.date));

  if(state.filterType !== "all"){
    items = items.filter(x => x.type === state.filterType);
  }

  if(state.chip !== "all"){
    items = items.filter(x => x.category === state.chip);
  }

  const q = state.search.trim().toLowerCase();
  if(q){
    items = items.filter(x => {
      const catName = categoryName(x.type, x.category).toLowerCase();
      const note = (x.note || "").toLowerCase();
      return note.includes(q) || catName.includes(q);
    });
  }

  items.sort((a,b) => (b.date.localeCompare(a.date) || (b.createdAt - a.createdAt)));
  return items;
}

function computeTotals(items){
  let income = 0, expense = 0;
  for(const x of items){
    if(x.type === "income") income += x.amount;
    else expense += x.amount;
  }
  return { income, expense, balance: income - expense };
}

function renderChips(){
  const el = $("#chips");
  el.innerHTML = "";

  let base = [...state.items].filter(x => withinRange(x.date));
  if(state.filterType !== "all") base = base.filter(x => x.type === state.filterType);

  const map = new Map();
  for(const x of base){
    map.set(x.category, (map.get(x.category) || 0) + 1);
  }

  const chipAll = document.createElement("div");
  chipAll.className = "chip" + (state.chip === "all" ? " is-active" : "");
  chipAll.textContent = "Все";
  chipAll.onclick = () => { state.chip = "all"; haptic("select"); renderAll(); };
  el.appendChild(chipAll);

  const entries = [...map.entries()].sort((a,b) => b[1]-a[1]).slice(0, 8);
  for(const [catKey, count] of entries){
    const any = base.find(x => x.category === catKey);
    const meta = any ? categoryMeta(any.type, any.category) : { emoji:"◌", name: catKey };
    const chip = document.createElement("div");
    chip.className = "chip" + (state.chip === catKey ? " is-active" : "");
    chip.textContent = `${meta.emoji} ${meta.name} · ${count}`;
    chip.onclick = () => { state.chip = catKey; haptic("select"); renderAll(); };
    el.appendChild(chip);
  }

  if(state.chip !== "all" && !map.has(state.chip)){
    state.chip = "all";
  }
}

function renderStats(){
  const items = getFilteredItems();
  const totals = computeTotals(items);

  $("#incomeValue").textContent = formatMoney(totals.income);
  $("#expenseValue").textContent = formatMoney(totals.expense);
  $("#balanceValue").textContent = formatMoney(totals.balance);

  const hint = state.range === "all" ? "за всё время" : `за последние ${state.range} дней`;
  $("#rangeLabel").textContent = hint;

  const today = new Date();
  const dd = today.toLocaleDateString("ru-RU", { day:"2-digit", month:"long" });
  $("#balanceHint").textContent = dd;

  $("#listHint").textContent = items.length ? `${items.length} записей` : "пока пусто";

  renderChips();
}

function renderList(){
  const list = $("#txList");
  list.innerHTML = "";

  const items = getFilteredItems();
  if(!items.length){
    const empty = document.createElement("div");
    empty.className = "muted";
    empty.style.padding = "14px 6px";
    empty.textContent = "Добавь первую операцию — и баланс оживёт ✨";
    list.appendChild(empty);
    return;
  }

  for(const x of items){
    const meta = categoryMeta(x.type, x.category);

    const row = document.createElement("div");
    row.className = "tx";
    row.dataset.id = x.id;

    let pressTimer = null;
    row.addEventListener("pointerdown", () => {
      pressTimer = setTimeout(() => {
        if(confirm("Удалить запись?")){
          removeItem(x.id);
        }
      }, 520);
    });
    row.addEventListener("pointerup", () => clearTimeout(pressTimer));
    row.addEventListener("pointercancel", () => clearTimeout(pressTimer));
    row.addEventListener("pointerleave", () => clearTimeout(pressTimer));

    const left = document.createElement("div");
    left.className = "tx__left";

    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = meta.emoji;

    const metaBox = document.createElement("div");
    metaBox.className = "tx__meta";

    const title = document.createElement("div");
    title.className = "tx__title";
    title.textContent = x.note?.trim() ? x.note.trim() : meta.name;

    const sub = document.createElement("div");
    sub.className = "tx__sub";
    sub.textContent =
      `${meta.name} · ${new Date(x.date+"T00:00:00").toLocaleDateString("ru-RU", { day:"2-digit", month:"short" })}`;

    metaBox.appendChild(title);
    metaBox.appendChild(sub);

    left.appendChild(av);
    left.appendChild(metaBox);

    const right = document.createElement("div");
    right.className = "tx__right";

    const sum = document.createElement("div");
    sum.className = "tx__sum " + (x.type === "income" ? "plus" : "minus");
    const sign = x.type === "income" ? "+" : "−";
    sum.textContent = `${sign}${formatMoney(x.amount)}`;

    const tag = document.createElement("div");
    tag.className = "tx__tag";
    tag.textContent = x.type === "income" ? "доход" : "расход";

    right.appendChild(sum);
    right.appendChild(tag);

    row.appendChild(left);
    row.appendChild(right);

    row.addEventListener("dblclick", () => {
      if(confirm("Удалить запись?")) removeItem(x.id);
    });

    list.appendChild(row);
  }
}

function addItem({ type, amount, category, note, date }){
  const item = {
    id: uid(),
    type,
    amount: Math.round(amount * 100) / 100,
    category,
    note: (note || "").trim(),
    date,
    createdAt: Date.now()
  };
  state.items.push(item);
  save();
  haptic("notify", "success");
  toast("Добавлено");
  renderAll();
}

function removeItem(id){
  const before = state.items.length;
  state.items = state.items.filter(x => x.id !== id);
  if(state.items.length !== before){
    save();
    haptic("notify", "warning");
    toast("Удалено");
    renderAll();
  }
}

function clearAll(){
  if(!state.items.length) return toast("Нечего очищать");
  if(!confirm("Очистить все данные?")) return;
  state.items = [];
  save();
  haptic("notify", "warning");
  toast("Очищено");
  renderAll();
}

function seedDemo(){
  const base = new Date();
  const mk = (daysAgo, type, amount, cat, note="") => {
    const d = new Date(base);
    d.setDate(d.getDate() - daysAgo);
    const iso = new Date(d - d.getTimezoneOffset()*60000).toISOString().slice(0,10);
    return { id: uid(), type, amount, category: cat, note, date: iso, createdAt: Date.now()-daysAgo*3600e3 };
  };

  state.items = [
    mk(0, "expense", 390, "coffee", "латте + круассан"),
    mk(1, "expense", 1290, "food", "продукты"),
    mk(2, "income", 85000, "salary", "зарплата"),
    mk(3, "expense", 499, "subscriptions", "подписка"),
    mk(4, "expense", 780, "transport", "такси"),
    mk(6, "income", 12000, "freelance", "заказ"),
    mk(8, "expense", 2400, "shopping", "подарок"),
    mk(10,"expense", 990, "fun", "кино"),
  ];
  save();
  haptic("notify", "success");
  toast("Демо загружено");
  renderAll();
}

function exportJSON(){
  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    items: state.items
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "glass-budget-export.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Экспорт готов");
  haptic("impact", "medium");
}

async function importJSON(file){
  try{
    const text = await file.text();
    const data = JSON.parse(text);
    if(!data?.items || !Array.isArray(data.items)) throw new Error("bad format");
    const items = data.items
      .filter(x => x && (x.type==="income" || x.type==="expense"))
      .map(x => ({
        id: String(x.id || uid()),
        type: x.type,
        amount: Number(x.amount || 0),
        category: String(x.category || "other"),
        note: String(x.note || ""),
        date: String(x.date || todayISO()),
        createdAt: Number(x.createdAt || Date.now())
      }));
    state.items = items;
    save();
    toast("Импортировано");
    haptic("notify", "success");
    renderAll();
  }catch(_){
    toast("Не удалось импортировать");
    haptic("notify", "error");
  }
}

function setRange(r){
  state.range = r;
  $$(".seg__btn").forEach(b => b.classList.toggle("is-active", b.dataset.range === String(r)));
  haptic("select");
  renderAll();
}

/* ===== FIXED CHART ===== */
function drawChart(){
  const canvas = $("#miniChart");
  if(!canvas) return;

  const ctx = canvas.getContext("2d");

  // Берём ширину контейнера, чтобы не ловить 0 от canvas (часто в WebView)
  const cssW = canvas.parentElement?.clientWidth || canvas.clientWidth || 0;
  const cssH = canvas.clientHeight || 140;

  // Если лэйаут ещё не готов — пропускаем
  if(cssW < 40 || cssH < 40) return;

  const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));

  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);

  // КЛЮЧ: сброс трансформации, чтобы scale не накапливался
  ctx.setTransform(1,0,0,1,0,0);
  ctx.scale(dpr, dpr);

  const W = cssW;
  const H = cssH;

  const days = state.range === "all" ? 30 : Number(state.range);
  const now = new Date();
  now.setHours(0,0,0,0);

  const dayList = [];
  for(let i=days-1; i>=0; i--){
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const iso = new Date(d - d.getTimezoneOffset()*60000).toISOString().slice(0,10);
    dayList.push(iso);
  }

  const byDay = new Map(dayList.map(d => [d, { income:0, expense:0 }]));
  for(const x of state.items){
    if(!byDay.has(x.date)) continue;
    if(x.type==="income") byDay.get(x.date).income += x.amount;
    else byDay.get(x.date).expense += x.amount;
  }

  const incomes = dayList.map(d => byDay.get(d).income);
  const expenses = dayList.map(d => byDay.get(d).expense);
  const balances = incomes.map((v,i)=> v - expenses[i]);

  const maxV = Math.max(
    1,
    ...incomes,
    ...expenses,
    ...balances.map(v => Math.abs(v))
  );

  ctx.clearRect(0,0,W,H);

  // grid
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  for(let i=1;i<=3;i++){
    const y = (H/4)*i;
    ctx.beginPath();
    ctx.moveTo(0,y);
    ctx.lineTo(W,y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const line = (arr, rgba) => {
    ctx.strokeStyle = rgba;
    ctx.lineWidth = 2;

    // если одна точка — рисуем одну точку
    if(arr.length <= 1){
      const v = arr[0] || 0;
      const x = W;
      const y = H - (Math.abs(v)/maxV)*H;
      ctx.fillStyle = rgba;
      ctx.beginPath();
      ctx.arc(x, y, 2.6, 0, Math.PI*2);
      ctx.fill();
      return;
    }

    ctx.beginPath();
    arr.forEach((v,i)=>{
      const x = (W/(arr.length-1))*i;
      const y = H - (Math.abs(v)/maxV)*H;
      if(i===0) ctx.moveTo(x,y);
      else ctx.lineTo(x,y);
    });
    ctx.stroke();

    ctx.fillStyle = rgba;
    arr.forEach((v,i)=>{
      const x = (W/(arr.length-1))*i;
      const y = H - (Math.abs(v)/maxV)*H;
      ctx.beginPath();
      ctx.arc(x,y,2.2,0,Math.PI*2);
      ctx.fill();
    });
  };

  line(incomes,  "rgba(102,242,194,0.9)");
  line(expenses, "rgba(255,107,154,0.9)");
  line(balances, "rgba(143,179,255,0.9)");
}
/* ===== /FIXED CHART ===== */

function renderAll(){
  renderStats();
  renderList();
  // двойной кадр — чтобы дождаться layout в Telegram WebView
  requestAnimationFrame(() => requestAnimationFrame(drawChart));
}

function bind(){
  $("#date").value = todayISO();

  $$(".toggle__btn").forEach(btn => {
    btn.addEventListener("click", () => {
      setType(btn.dataset.type);
      haptic("select");
    });
  });

  $$(".seg__btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.range === "all" ? "all" : Number(btn.dataset.range);
      setRange(v);
    });
  });

  $("#txForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const amount = parseMoney($("#amount").value);
    if(amount <= 0){
      toast("Сумма должна быть > 0");
      haptic("notify","error");
      return;
    }
    addItem({
      type: state.type,
      amount,
      category: $("#category").value,
      note: $("#note").value,
      date: $("#date").value || todayISO()
    });
    $("#amount").value = "";
    $("#note").value = "";
    $("#amount").focus();
  });

  $("#filterType").addEventListener("change", (e) => {
    state.filterType = e.target.value;
    haptic("select");
    renderAll();
  });

  $("#search").addEventListener("input", (e) => {
    state.search = e.target.value;
    renderList();
    // график не обязательно перерисовывать на каждый ввод
  });

  $("#btnClear").addEventListener("click", clearAll);
  $("#btnDemo").addEventListener("click", seedDemo);

  $("#btnExport").addEventListener("click", exportJSON);
  $("#fileImport").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if(file) importJSON(file);
    e.target.value = "";
  });

  $("#btnTheme").addEventListener("click", () => {
    document.documentElement.classList.toggle("light");
    haptic("impact","light");
    // перерисуем график после смены темы
    requestAnimationFrame(() => requestAnimationFrame(drawChart));
  });

  window.addEventListener("resize", () => {
    requestAnimationFrame(() => requestAnimationFrame(drawChart));
  });

  if(tg){
    try{
      tg.MainButton.setText("Добавить");
      tg.MainButton.show();
      tg.MainButton.onClick(() => {
        $("#amount").focus();
        haptic("select");
      });
    }catch(_){}
  }
}

function init(){
  applyTelegramTheme();

  load();
  rebuildCategorySelect();
  bind();
  renderAll();

  if(tg){
    try{
      tg.onEvent("themeChanged", () => {
        applyTelegramTheme();
        requestAnimationFrame(() => requestAnimationFrame(drawChart));
      });
    }catch(_){}
  }
}

init();
