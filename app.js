const LS_KEYS = {
  assets: 'pf.assets.v12.8',
  todos: 'pf.todos.v12.8',
  priceCache: 'pf.price.cache.v12.8',
  priceHist: 'pf.price.hist.v12.8',
  priceMonthFetched: 'pf.price.months.v12.8',
  calYM: 'pf.calendar.ym.v12.8',
  modalState: 'pf.modal.state.v12.8',
  groupMode: 'pf.group.mode.v12.8'
};

const DEFAULT_SUGGESTIONS = [
  { id:'tether',      symbol:'USDT', name:'Tether'   },
  { id:'bitcoin',     symbol:'BTC',  name:'Bitcoin'  },
  { id:'ethereum',    symbol:'ETH',  name:'Ethereum' },
  { id:'binancecoin', symbol:'BNB',  name:'BNB'      },
  { id:'solana',      symbol:'SOL',  name:'Solana'   },
];

const TICKER_MAP = {
  BTC:'bitcoin', ETH:'ethereum', BNB:'binancecoin', SOL:'solana', USDT:'tether',
  XRP:'ripple', ADA:'cardano', DOGE:'dogecoin', TRX:'tron', DOT:'polkadot',
  AVAX:'avalanche-2', MATIC:'matic-network', LINK:'chainlink', TON:'the-open-network',
  ARB:'arbitrum', OP:'optimism', LTC:'litecoin', BCH:'bitcoin-cash', ATOM:'cosmos',
  NEAR:'near', XMR:'monero', FIL:'filecoin', APT:'aptos', SUI:'sui',
  INJ:'injective-protocol', RUNE:'thorchain', MKR:'maker', AAVE:'aave',
  PEPE:'pepe', SHIB:'shiba-inu', UNI:'uniswap', ETC:'ethereum-classic'
};

function normalizeAssetInput(rawValue, dataset){
  const manual = (rawValue||'').trim();
  const sym = manual.toUpperCase();
  let id = dataset.coinId || '';
  let ticker = dataset.coinSym || sym || id.toUpperCase();
  if(!id){
    if(sym && TICKER_MAP[sym]) id = TICKER_MAP[sym];
    else id = manual.toLowerCase();
  }
  if(!ticker) ticker = sym || id.toUpperCase();
  return { assetId: id, ticker };
}

const App = {
  assets: [],
  todos: [],
  priceCache: {},
  priceHist: {},
  priceMonthFetched: {},
  calYear: null,
  calMonth: null,
  allowFetchToday: false,
  modalOpenState: {},
  groupMode: 'source',

  init(){
    const todayCN = this.todayCN();
    byId('currentDate').value = todayCN;
    byId('assetDate').value = todayCN;

    this.assets = readLS(LS_KEYS.assets, []);
    this.todos = readLS(LS_KEYS.todos, []);
    this.priceCache = readLS(LS_KEYS.priceCache, {});
    this.priceHist = readLS(LS_KEYS.priceHist, {});
    this.priceMonthFetched = readLS(LS_KEYS.priceMonthFetched, {});
    this.modalOpenState = readLS(LS_KEYS.modalState, {});
    this.groupMode = readLS(LS_KEYS.groupMode, 'source');
    const ymSaved = readLS(LS_KEYS.calYM, null);
    const now = new Date();
    const y0 = now.getFullYear(), m0 = now.getMonth();
    this.calYear = (ymSaved && Number.isInteger(ymSaved.year)) ? ymSaved.year : y0;
    this.calMonth = (ymSaved && Number.isInteger(ymSaved.month)) ? ymSaved.month : m0;

    if(this.assets.length===0){
      this.addAsset({date: todayCN, name:'USDT Wallet', assetId:'tether', ticker:'USDT', amount:88685, memo:'初始化', sub:''}, false);
    }

    this.bindEvents();
    this.bindSearchInputs();
    this.enhanceDateInputs();

    (async ()=>{
      // 不 await，避免首屏阻塞
      this.prefetchMonthIfNeeded(this.calYear, this.calMonth);
      this.spawnTodayInstancesForTemplates();
      await this.refreshAll();
      this.renderTodos();
      this.renderPnLMonth();
      this.updateSourceOptions();
    })();
  },

  todayCN(){
    const fmt = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' });
    const parts = fmt.formatToParts(new Date());
    const y = parts.find(p=>p.type==='year').value;
    const m = parts.find(p=>p.type==='month').value;
    const d = parts.find(p=>p.type==='day').value;
    return `${y}-${m}-${d}`;
  },
  ymdStr(y,m,d){ return `${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`; },
  dateToStrLocal(date){
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  },

  bindEvents(){
    byId('btnRefresh').addEventListener('click', async ()=>{ await this.refreshAll(); this.renderPnLMonth(); });
    byId('currentDate').addEventListener('change', async ()=>{ await this.refreshAll(); this.renderPnLMonth(); });

    byId('btnAdd').addEventListener('click', async ()=>{
      const date = byId('assetDate').value || this.todayCN();
      const name = (byId('assetName').value || '').trim() || 'Unknown';
      const ds = byId('assetTypeSearch').dataset;
      const norm = normalizeAssetInput(byId('assetTypeSearch').value, ds);
      const assetId = norm.assetId;
      const ticker = norm.ticker;
      const amount = Number(byId('assetAmount').value);
      const memo = (byId('assetMemo').value||'').trim();
      const sub = (byId('assetSub')?.value||'').trim();
      if(!date || !assetId || !isFinite(amount)){ alert('请填写日期 / 资产类型 / 数量'); return; }
      this.addAsset({date, name, assetId, ticker, amount, memo, sub});
      byId('assetAmount').value=''; byId('assetMemo').value=''; if(byId('assetSub')) byId('assetSub').value='';
      byId('assetTypeSearch').value=''; byId('assetTypeSearch').dataset.coinId=''; byId('assetTypeSearch').dataset.coinSym='';
      this.updateSourceOptions();

      const d = new Date(date+'T00:00:00'); this.prefetchMonthIfNeeded(d.getFullYear(), d.getMonth());
      await this.ensureDayPrices(date, [assetId]);

      await this.refreshAll(); this.renderPnLMonth();
    });

    const exportPayload = (only='all')=>{
      const o = { exportedAt:new Date().toISOString() };
      if(only==='assets'){ o.assets = this.assets; }
      else if(only==='todos'){ o.todos = this.todos; }
      else { o.assets = this.assets; o.todos = this.todos; o.priceCache = this.priceCache; o.priceHist = this.priceHist; o.priceMonthFetched = this.priceMonthFetched; }
      return o;
    };
    byId('btnExportAll').addEventListener('click', ()=> downloadJSON(exportPayload('all'), `portfolio_all_${Date.now()}.json`) );
    byId('btnExportAssets').addEventListener('click', ()=> downloadJSON(exportPayload('assets'), `portfolio_assets_${Date.now()}.json`) );
    byId('btnExportTodos').addEventListener('click', ()=> downloadJSON(exportPayload('todos'), `portfolio_todos_${Date.now()}.json`) );
    byId('btnImport').addEventListener('click', ()=> byId('importFile').click());
    byId('importFile').addEventListener('change', async (e)=>{
      const f = e.target.files?.[0]; if(!f) return;
      let data; try{ data = JSON.parse(await f.text()); }catch{ alert('JSON 解析失败'); return; }
      if(!confirm('导入将替换本地现有数据，是否继续？')) return;
      this.assets = Array.isArray(data.assets)? data.assets : (Array.isArray(data)? data: []);
      this.todos = Array.isArray(data.todos)? data.todos : [];
      this.priceCache = data.priceCache || {};
      this.priceHist = data.priceHist || {};
      this.priceMonthFetched = data.priceMonthFetched || {};
      saveLS(LS_KEYS.assets, this.assets);
      saveLS(LS_KEYS.todos, this.todos);
      saveLS(LS_KEYS.priceCache, this.priceCache);
      saveLS(LS_KEYS.priceHist, this.priceHist);
      saveLS(LS_KEYS.priceMonthFetched, this.priceMonthFetched);
      e.target.value = '';
      this.updateSourceOptions();
      await this.refreshAll(); this.renderTodos(); this.renderPnLMonth();
      alert('导入完成');
    });
    byId('btnClear').addEventListener('click', ()=>{
      if(!confirm('确定清除本地的所有数据？不可撤销。')) return;
      this.assets = []; this.todos = []; this.priceCache = {}; this.priceHist = {}; this.priceMonthFetched = {};
      saveLS(LS_KEYS.assets, this.assets);
      saveLS(LS_KEYS.todos, this.todos);
      saveLS(LS_KEYS.priceCache, this.priceCache);
      saveLS(LS_KEYS.priceHist, this.priceHist);
      saveLS(LS_KEYS.priceMonthFetched, this.priceMonthFetched);
      this.updateSourceOptions();
      this.refreshAll(); this.renderTodos(); this.renderPnLMonth();
    });

    byId('btnPrevMonth').addEventListener('click', async ()=>{ const d=new Date(this.calYear,this.calMonth,1); d.setMonth(d.getMonth()-1); this.calYear=d.getFullYear(); this.calMonth=d.getMonth(); this.persistYM(); this.prefetchMonthIfNeeded(this.calYear, this.calMonth); this.renderPnLMonth(); });
    byId('btnNextMonth').addEventListener('click', async ()=>{ const d=new Date(this.calYear,this.calMonth,1); d.setMonth(d.getMonth()+1); this.calYear=d.getFullYear(); this.calMonth=d.getMonth(); this.persistYM(); this.prefetchMonthIfNeeded(this.calYear, this.calMonth); this.renderPnLMonth(); });
    byId('btnToday').addEventListener('click', async ()=>{ const n=new Date(); this.calYear=n.getFullYear(); this.calMonth=n.getMonth(); this.persistYM(); this.prefetchMonthIfNeeded(this.calYear, this.calMonth); this.renderPnLMonth(); });
    byId('btnEarliest').addEventListener('click', async ()=>{ const e=this.getEarliestDate(); const d = e? new Date(e) : new Date(); this.calYear=d.getFullYear(); this.calMonth=d.getMonth(); this.persistYM(); this.prefetchMonthIfNeeded(this.calYear, this.calMonth); this.renderPnLMonth(); });

    ['modal','todoModal'].forEach(id=>{
      const overlay = byId(id);
      const closer = (id==='modal')? byId('modalClose'): byId('todoModalClose');
      closer.addEventListener('click', ()=> overlay.classList.remove('show'));
      overlay.addEventListener('click', (e)=>{ if(e.target===overlay) overlay.classList.remove('show'); });
      document.addEventListener('keydown', (e)=>{ if(e.key==='Escape') overlay.classList.remove('show'); });
    });

    byId('btnAddTodo').addEventListener('click', ()=>{
      const title = (byId('todoTitle').value||'').trim();
      if(!title){ alert('请填写待办内容'); return; }
      const due = byId('todoDue').value || null;
      const pr = byId('todoPriority').value || 'normal';
      const daily = byId('todoDaily').checked;
      const note = (byId('todoNote').value||'').trim();
      if(daily){
        const tpl = { id: uid(), title, time: (due||'').split('T')[1]||'09:00', priority: pr, note, repeatDaily: true, createdAt: Date.now() };
        this.upsertTemplate(tpl);
        this.ensureInstanceForDate(tpl, this.todayCN());
      }else{
        this.todos.push({ id: uid(), title, due, priority: pr, done:false, note, createdAt: Date.now() });
      }
      saveLS(LS_KEYS.todos, this.todos);
      byId('todoTitle').value=''; byId('todoDue').value=''; byId('todoDaily').checked=false; byId('todoNote').value='';
      this.renderTodos(); this.renderPnLMonth();
    });
  },

  enhanceDateInputs(){
    document.querySelectorAll('input[type=\"date\"],input[type=\"datetime-local\"]').forEach(inp=>{
      inp.addEventListener('click', ()=>{ if(typeof inp.showPicker === 'function') try{ inp.showPicker(); }catch{} });
      inp.addEventListener('focus', ()=>{ if(typeof inp.showPicker === 'function') try{ inp.showPicker(); }catch{} });
    });
  },

  persistYM(){ saveLS(LS_KEYS.calYM, {year:this.calYear, month:this.calMonth}); },

  updateSourceOptions(){
    const names = [...new Set(this.assets.map(a=>a.name).filter(Boolean))].sort();
    byId('sourceList').innerHTML = names.map(n=>`<option value=\"${esc(n)}\"></option>`).join('');
    const subs = [...new Set(this.assets.map(a=> (a.sub||this.parseSubFromMemo(a.memo)||'').trim()).filter(Boolean))].sort();
    const dl2 = byId('subList'); if(dl2) dl2.innerHTML = subs.map(s=>`<option value=\"${esc(s)}\"></option>`).join('');
  },

  // === Price fetch ===
  async prefetchMonthIfNeeded(year, month){
    const key = (y,m,id)=> `${y}-${String(m+1).padStart(2,'0')}|${id}`;
    const ids = [...new Set(this.assets.map(a=>a.assetId).filter(id=>id && !['usdt','other'].includes(id.toLowerCase())))];
    for(const id of ids){
      const k = key(year, month, id);
      if(this.priceMonthFetched[k]) continue;
      try{
        const from = Math.floor(new Date(year, month, 1, 0, 0, 0).getTime()/1000);
        const to = Math.floor(new Date(year, month+1, 0, 23, 59, 59).getTime()/1000);
        const url = `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart/range?vs_currency=usd&from=${from}&to=${to}`;
        const r = await fetch(url);
        if(!r.ok) throw new Error('price_fail');
        const data = await r.json();
        const arr = data?.prices || [];
        if(!arr.length) throw new Error('empty');
        const map = this.priceHist[id] = this.priceHist[id] || {};
        arr.forEach(([ts, price])=>{
          const d = new Date(ts);
          const fmt = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' });
          const parts = fmt.formatToParts(d);
          const y = parts.find(p=>p.type==='year').value;
          const m = parts.find(p=>p.type==='month').value;
          const day = parts.find(p=>p.type==='day').value;
          const ds = `${y}-${m}-${day}`;
          map[ds] = price;
        });
        this.priceMonthFetched[k] = true;
        saveLS(LS_KEYS.priceHist, this.priceHist);
        saveLS(LS_KEYS.priceMonthFetched, this.priceMonthFetched);
      }catch(e){ /* ignore */ }
    }
  },

  async fetchSimplePrices(ids){
    if(!ids || ids.length===0) return;
    const chunks = []; const copy=[...new Set(ids)];
    while(copy.length) chunks.push(copy.splice(0,25));
    for(const batch of chunks){
      try{
        const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(batch.join(','))}&vs_currencies=usd`;
        const r = await fetch(url);
        if(!r.ok) continue;
        const data = await r.json();
        const today = this.todayCN();
        for(const id of batch){
          const price = data?.[id]?.usd || 0;
          if(price>0){
            this.priceHist[id] = this.priceHist[id] || {};
            this.priceHist[id][today] = price;
          }
        }
        saveLS(LS_KEYS.priceHist, this.priceHist);
      }catch{}
    }
  },

  async ensureDayPrices(dateStr, onlyIds=null){
    const baseIds = [...new Set(this.buildPositionsUpTo(dateStr).map(p=>p.assetId).filter(id=>id && !['usdt','other'].includes(id.toLowerCase())))];
    const ids = onlyIds && onlyIds.length ? baseIds.filter(x=>onlyIds.includes(x)) : baseIds;
    if(ids.length===0) return;
    const today = this.todayCN();
    if(dateStr===today){
      await this.fetchSimplePrices(ids);
      return;
    }
    const missing = ids.filter(id=> !(this.priceHist?.[id]?.[dateStr] > 0) );
    if(missing.length===0) return;

    const limit = 4; // 并发上限
    let idx = 0;
    const worker = async ()=>{
      while(idx < missing.length){
        const id = missing[idx++];
        try{
          const [y,m,d] = dateStr.split('-');
          const r = await fetch(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/history?date=${d}-${m}-${y}`);
          if(!r.ok) continue;
          const data = await r.json();
          const price = data?.market_data?.current_price?.usd || 0;
          if(price>0){
            this.priceHist[id] = this.priceHist[id]||{};
            this.priceHist[id][dateStr] = price;
          }
        }catch{}
      }
    };
    await Promise.all(Array.from({length: Math.min(limit, missing.length)}, ()=>worker()));
    saveLS(LS_KEYS.priceHist, this.priceHist);
  },

  // ===== Data model =====
  parseSubFromMemo(memo){
    if(!memo) return '';
    const m = String(memo).match(/#([^\s#]+)/);
    return m ? m[1] : '';
  },
  getAssetSub(a){
    return (a.sub && String(a.sub).trim()) || this.parseSubFromMemo(a.memo) || '未标记';
  },

  addAsset({date,name,assetId,ticker,amount,memo,sub}, save=true){
    const id = (assetId||'').toString().trim();
    const tk = (ticker||id).toString().toUpperCase();
    const item = { id: uid(), date, name, assetId: id.toLowerCase(), ticker: tk, amount:Number(amount)||0, memo: memo||'', sub: (sub||'').trim() || this.parseSubFromMemo(memo)||'', createdAt: Date.now() };
    this.assets.push(item);
    if(save) saveLS(LS_KEYS.assets, this.assets);
    return item;
  },
  updateAsset(id, patch){
    const i = this.assets.findIndex(x=>x.id===id);
    if(i<0) return;
    if(patch.assetId) patch.assetId = String(patch.assetId).toLowerCase();
    if(patch.ticker) patch.ticker = String(patch.ticker).toUpperCase();
    if(typeof patch.sub === 'string') patch.sub = patch.sub.trim();
    this.assets[i] = {...this.assets[i], ...patch};
    saveLS(LS_KEYS.assets, this.assets);
  },
  deleteAsset(id){
    this.assets = this.assets.filter(x=>x.id!==id);
    saveLS(LS_KEYS.assets, this.assets);
  },

  buildPositionsUpTo(dateStr){
    const map = new Map();
    for(const a of this.assets.filter(x=>x.date<=dateStr)){
      const k = `${a.name}|${a.assetId}`;
      if(!map.has(k)) map.set(k, { name: a.name, assetId: a.assetId, ticker: a.ticker, amount:0 });
      const slot = map.get(k);
      slot.amount += Number(a.amount)||0;
    }
    return [...map.values()].filter(p=> (Number(p.amount)||0) > 0);
  },
  id2sym(id){
    for(const [sym,_id] of Object.entries(TICKER_MAP)){
      if(_id === String(id).toLowerCase()) return sym;
    }
    const map = {'tether':'USDT','usdt':'USDT'};
    return map[String(id).toLowerCase()] || String(id||'').toUpperCase();
  },
  getPriceForDateCached(assetId, dateStr){
    if(!assetId) return 0;
    const lid = String(assetId).toLowerCase();
    if(lid==='usdt' || lid==='other') return 1;
    return this.priceHist?.[lid]?.[dateStr] ?? 0;
  },
  valueOnDate(asset, dateStr){
    const amt = Math.max(0, Number(asset.amount)||0);
    if(amt===0) return 0;
    const px = this.getPriceForDateCached(asset.assetId, dateStr);
    return amt * px;
  },
  getTotalUSDTByDate(dateStr){
    const positions = this.buildPositionsUpTo(dateStr);
    let sum=0; for(const p of positions) sum += this.valueOnDate(p, dateStr);
    return Math.min(Math.max(0,sum), 1e12);
  },
  async refreshAll(){
    const dateStr = byId('currentDate').value || this.todayCN();
    await this.ensureDayPrices(dateStr);
    const total = this.getTotalUSDTByDate(dateStr);
    byId('totalAssets').textContent = fmt(total);

    const d = new Date(dateStr+'T00:00:00'); const prev = new Date(d); prev.setDate(d.getDate()-1);
    const prevStr = this.dateToStrLocal(prev);
    await this.ensureDayPrices(prevStr);
    const prevVal = this.getTotalUSDTByDate(prevStr);
    const change = total - prevVal;
    const pct = prevVal>0 ? (change/prevVal)*100 : 0;
    const sign = change>=0?'+':'';
    byId('dayChangeText').textContent = `${sign}${fmt(change)} USDT (${sign}${(pct||0).toFixed(2)}%)`;
  },

  // ===== Calendar =====
  renderPnLMonth(){
    const label = byId('pnlMonthLabel');
    label.textContent = `${this.calYear} 年 ${String(this.calMonth+1).padStart(2,'0')} 月`;
    const grid = byId('pnlCalendar');
    const first = new Date(this.calYear, this.calMonth, 1);
    const startWeekday = first.getDay();
    const daysInMonth = new Date(this.calYear, this.calMonth+1, 0).getDate();
    const today = this.todayCN();

    const cells = [];
    for(let i=0;i<startWeekday;i++) cells.push(`<div class=\"pnl-cell\" style=\"visibility:hidden\"></div>`);
    for(let day=1; day<=daysInMonth; day++){
      const ds = this.ymdStr(this.calYear, this.calMonth, day);
      const isFuture = ds > today;
      const tdCount = this.todos.filter(t=> !t.repeatDaily && !!t.due && !t.done && t.due.startsWith(ds)).length;

      let cellHtml = `<div class=\"pnl-cell\" data-date=\"${ds}\"><div class=\"pnl-date\">${ds}</div>`;
      if(isFuture){
        cellHtml += `<div class=\"pnl-total neutral\">—</div><div class=\"pnl-diff neutral\"></div>`;
      }else{
        const t = this.getTotalUSDTByDate(ds);
        const d = new Date(`${ds}T00:00:00`);
        const prev = new Date(d); prev.setDate(d.getDate()-1);
        const ps = this.dateToStrLocal(prev);
        const p = this.getTotalUSDTByDate(ps);
        const diff = t - p;
        const diffCls = diff>0?'positive':(diff<0?'negative':'neutral');
        const showVal = (t>0 || p>0) ? fmt(t) : '—';
        const showDiff = (t>0 || p>0) ? `${diff>=0?'+':''}${fmt(diff)}` : '';
        cellHtml += `<div class=\"pnl-total\">${showVal}</div><div class=\"pnl-diff ${diffCls}\">${showDiff}</div>`;
      }
      if(tdCount>0){
        cellHtml += `<div class=\"todo-badge\" title=\"当日待办(未完成)：${tdCount} 个\">${tdCount}</div>`;
      }
      cellHtml += `</div>`;
      cells.push(cellHtml);
    }
    grid.innerHTML = cells.join('');
    grid.querySelectorAll('.pnl-cell[data-date]').forEach(cell=>{
      cell.addEventListener('click', async ()=> { await this.openComposition(cell.getAttribute('data-date')); });
    });
  },

  // ===== Modal =====
  async openComposition(dateStr){
    byId('modalDate').textContent = dateStr;
    await this.ensureDayPrices(dateStr);
    const d = new Date(dateStr+'T00:00:00'); const prev = new Date(d); prev.setDate(d.getDate()-1);
    const prevStr = this.dateToStrLocal(prev); await this.ensureDayPrices(prevStr);

    const radios = document.querySelectorAll('input[name=\"groupMode\"]');
    radios.forEach(r=> r.checked = (r.value===this.groupMode) );
    radios.forEach(r=> r.onchange = ()=>{ this.groupMode = r.value; saveLS(LS_KEYS.groupMode, this.groupMode); this.renderGroups(dateStr); });

    this.renderGroups(dateStr);
    this.renderOps(dateStr);
    byId('modal').classList.add('show');
  },

  computeGroupTotals(dateStr, mode){
    const positions = this.buildPositionsUpTo(dateStr);
    const totals = {};
    if(mode==='ticker'){
      for(const p of positions){
        const key = (p.ticker || this.id2sym(p.assetId)).toUpperCase();
        const val = Math.max(0, Number(p.amount)||0) * this.getPriceForDateCached(p.assetId, dateStr);
        totals[key] = (totals[key]||0) + val;
      }
    }else{
      for(const p of positions){
        const key = p.name;
        const val = Math.max(0, Number(p.amount)||0) * this.getPriceForDateCached(p.assetId, dateStr);
        totals[key] = (totals[key]||0) + val;
      }
    }
    return totals;
  },

  subBreakdown(dateStr, mode, groupKey, rowKey){
    const list = this.assets.filter(x=> x.date<=dateStr);
    const pick = [];
    for(const a of list){
      const tk = (a.ticker || this.id2sym(a.assetId)).toUpperCase();
      const src = a.name;
      if(mode==='source'){
        if(src!==groupKey) continue;
        if(tk!==rowKey) continue;
      }else{
        if(tk!==groupKey) continue;
        if(src!==rowKey) continue;
      }
      pick.push(a);
    }
    const map = new Map();
    for(const a of pick){
      const sub = (a.sub && String(a.sub).trim()) || this.parseSubFromMemo(a.memo) || '未标记';
      const k = sub;
      const slot = map.get(k) || { sub, amount:0, value:0 };
      slot.amount += Number(a.amount)||0;
      const v = Math.max(0, Number(a.amount)||0) * this.getPriceForDateCached(a.assetId, dateStr);
      slot.value += v;
      map.set(k, slot);
    }
    const arr = [...map.values()].filter(x=> (x.amount||0)>0 );
    arr.sort((a,b)=> b.value - a.value);
    const total = arr.reduce((s,x)=> s+x.value, 0) || 1;
    arr.forEach(x=> x.ratio = x.value/total );
    return arr;
  },

  renderGroups(dateStr){
    const container = byId('modalPosGroups');
    const mode = this.groupMode;
    const d = new Date(dateStr+'T00:00:00'); const prev = new Date(d); prev.setDate(d.getDate()-1);
    const prevStr = this.dateToStrLocal(prev);
    const totalsCur = this.computeGroupTotals(dateStr, mode);
    const totalsPrev = this.computeGroupTotals(prevStr, mode);

    const keys = Object.keys(totalsCur).sort((a,b)=> (totalsCur[b]||0) - (totalsCur[a]||0));

    const positions = this.buildPositionsUpTo(dateStr);

    let totalAll = 0;
    const html = keys.map(key=>{
      const gt = totalsCur[key]||0; totalAll += gt;
      const prevVal = totalsPrev[key]||0;
      const diff = gt - prevVal;
      const diffCls = diff>0?'positive':(diff<0?'negative':'neutral');
      const diffText = diff===0? '' : `<span class="${diffCls}" style="margin-left:8px;font-weight:700">${diff>0?'+':''}${fmt(diff)}</span>`;
      const pct = (prevVal>0) ? (diff/prevVal*100) : 0;
      const pctText = (prevVal>0 && diff!==0) ? `<span class="${diffCls}" style="margin-left:6px;font-weight:700">(${diff>0?'+':''}${pct.toFixed(2)}%)</span>` : '';

      const rows = (mode==='source'
        ? positions.filter(p=> p.name===key).map(p=> ({ title:(p.ticker||this.id2sym(p.assetId)).toUpperCase(), id:p.assetId, amt:p.amount, val: Math.max(0,Number(p.amount)||0) * this.getPriceForDateCached(p.assetId, dateStr) }))
        : positions.filter(p=> (p.ticker||this.id2sym(p.assetId)).toUpperCase()===key).map(p=> ({ title:p.name, id:p.assetId, amt:p.amount, val: Math.max(0,Number(p.amount)||0) * this.getPriceForDateCached(p.assetId, dateStr) }))
      )
      .reduce((acc,it)=>{ const f=acc.find(x=>x.title===it.title); if(f){ f.amt+=it.amt; f.val+=it.val; } else acc.push({...it}); return acc; },[])
      .sort((a,b)=> b.val - a.val);

      const rowsHtml = rows.map(r=>{
        const rowKey = r.title;
        const subs = this.subBreakdown(dateStr, mode, key, rowKey);
        const subHtml = subs.length ? subs.map(s=>`<tr class="sub-row" data-sub="${s.sub||''}"><td class="tCenter"># ${esc(s.sub)}</td><td class="tCenter">${num(s.amount)}</td><td class="tCenter">${fmt(s.value)}</td><td class="tCenter">${(s.ratio*100).toFixed(1)}%</td></tr>`).join('')
                                   : `<tr class="sub-row" data-sub="${s.sub||''}"><td colspan="4" class="tCenter" style="color:var(--muted)">无子账户分布</td></tr>`;
        return `<tbody class="row-block"><tr class="row-head" data-mode="${mode}" data-group="${key}" data-row="${rowKey}"><td class="tCenter">${esc(r.title)}</td><td class="tCenter">${num(r.amt)}</td><td class="tCenter">${fmt(r.val)}</td><td class="tCenter"><span class="badge row-detail">明细</span> <span class="badge row-edit">编辑</span></td></tr>${subHtml}</tbody>`;
      }).join('') || `<tbody><tr><td colspan="4" class="tCenter" style="color:var(--muted)">当日无持仓</td></tr></tbody>`;

      const openKey = `${dateStr}|${key}|${mode}`;
      const openCls = this.modalOpenState[openKey] ? 'open' : '';
      return `<div class="group-card ${openCls}" data-key="${esc(openKey)}">
        <div class="group-head">
          <div class="group-title">${esc(key)}</div>
          <div class="group-total">${fmt(gt)}${diffText}${pctText}</div>
        </div>
        <div class="group-body">
          <table class="table centered">
            <thead><tr><th>资产</th><th>数量</th><th>价值</th><th>备注</th></tr></thead>
            ${rowsHtml}
          </table>
        </div>
      </div>`;
    }).join('');

    container.innerHTML = html || `<div style="color:var(--muted)">无持仓</div>`;
    // 统一事件委托，避免动态元素绑定失效
    if(!container.__delegated){
      container.addEventListener('click', (evt)=>{
        const detail = evt.target.closest('.row-detail');
        const editBadge = evt.target.closest('.row-edit');
        const subEdit = evt.target.closest('.btnSubEdit');
        // 点击“明细”：切换展开/折叠
        if(detail){ evt.stopPropagation();
          const tr = detail.closest('tr.row-head');
          if(tr){
            const block = tr.parentElement;
            const isOpen = block.classList.toggle('open');
            block.querySelectorAll('.sub-row').forEach(sr=> sr.style.display = isOpen? 'table-row':'none');
          }
          return;
        }
        // 点击“编辑”：展开并生成子行编辑按钮
        if(editBadge){ evt.stopPropagation();
          const tr = editBadge.closest('tr.row-head');
          if(tr){
            const block = tr.parentElement;
            block.classList.add('open');
            block.querySelectorAll('.sub-row').forEach(sr=> sr.style.display = 'table-row');
            block.querySelectorAll('tr.sub-row').forEach(sr => {
              if(!sr.querySelector('.btnSubEdit')){
                const td = document.createElement('td');
                td.className = 'tCenter';
                td.innerHTML = '<button class="btn btn-sm btnSubEdit">编辑</button>';
                sr.appendChild(td);
              }
            });
          }
          return;
        }
        // 子账户“编辑” -> 行内编辑
        if(subEdit){
          const sr = subEdit.closest('tr.sub-row');
          if(!sr) return;
          const block = sr.closest('tbody.row-block');
          const head = block.querySelector('tr.row-head');
          const mode = head.getAttribute('data-mode') || 'source';
          const groupKey = head.getAttribute('data-group') || '';
          const rowKey = head.getAttribute('data-row') || '';
          const sub = sr.getAttribute('data-sub') || '';
          if(sr.nextElementSibling && sr.nextElementSibling.classList.contains('inline-edit-row')){
            sr.nextElementSibling.remove();
          }
          let curAmt = 0;
          try{
            const amtCell = sr.querySelector('td:nth-child(3)') || sr.children[2];
            const raw = (amtCell?.textContent||'').replace(/,/g,'').trim();
            curAmt = Number(raw) || 0;
          }catch{}
          const editor = document.createElement('tr');
          editor.className = 'inline-edit-row';
          const td = document.createElement('td');
          td.colSpan = sr.children.length;
          td.innerHTML = `
            <div class="inline-editor">
              <span>目标数量（子账户：\${sub||'默认/空'}）：</span>
              <input type="number" step="0.00000001" class="inp-amt" value="\${curAmt}"/>
              <button class="btn btn-sm btnSaveSub">保存</button>
              <button class="btn btn-sm btnCancelSub">取消</button>
            </div>`;
          editor.appendChild(td);
          sr.after(editor);
          td.querySelector('.btnCancelSub').addEventListener('click', ()=> editor.remove());
          td.querySelector('.btnSaveSub').addEventListener('click', ()=> {
            const input = td.querySelector('.inp-amt');
            const nextAmt = Number(input.value);
            if(!isFinite(nextAmt)) { alert('数量无效'); return; }
            const delta = nextAmt - curAmt;
            if(delta === 0) { editor.remove(); return; }
            const sourceName = (mode==='source') ? groupKey : rowKey;
            const tickerSym = (mode==='source') ? rowKey : groupKey;
            const norm = normalizeAssetInput(String(tickerSym||'').toUpperCase(), {});
            this.addAsset({ date: dateStr, name: sourceName, assetId: norm.assetId, ticker: norm.ticker, amount: delta, memo: '[明细行内编辑-子账户]', sub }, true);
            this.updateSourceOptions?.();
            this.openComposition(dateStr);
            this.renderPnLMonth();
          });
        }
      });
      container.__delegated = true;
    }

    byId('modalTotal').textContent = fmt(totalAll);
    container.querySelectorAll('.group-card .group-head').forEach(head=>{
      head.addEventListener('click', ()=>{
        const card = head.parentElement;
        card.classList.toggle('open');
        const key = card.getAttribute('data-key');
        this.modalOpenState[key] = card.classList.contains('open');
        saveLS(LS_KEYS.modalState, this.modalOpenState);
      });
    });
    
    // 初始全部收起子明细
    container.querySelectorAll('.row-head').forEach(tr=>{
      const block = tr.parentElement;
      block.classList.remove('open');
      block.querySelectorAll('.sub-row').forEach(sr=> sr.style.display = 'none');
    });

    // 统一事件委托，处理“明细/编辑/子行编辑”
    if(!container.__delegated){
      container.addEventListener('click', (evt)=>{
        const detail = evt.target.closest('.row-detail');
        const editBadge = evt.target.closest('.row-edit');
        const subEdit = evt.target.closest('.btnSubEdit');

        if(detail){
          const tr = detail.closest('tr.row-head');
          if(tr){
            const block = tr.parentElement;
            const isOpen = block.classList.toggle('open');
            block.querySelectorAll('.sub-row').forEach(sr=> sr.style.display = isOpen? 'table-row':'none');
          }
          return;
        }
        if(editBadge){
          const tr = editBadge.closest('tr.row-head');
          if(tr){
            const block = tr.parentElement;
            block.classList.add('open');
            block.querySelectorAll('.sub-row').forEach(sr=> sr.style.display = 'table-row');
            block.querySelectorAll('tr.sub-row').forEach(sr => {
              if(!sr.querySelector('.btnSubEdit')){
                const td = document.createElement('td');
                td.className = 'tCenter';
                td.innerHTML = '<button class="btn btn-sm btnSubEdit">编辑</button>';
                sr.appendChild(td);
              }
            });
          }
          return;
        }
        if(subEdit){
          const sr = subEdit.closest('tr.sub-row');
          if(!sr) return;
          const block = sr.closest('tbody.row-block');
          const head = block.querySelector('tr.row-head');
          const mode = head.getAttribute('data-mode') || 'source';
          const groupKey = head.getAttribute('data-group') || '';
          const rowKey = head.getAttribute('data-row') || '';
          const sub = sr.getAttribute('data-sub') || '';
          if(sr.nextElementSibling && sr.nextElementSibling.classList.contains('inline-edit-row')){
            sr.nextElementSibling.remove();
          }
          let curAmt = 0;
          try{
            const amtCell = sr.querySelector('td:nth-child(3)') || sr.children[2];
            const raw = (amtCell?.textContent||'').replace(/,/g,'').trim();
            curAmt = Number(raw) || 0;
          }catch{}
          const editor = document.createElement('tr');
          editor.className = 'inline-edit-row';
          const td = document.createElement('td');
          td.colSpan = sr.children.length;
          td.innerHTML = `
            <div class="inline-editor">
              <span>目标数量（子账户：\${sub||'默认/空'}）：</span>
              <input type="number" step="0.00000001" class="inp-amt" value="\${curAmt}"/>
              <button class="btn btn-sm btnSaveSub">保存</button>
              <button class="btn btn-sm btnCancelSub">取消</button>
            </div>`;
          editor.appendChild(td);
          sr.after(editor);
          td.querySelector('.btnCancelSub').addEventListener('click', ()=> editor.remove());
          td.querySelector('.btnSaveSub').addEventListener('click', ()=> {
            const input = td.querySelector('.inp-amt');
            const nextAmt = Number(input.value);
            if(!isFinite(nextAmt)) { alert('数量无效'); return; }
            const delta = nextAmt - curAmt;
            if(delta === 0) { editor.remove(); return; }
            const sourceName = (mode==='source') ? groupKey : rowKey;
            const tickerSym = (mode==='source') ? rowKey : groupKey;
            const norm = normalizeAssetInput(String(tickerSym||'').toUpperCase(), {});
            this.addAsset({ date: dateStr, name: sourceName, assetId: norm.assetId, ticker: norm.ticker, amount: delta, memo: '[明细行内编辑-子账户]', sub }, true);
            this.updateSourceOptions?.();
            this.openComposition(dateStr);
            this.renderPnLMonth();
          });
        }
      });
      container.__delegated = true;
    }

  },

  renderOps(dateStr){
    const dayOps = this.assets.filter(a=>a.date===dateStr).sort((a,b)=>a.createdAt-b.createdAt);
    const tb = byId('modalOpsTable').querySelector('tbody');
    tb.innerHTML = dayOps.map((a,i)=> this.renderOpRow(a,i,dateStr,false) ).join('');
    tb.querySelectorAll('.btnEdit').forEach(btn=> btn.addEventListener('click', (e)=>{
      const id = e.target.closest('tr').dataset.id;
      const a = this.assets.find(x=>x.id===id); if(!a) return;
      e.target.closest('tr').outerHTML = this.renderOpRow(a, a._i || 0, dateStr, true);
      this.attachEditHandlers(dateStr);
    }));
    tb.querySelectorAll('.btnDel').forEach(btn=> btn.addEventListener('click', (e)=>{
      const id = e.target.closest('tr').dataset.id;
      if(confirm('确认删除该条记录？')){ this.deleteAsset(id); this.openComposition(dateStr); this.renderPnLMonth(); }
    }));
  },

  renderOpRow(a, idx, dateStr, editing){
    const tk = (a.ticker || this.id2sym(a.assetId)).toUpperCase();
    const val = Math.max(0, Number(a.amount)||0) * this.getPriceForDateCached(a.assetId, dateStr);
    if(!editing){
      const subTxt = a.sub? ` · 子账户：${esc(a.sub)}` : '';
      return `<tr data-id=\"${a.id}\"><td>${idx+1}</td><td>${esc(a.name)}</td><td>${esc(tk)}</td><td>${num(a.amount)}</td><td>${fmt(val)}</td><td>${esc(a.memo||'')}${subTxt}</td><td class=\"row-actions\"><button class=\"btn btnEdit\">编辑</button><button class=\"btn btnDel\">删除</button></td></tr>`;
    }else{
      return `<tr data-id=\"${a.id}\"><td>${idx+1}</td>
        <td><input class=\"op-name\" value=\"${esc(a.name)}\"/></td>
        <td><input class=\"op-ticker\" value=\"${esc(tk)}\"/></td>
        <td><input class=\"op-amount\" type=\"number\" step=\"any\" value=\"${a.amount}\"/></td>
        <td>${fmt(val)}</td>
        <td>
          <div style=\"display:grid;grid-template-columns:1fr;gap:6px\">
            <input class=\"op-memo\" value=\"${esc(a.memo||'')}\"/>
            <input class=\"op-sub\" list=\"subList\" placeholder=\"子账户（可选）\" value=\"${esc(a.sub||'')}\"/>
          </div>
        </td>
        <td class=\"row-actions\"><button class=\"btn btnSave\">保存</button><button class=\"btn btnCancel\">取消</button></td>
      </tr>`;
    }
  },
  attachEditHandlers(dateStr){
    const tb = byId('modalOpsTable').querySelector('tbody');
    tb.querySelectorAll('.btnSave').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        const tr = e.target.closest('tr');
        const id = tr.dataset.id;
        const name = tr.querySelector('.op-name').value.trim()||'Unknown';
        const ticker = tr.querySelector('.op-ticker').value.trim().toUpperCase();
        const amount = Number(tr.querySelector('.op-amount').value);
        const memo = tr.querySelector('.op-memo').value;
        const sub = (tr.querySelector('.op-sub')?.value||'').trim();
        if(!isFinite(amount)){ alert('数量无效'); return; }
        const norm = normalizeAssetInput(ticker, {});
        this.updateAsset(id, { name, assetId: norm.assetId, ticker: norm.ticker, amount, memo, sub });
        this.updateSourceOptions();
        this.openComposition(dateStr);
        this.renderPnLMonth();
      });
    });
    tb.querySelectorAll('.btnCancel').forEach(btn=> btn.addEventListener('click', ()=> this.openComposition(dateStr) ));
  },

  // ===== Search inputs =====
  bindSearchInputs(){
    const input = byId('assetTypeSearch');
    const dropdown = byId('assetTypeDropdown');
    const box = dropdown.querySelector('.asset-type-options');

    const renderOptions = (list)=>{
      if(!list.length){ box.innerHTML = `<div class="no-assets">未找到相关代币</div>`; return; }
      box.innerHTML = list.map(c=>`
        <div class="asset-type-option" data-id="${c.id}" data-symbol="${(c.symbol||'').toUpperCase()}" data-name="${c.name}" data-price="${c.price ?? ''}">
          <div><div class="coin-name">${c.name}</div><div class="coin-symbol">${(c.symbol||'').toUpperCase()}</div></div>
          <div class="coin-price">${c.price!=null?('$'+Number(c.price).toFixed(6)):'--'}</div>
        </div>
      `).join('');
      box.querySelectorAll('.asset-type-option').forEach(opt=>{
        opt.addEventListener('click', ()=>{
          const id = opt.getAttribute('data-id');
          const sym = opt.getAttribute('data-symbol');
          const price = Number(opt.getAttribute('data-price'));
          input.value = sym;
          input.dataset.coinId = id;
          input.dataset.coinSym = sym;
          if(isFinite(price) && price>0){
            this.priceCache[id] = { price, ts: Date.now() };
            saveLS(LS_KEYS.priceCache, this.priceCache);
            const today = this.todayCN();
            this.priceHist[id] = this.priceHist[id]||{};
            this.priceHist[id][today] = price;
            saveLS(LS_KEYS.priceHist, this.priceHist);
          }
          dropdown.classList.remove('show');
        });
      });
    };

    const showDefault = async ()=>{
      dropdown.classList.add('show');
      try{
        const ids = DEFAULT_SUGGESTIONS.map(c=>c.id).join(',');
        const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);
        let priced = DEFAULT_SUGGESTIONS.map(c=>({ ...c }));
        if(r.ok){
          const map = await r.json();
          priced = priced.map(c=> ({...c, price: map?.[c.id]?.usd ?? null }));
        }
        renderOptions(priced);
      }catch{
        renderOptions(DEFAULT_SUGGESTIONS);
      }
    };

    const handler = this.debounce(async ()=>{
      const q = input.value.trim();
      if(q.length<2){ dropdown.classList.remove('show'); return; }
      dropdown.classList.add('show');
      box.innerHTML = `<div class="search-loading">搜索中...</div>`;
      const list = await this.searchCoins(q);
      renderOptions(list);
    }, 300);

    input.addEventListener('input', handler);
    const openIfEmpty = ()=>{ if((input.value||'').trim().length===0) showDefault(); };
    input.addEventListener('focus', openIfEmpty);
    input.addEventListener('click', openIfEmpty);
    document.addEventListener('click', (e)=>{ if(!dropdown.contains(e.target) && e.target!==input) dropdown.classList.remove('show'); });
  },
  async searchCoins(query){
    const q = (query||'').trim();
    if(q.length < 2) return [];
    const timeout = (ms, p)=> Promise.race([p, new Promise((_,rej)=>setTimeout(()=>rej(new Error('TIMEOUT')), ms))]);
    const safeFetch = async (url)=>{
      try{
        const r = await timeout(6000, fetch(url, {headers:{'accept':'application/json'}}));
        if(!r.ok) throw new Error('HTTP '+r.status);
        return await r.json();
      }catch(e){ return null; }
    };
    // 1) Contract-address direct (EVM or Solana base58)
    const isEvm = /^0x[a-fA-F0-9]{40}$/.test(q);
    const isSol = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q);
    if(isEvm || isSol){
      const data = await safeFetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(q)}`);
      const pairs = data?.pairs||[];
      const uniq = new Map();
      for(const p of pairs){
        const t = (p.baseToken?.address?.toLowerCase()===q.toLowerCase() ? p.baseToken : p.quoteToken) || p.baseToken;
        if(!t) continue;
        const key = (t.address||t.symbol||t.name);
        if(!uniq.has(key)){
          uniq.set(key, {
            id: t.address || key,
            symbol: String(t.symbol||'').toUpperCase(),
            name: t.name || t.symbol || t.address,
            price: p.priceUsd ? Number(p.priceUsd) : null,
            chain: p.chainId || p.chain || null,
            address: t.address || null
          });
        }
      }
      const out = Array.from(uniq.values()).slice(0,10);
      if(out.length) return out;
    }
    // 2) CoinGecko (primary)
    try{
      const ge = await safeFetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`);
      const coins = ge?.coins||[];
      if(coins.length){
        const ids = coins.slice(0,10).map(c=>c.id).join(',');
        const pr = await safeFetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`);
        const priceMap = pr||{};
        const out = coins.slice(0,10).map(c=>({
          id: c.id,
          symbol: String(c.symbol||'').toUpperCase(),
          name: c.name,
          price: priceMap?.[c.id]?.usd ?? null
        }));
        if(out.length) return out;
      }
    }catch{}
    // 3) CoinPaprika
    try{
      const pa = await safeFetch(`https://api.coinpaprika.com/v1/search?q=${encodeURIComponent(q)}&c=currencies&limit=10`);
      const items = pa?.currencies || [];
      const out = [];
      for(const it of items.slice(0,10)){
        let price = null;
        const t = await safeFetch(`https://api.coinpaprika.com/v1/tickers/${encodeURIComponent(it.id)}?quotes=USD`);
        if(t?.quotes?.USD?.price!=null) price = Number(t.quotes.USD.price);
        out.push({ id: it.id, symbol: String(it.symbol||'').toUpperCase(), name: it.name, price });
      }
      if(out.length) return out;
    }catch{}
    // 4) CoinCap
    try{
      const cc = await safeFetch(`https://api.coincap.io/v2/assets?search=${encodeURIComponent(q)}`);
      const items = cc?.data||[];
      const out = items.slice(0,10).map(x=>({ id:x.id, symbol:String(x.symbol||'').toUpperCase(), name:x.name, price: x.priceUsd? Number(x.priceUsd): null }));
      if(out.length) return out;
    }catch{}
    // 5) Dexscreener textual
    try{
      const ds = await safeFetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`);
      const pairs = ds?.pairs||[];
      const uniq = new Map();
      for(const p of pairs){
        const t = p.baseToken || {};
        const key = t.address || t.symbol || t.name;
        if(!key) continue;
        if(!uniq.has(key)){
          uniq.set(key, {
            id: t.address || key,
            symbol: String(t.symbol||'').toUpperCase(),
            name: t.name || t.symbol || t.address,
            price: p.priceUsd ? Number(p.priceUsd) : null,
            chain: p.chainId || null,
            address: t.address || null
          });
        }
      }
      const out = Array.from(uniq.values()).slice(0,10);
      if(out.length) return out;
    }catch{}
    // 6) Jupiter token list (Sol)
    try{
      let tok = JSON.parse(localStorage.getItem('JUP_TOKENS')||'null');
      if(!tok || !Array.isArray(tok) || tok.length<100){
        tok = await safeFetch('https://token.jup.ag/all');
        if(Array.isArray(tok)) localStorage.setItem('JUP_TOKENS', JSON.stringify(tok));
      }
      const k = q.toLowerCase();
      const got = (tok||[]).filter(x=> String(x.symbol||'').toLowerCase().includes(k) || String(x.name||'').toLowerCase().includes(k)).slice(0,10);
      const out = got.map(x=>({ id: x.address, symbol: String(x.symbol||'').toUpperCase(), name: x.name||x.symbol, price: null, chain: 'solana', address: x.address }));
      if(out.length) return out;
    }catch{}
    // fallback: small local list
    const list = [
      { id:'bitcoin',symbol:'BTC',name:'Bitcoin' },
      { id:'ethereum',symbol:'ETH',name:'Ethereum' },
      { id:'solana',symbol:'SOL',name:'Solana' },
      { id:'tether',symbol:'USDT',name:'Tether' },
    ];
    const k = q.toLowerCase();
    return list.filter(c=>c.name.toLowerCase().includes(k)||c.symbol.toLowerCase().includes(k)).map(c=>({...c, price:null}));
  },

  },

  // ToDo helpers
  upsertTemplate(tpl){
    const i = this.todos.findIndex(x=>x.repeatDaily && x.title===tpl.title);
    if(i>=0) this.todos[i] = {...this.todos[i], ...tpl};
    else this.todos.push(tpl);
  },
  ensureInstanceForDate(tpl, dateStr){
    const exists = this.todos.some(x=>!x.repeatDaily && x.spawnFrom===tpl.id && (x.due||'').startsWith(dateStr));
    if(!exists){
      const due = `${dateStr}T${tpl.time||'09:00'}`;
      this.todos.push({ id: uid(), title: tpl.title, due, priority: tpl.priority||'normal', note: tpl.note||'', done:false, createdAt: Date.now(), spawnFrom: tpl.id });
      saveLS(LS_KEYS.todos, this.todos);
    }
  },
  spawnTodayInstancesForTemplates(){
    const today = this.todayCN();
    this.todos.filter(t=>t.repeatDaily).forEach(tpl=> this.ensureInstanceForDate(tpl, today) );
  },

  openTodoDetail(todo){
    byId('tdTitle').value = todo.title;
    byId('tdDue').value = todo.due || '';
    byId('tdPriority').value = todo.priority||'normal';
    byId('tdNote').value = todo.note||'';
    byId('todoModal').classList.add('show');
    const save = ()=>{
      todo.title = byId('tdTitle').value.trim()||todo.title;
      todo.due = byId('tdDue').value || null;
      todo.priority = byId('tdPriority').value || 'normal';
      todo.note = byId('tdNote').value || '';
      saveLS(LS_KEYS.todos, this.todos);
      this.renderTodos(); this.renderPnLMonth();
      byId('todoModal').classList.remove('show');
    };
    byId('tdSave').onclick = save;
  },

  renderTodos(){
    const list = this.todos.filter(t=>!t.repeatDaily && (!byId('hideDone') || !byId('hideDone').checked || !t.done))
      .sort((a,b)=>{
        if(a.done!==b.done) return a.done?1:-1;
        const ad = a.due? new Date(a.due).getTime(): Infinity;
        const bd = b.due? new Date(b.due).getTime(): Infinity;
        return ad - bd;
      });

    const ul = byId('todoList');
    ul.innerHTML = list.map(t=>{
      const dueTxt = t.due? new Date(t.due).toLocaleString() : '无截止';
      const prCls = t.priority==='high'?'high':(t.priority==='low'?'low':'normal');
      return `<li class=\"todo-item\" data-id=\"${t.id}\">
        <div class=\"todo-content\">
          <div class=\"todo-title ${t.done?'done':''}\">${esc(t.title)}</div>
          <div class=\"todo-meta\">${dueTxt}<span class=\"badge ${prCls}\">${t.priority||'normal'}</span></div>
        </div>
        <div class=\"todo-actions\">
          <button class=\"btn todo-detail\">详情</button>
          <button class=\"btn todo-done\">完成</button>
          <button class=\"btn todo-del\">删除</button>
        </div>
      </li>`;
    }).join('');

    ul.querySelectorAll('.todo-detail').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        const id = e.target.closest('.todo-item').getAttribute('data-id');
        const todo = this.todos.find(x=>x.id===id);
        if(todo) this.openTodoDetail(todo);
      });
    });
    ul.querySelectorAll('.todo-del').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        const id = e.target.closest('.todo-item').getAttribute('data-id');
        this.todos = this.todos.filter(x=>x.id!==id);
        saveLS(LS_KEYS.todos, this.todos);
        this.renderTodos(); this.renderPnLMonth();
      });
    });
    ul.querySelectorAll('.todo-done').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        const id = e.target.closest('.todo-item').getAttribute('data-id');
        const i = this.todos.findIndex(x=>x.id===id); if(i<0) return;
        this.todos[i].done = true;
        saveLS(LS_KEYS.todos, this.todos);
        this.renderTodos(); this.renderPnLMonth();
      });
    });
  },

  getEarliestDate(){
    if(this.assets.length===0) return this.todayCN();
    return this.assets.map(a=>a.date).sort()[0];
  },

  debounce(fn, wait){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a),wait);} },
};

const byId = id=>document.getElementById(id);
const esc = s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const num = n=>Number(n).toLocaleString('zh-CN',{maximumFractionDigits:8});
const fmt = n=>Number(n||0).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const sleep = ms=>new Promise(r=>setTimeout(r,ms));
const uid = ()=> Math.random().toString(36).slice(2) + Date.now().toString(36);
function saveLS(k, v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} }
function readLS(k, def){ try{ const s = localStorage.getItem(k); return s? JSON.parse(s): def; }catch{return def;} }
function downloadJSON(obj, name){
  const blob = new Blob([JSON.stringify(obj, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download=name; a.click();
  URL.revokeObjectURL(url);
}

window.App = App;
window.addEventListener('DOMContentLoaded', ()=>App.init());
