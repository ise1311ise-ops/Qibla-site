const TG = window.Telegram?.WebApp;

const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/** Надёжный “тап” для Telegram WebView (Android):
 *  - pointerup (лучше всего)
 *  - click (fallback)
 */
function onTap(el, fn){
  if(!el) return;
  el.addEventListener("pointerup", (e) => { fn(e); }, { passive: true });
  el.addEventListener("click", (e) => { fn(e); }, { passive: true });
}

const storeKey    = "finny.v4.data";
const settingsKey = "finny.v4.settings";

const state = {
  filter: "all",
  q: "",
  type: "expense",
  editingId: null,
  items: [],
  settings: { theme: "dark", dateFormat: "ru" },
  modal: "none" // none | add | settings
};

const currencyMap = { RUB:"₽", EUR:"€", USD:"$" };

function uid(){ return Math.random().toString(16).slice(2) + Date.now().toString(16); }

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

function escapeHTML(s){
  return String(s)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function save(){ localStorage.setItem(storeKey, JSON.stringify(state.items)); }
function saveSettings(){ localStorage.setItem(settingsKey, JSON.stringify(state.settings)); }

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

function applyTheme(){
  document.body.classList.toggle("light", state.settings.theme === "light");

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

/* ===== MODAL MANAGER ===== */
function lockScroll(){ document.body.style.overflow = "hidden"; }
function unlockScroll(){ document.body.style.overflow = ""; }

function hideAllModals(){
  const a = $("#overlayAdd");
  const s = $("#overlaySettings");
  if(a) a.hidden = true;
  if(s) s.hidden = true;
  state.modal = "none";

  if (TG){
    TG.MainButton.offClick(onSave);
    TG.MainButton.hide();
  }
  unlockScroll();
}

function openModal(kind){
  hideAllModals();

  if(kind === "add"){
    $("#overlayAdd").hidden = false;
    state.modal = "add";
    lockScroll();

    if (TG){
      TG.MainButton.setText(state.editingId ? "Сохранить изменения" : "Сохранить");
      TG.MainButton.show();
      TG.MainButton.offClick(onSave);
      TG.MainButton.onClick(onSave);
    }
    return;
  }

  if(kind === "settings"){
    $("#overlaySettings").hidden = false;
    state.modal = "settings";
    lockScroll();
    return;
  }
}

function closeModal(){
  hideAllModals();
}

function setTypeUI(type){
  $$(".type-btn[data-type]").forEach(b => b.classList.toggle("active", b.dataset.type === type));
}
function setThemeUI(){
  $$(".type-btn[data-theme]").forEach(b => b.classList.toggle("active", b.dataset.theme === state.settings.theme));
}
function setDateFmtUI(){
  $$(".type-btn[data-datefmt]").forEach(b => b.classList.toggle("active", b.dataset.datefmt === state.settings.dateFormat));
}

/* ===== Render ===== */
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

  $("#tgHint").style.display = TG ? "none" : "block";
}

/* ===== Actions ===== */
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

function openAdd(editItem = null){
  state.editingId = editItem?.id ?? null;

  $("#sheetTitle").textContent = editItem ? "Редактировать" : "Новая операция";

  const now = todayISO();
  $("#dateInput").value = editItem?.date ?? now;
  $("#amountInput").value = editItem?.amount ?? "";
  $("#noteInput").value = editItem?.note ?? "";
  $("#currencySelect").value = editItem?.currency ?? "RUB";
  $("#categorySelect").value = editItem?.category ?? "Еда";

  state.type = editItem?.type ?? "expense";
  setTypeUI(state.type);

  openModal("add");
}

function openSettings(){
  setThemeUI();
  setDateFmtUI();
  openModal("settings");
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
  closeModal();
  haptic("success");
}

function removeItem(id){
  state.items = state.items.filter(i => i.id !== id);
  save();
  render();
  haptic("warning");
}

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

/* ===== Events ===== */
function bind(){
  // Главные кнопки
  onTap($("#btnAdd"), () => openAdd(null));
  onTap($("#btnSettings"), () => openSettings());

  // Закрыть/отмена/сохранить в add
  onTap($("#btnCloseAdd"), closeModal);
  onTap($("#btnCancelAdd"), closeModal);
  onTap($("#btnSave"), onSave);

  // Закрыть/готово в settings (ВОТ ТУТ ФИКС)
  onTap($("#btnCloseSettings"), closeModal);
  onTap($("#btnSettingsDone"), () => {
    // сохраняем и выходим
    saveSettings();
    applyTheme();
    render();
    closeModal();
    haptic("success");
  });

  // Закрытие по тапу на фон
  const ovAdd = $("#overlayAdd");
  const ovSet = $("#overlaySettings");
  if(ovAdd) ovAdd.addEventListener("pointerup", (e) => { if(e.target === ovAdd) closeModal(); }, {passive:true});
  if(ovSet) ovSet.addEventListener("pointerup", (e) => { if(e.target === ovSet) closeModal(); }, {passive:true});

  // Тип (доход/расход)
  $$(".type-btn[data-type]").forEach(btn => {
    onTap(btn, () => {
      state.type = btn.dataset.type;
      setTypeUI(state.type);
      haptic("success");
    });
  });

  // Тема (dark/light)
  $$(".type-btn[data-theme]").forEach(btn => {
    onTap(btn, () => {
      state.settings.theme = btn.dataset.theme;
      setThemeUI();
      applyTheme();
      saveSettings();
      haptic("success");
    });
  });

  // Формат даты (кнопки)
  $$(".type-btn[data-datefmt]").forEach(btn => {
    onTap(btn, () => {
      state.settings.dateFormat = btn.dataset.datefmt;
      setDateFmtUI();
      saveSettings();
      render();
      haptic("success");
    });
  });

  // Фильтр
  $$(".seg-btn").forEach(btn => {
    onTap(btn, () => {
      $$(".seg-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.filter = btn.dataset.filter;
      render();
      haptic("success");
    });
  });

  // Поиск
  const search = $("#searchInput");
  if(search){
    search.addEventListener("input", (e) => {
      state.q = e.target.value.trim();
      render();
    });
  }

  // Edit/Delete
  const items = $("#items");
  if(items){
    items.addEventListener("click", (e) => {
      const editId = e.target?.dataset?.edit;
      const delId  = e.target?.dataset?.del;

      if(editId){
        const it = state.items.find(i => i.id === editId);
        if(it) openAdd(it);
      }
      if(delId){
        if(confirm("Удалить операцию?")) removeItem(delId);
      }
    });
  }

  // Export/Import/Clear
  onTap($("#btnExport"), exportJSON);

  const imp = $("#importFile");
  if(imp){
    imp.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if(f) importJSON(f);
      e.target.value = "";
    });
  }

  onTap($("#btnClear"), () => {
    if(confirm("Точно очистить все данные?")){
      state.items = [];
      save();
      render();
      haptic("warning");
    }
  });

  // ESC (браузер)
  document.addEventListener("keydown", (e) => {
    if(e.key === "Escape") closeModal();
  });
}

/* ===== Telegram init ===== */
function initTelegram(){
  if(!TG) return;

  TG.ready();
  TG.expand();

  const saved = localStorage.getItem(settingsKey);
  if(!saved){
    state.settings.theme = TG.colorScheme === "light" ? "light" : "dark";
    saveSettings();
  }

  TG.onEvent?.("themeChanged", () => {
    state.settings.theme = TG.colorScheme === "light" ? "light" : "dark";
    saveSettings();
    applyTheme();
    render();
  });
}

/* Boot */
try{
  load();
  bind();
  initTelegram();
  render();
}catch(err){
  console.error("Finny boot error:", err);
  alert("Ошибка в приложении. Открой консоль/перезагрузи страницу.");
}
