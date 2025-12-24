/* Finny — Telegram WebApp mini app
   Works standalone in browser too. Data stored in localStorage. */

const TG = window.Telegram?.WebApp;

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

const storeKey = "finny.v1.data";
const settingsKey = "finny.v1.settings";

const state = {
  filter: "all",
  q: "",
  type: "expense",
  editingId: null,
  items: [],
  settings: {
    theme: "dark",
    dateFormat: "ru",
  }
};

const currencyMap = {
  RUB: "₽",
  EUR: "€",
  USD: "$"
};

function uid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function todayISO(){
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,"0");
  const dd = String(d.getDate()).padStart(2,"0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDate(iso){
  if(!iso) return "";
  if(state.settings.dateFormat === "iso") return iso;
  const [y,m,d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function load(){
  try{
    const raw = localStorage.getItem(storeKey);
    state.items = raw ? JSON.parse(raw) : [];
  }catch{ state.items = []; }

  try{
    const rawS = localStorage.getItem(settingsKey);
    if(rawS) state.settings = { ...state.settings, ...JSON.parse(rawS) };
  }catch{}

  applyTheme();
}

function save(){
  localStorage.setItem(storeKey, JSON.stringify(state.items));
}

function saveSettings(){
  localStorage.setItem(settingsKey, JSON.stringify(state.settings));
}

function applyTheme(){
  document.body.classList.toggle("light", state.settings.theme === "light");

  // Telegram theme sync
  if (TG){
    TG.setHeaderColor?.(state.settings.theme === "light" ? "#f7f8ff" : "#070a12");
    TG.setBackgroundColor?.(state.settings.theme === "light" ? "#f7f8ff" : "#070a12");
  }
}

function money(n, cur){
  const sym = currencyMap[cur] ?? cur;
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);

  const s = abs.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${sign}${s} ${sym}`;
}

function compute(){
  let income = 0, expense = 0;
  for(const it of state.items){
    const amt = Number(it.amount) || 0;
    if(it.type === "income") income += amt;
    else expense += amt;
  }
  return { income, expense, balance: income - expense };
}

function matchFilter(it){
  if(state.filter !== "all" && it.type !== state.filter) return false;
  if(state.q){
    const q = state.q.toLowerCase();
    const hay = `${it.category} ${it.note ?? ""}`.toLowerCase();
    if(!hay.includes(q)) return false;
  }
  return true;
}

function render(){
  const { income, expense, balance } = compute();

  $("#incomeValue").textContent = money(income, "RUB");
  $("#expenseValue").textContent = money(expense, "RUB");
  $("#balanceValue").textContent = money(balance, "RUB");

  const root = $("#items");
  root.innerHTML = "";

  const filtered = state.items
    .slice()
    .sort((a,b) => (b.date || "").localeCompare(a.date || "") || b.createdAt - a.createdAt)
    .filter(matchFilter);

  $("#emptyState").style.display = filtered.length ? "none" : "block";

  for(const it of filtered){
    const sign = it.type === "income" ? "+" : "−";
    const amt = Number(it.amount) || 0;

    const el = document.createElement("div");
    el.className = "item";
    el.innerHTML = `
      <div class="left">
        <div class="badge ${it.type}">${it.type === "income" ? "＋" : "−"}</div>
        <div class="meta">
          <div class="top">
            <div class="cat">${escapeHTML(it.category || "Другое")}</div>
            <div class="date">${escapeHTML(formatDate(it.date))}</div>
          </div>
          <div class="note">${escapeHTML(it.note || "Без заметки")}</div>
        </div>
      </div>

      <div class="right">
        <div class="sum ${it.type}">${sign} ${money(amt, it.currency || "RUB")}</div>
        <div class="item-actions">
          <button class="small" data-edit="${it.id}">Изм.</button>
          <button class="small" data-del="${it.id}">Удал.</button>
        </div>
      </div>
    `;

    root.appendChild(el);
  }

  // Telegram hints
  if (TG){
    $("#tgHint").style.display = "none";
  } else {
    $("#tgHint").style.display = "block";
  }
}

function escapeHTML(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

/* ======= Overlay control (главный фикс) ======= */
function isOpen(el){ return el && !el.hidden; }

function closeAllOverlays(){
  if (isOpen($("#overlay"))) closeSheet(false);
  if (isOpen($("#settingsOverlay"))) closeSettings(false);
  document.body.style.overflow = "";
}

function lockScroll(){
  document.body.style.overflow = "hidden";
}
function unlockScroll(){
  // если ни один оверлей не открыт — возвращаем скролл
  const anyOpen = isOpen($("#overlay")) || isOpen($("#settingsOverlay"));
  if (!anyOpen) document.body.style.overflow = "";
}

/* ======= Add/Edit sheet ======= */
function openSheet(editItem = null){
  // закрываем настройки, если открыты
  if (isOpen($("#settingsOverlay"))) closeSettings(false);

  state.editingId = editItem?.id ?? null;

  $("#overlay").hidden = false;
  lockScroll();

  const now = todayISO();
  $("#dateInput").value = editItem?.date ?? now;
  $("#amountInput").value = editItem?.amount ?? "";
  $("#noteInput").value = editItem?.note ?? "";
  $("#currencySelect").value = editItem?.currency ?? "RUB";
  $("#categorySelect").value = editItem?.category ?? "Еда";

  state.type = editItem?.type ?? "expense";
  setTypeUI(state.type);

  $("#sheetTitle").textContent = editItem ? "Редактировать" : "Новая операция";

  if (TG){
    TG.MainButton.setText(editItem ? "Сохранить изменения" : "Сохранить");
    TG.MainButton.show();
    TG.MainButton.offClick(onSave);
    TG.MainButton.onClick(onSave);
  }
}

function closeSheet(fromUser = true){
  $("#overlay").hidden = true;
  unlockScroll();

  if (TG){
    TG.MainButton.offClick(onSave);
    TG.MainButton.hide();
  }

  // опционально — “отмена”
  if (fromUser) TG?.HapticFeedback?.impactOccurred?.("light");
}

function setTypeUI(type){
  $$(".type-btn[data-type]").forEach(b => b.classList.toggle("active", b.dataset.type === type));
}

/* ======= Settings sheet ======= */
function openSettings(){
  // закрываем форму, если открыта
  if (isOpen($("#overlay"))) closeSheet(false);

  $("#settingsOverlay").hidden = false;
  lockScroll();

  $$(".type-btn[data-theme]").forEach(b => b.classList.toggle("active", b.dataset.theme === state.settings.theme));
  $("#dateFormatSelect").value = state.settings.dateFormat;

  TG?.HapticFeedback?.impactOccurred?.("light");
}

function closeSettings(fromUser = true){
  $("#settingsOverlay").hidden = true;
  unlockScroll();

  if (fromUser) TG?.HapticFeedback?.impactOccurred?.("light");
}

function onSave(){
  const amountRaw = $("#amountInput").value.replace(",", ".").trim();
  const amount = Number(amountRaw);

  if(!amountRaw || !Number.isFinite(amount) || amount <= 0){
    toast("Введите сумму > 0");
    return;
  }

  const item = {
    id: state.editingId ?? uid(),
    type: state.type,
    amount: Math.round(amount * 100) / 100,
    currency: $("#currencySelect").value,
    category: $("#categorySelect").value,
    date: $("#dateInput").value || todayISO(),
    note: $("#noteInput").value.trim(),
    createdAt: state.editingId
      ? (state.items.find(i=>i.id===state.editingId)?.createdAt ?? Date.now())
      : Date.now(),
  };

  if(state.editingId){
    state.items = state.items.map(i => i.id === state.editingId ? item : i);
  } else {
    state.items.unshift(item);
  }

  save();
  render();
  closeSheet(false);
  haptic("success");
}

function removeItem(id){
  state.items = state.items.filter(i => i.id !== id);
  save();
  render();
  haptic("warning");
}

function toast(text){
  if (TG?.showPopup){
    TG.showPopup({ title: "Finny", message: text, buttons: [{type:"ok"}] });
  } else {
    alert(text);
  }
}

function haptic(type){
  TG?.HapticFeedback?.notificationOccurred?.(type);
}

/* Export / Import */
function exportJSON(){
  const blob = new Blob([JSON.stringify({ items: state.items, settings: state.settings }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "finny-backup.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importJSON(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = JSON.parse(String(reader.result || "{}"));
      if(Array.isArray(data.items)) state.items = data.items;
      if(data.settings) state.settings = { ...state.settings, ...data.settings };
      save();
      saveSettings();
      applyTheme();
      render();
      toast("Импорт готов ✅");
    }catch{
      toast("Не получилось прочитать JSON");
    }
  };
  reader.readAsText(file);
}

/* Events */
function bind(){
  $("#btnAdd").addEventListener("click", () => openSheet(null));
  $("#btnClose").addEventListener("click", () => closeSheet(true));
  $("#btnCancel").addEventListener("click", () => closeSheet(true));
  $("#btnSave").addEventListener("click", onSave);

  // закрытие по тапу на фон
  $("#overlay").addEventListener("click", (e) => {
    if(e.target === $("#overlay")) closeSheet(true);
  });
  $("#settingsOverlay").addEventListener("click", (e) => {
    if(e.target === $("#settingsOverlay")) closeSettings(true);
  });

  // type buttons
  $$(".type-btn[data-type]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.type = btn.dataset.type;
      setTypeUI(state.type);
      haptic("success");
    });
  });

  // filter segmented
  $$(".seg-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".seg-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.filter = btn.dataset.filter;
      render();
      haptic("success");
    });
  });

  $("#searchInput").addEventListener("input", (e) => {
    state.q = e.target.value.trim();
    render();
  });

  $("#items").addEventListener("click", (e) => {
    const editId = e.target?.dataset?.edit;
    const delId = e.target?.dataset?.del;

    if(editId){
      const it = state.items.find(i => i.id === editId);
      if(it) openSheet(it);
    }
    if(delId){
      if(confirm("Удалить операцию?")){
        removeItem(delId);
      }
    }
  });

  $("#btnExport").addEventListener("click", exportJSON);
  $("#importFile").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if(f) importJSON(f);
    e.target.value = "";
  });

  $("#btnClear").addEventListener("click", () => {
    if(confirm("Точно очистить все данные?")){
      state.items = [];
      save();
      render();
      haptic("warning");
    }
  });

  // settings
  $("#btnSettings").addEventListener("click", openSettings);
  $("#btnSettingsClose").addEventListener("click", () => closeSettings(true));
  $("#btnSettingsDone").addEventListener("click", () => {
    closeSettings(false);
    saveSettings();
    applyTheme();
    render();
    haptic("success");
  });

  $$(".type-btn[data-theme]").forEach(btn => {
    btn.addEventListener("click", () => {
      state.settings.theme = btn.dataset.theme;
      $$(".type-btn[data-theme]").forEach(b => b.classList.toggle("active", b.dataset.theme === state.settings.theme));
      applyTheme();
      saveSettings();
      haptic("success");
    });
  });

  $("#dateFormatSelect").addEventListener("change", (e) => {
    state.settings.dateFormat = e.target.value;
    saveSettings();
    render();
  });

  // ESC (в браузере)
  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape"){
      closeAllOverlays();
    }
  });
}

/* Telegram init */
function initTelegram(){
  if(!TG) return;

  TG.ready();
  TG.expand();

  const cs = TG.colorScheme; // "dark" | "light"
  const saved = localStorage.getItem(settingsKey);
  if(!saved){
    state.settings.theme = cs === "light" ? "light" : "dark";
    saveSettings();
  }

  TG.enableClosingConfirmation?.();

  TG.onEvent?.("themeChanged", () => {
    const s = TG.colorScheme;
    state.settings.theme = s === "light" ? "light" : "dark";
    saveSettings();
    applyTheme();
    render();
  });
}

/* Boot */
load();
bind();
initTelegram();
render();
