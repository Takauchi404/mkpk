
function t(key, ...args){
  const entry = I18N[lang][key];
  return typeof entry === 'function' ? entry(...args) : entry;
}

function applyStaticTranslations(){
  document.querySelectorAll('[data-i18n]').forEach(elm => {
    const key = elm.dataset.i18n;
    const val = I18N[lang][key];
    if (typeof val === 'string') elm.innerHTML = val;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(elm => {
    const key = elm.dataset.i18nPlaceholder;
    elm.placeholder = I18N[lang][key];
  });
  el('langBtnId').classList.toggle('active', lang === 'id');
  el('langBtnEn').classList.toggle('active', lang === 'en');
  el('langDropdownLabel').textContent = lang === 'id' ? 'Indonesia' : 'English';
  document.documentElement.lang = lang;
  if (typeof renderGuideSteps === 'function' && el('guideOverlay')?.classList.contains('show')) renderGuideSteps();
}

// ===========================================================================
// STATE
// ===========================================================================
let lang = localStorage.getItem('mkpk-lang') || 'id';
let saved = JSON.parse(localStorage.getItem('mkpk-saved-v3') || '[]');
// migrasi data lama yang belum punya field groupId eksplisit
saved.forEach(e => { if (!e.groupId) e.groupId = String(e.id).replace(/-\d+$/, ''); });
// urutan global groupId, dipakai buat panduan konversi manual ke Sipakamase
// (karena Sipakamase nggak nerima input SKS bebas, cuma "pilih mata kuliah -> serap sampai cap",
// urutan pemrosesan kegiatan & mata kuliah di dalamnya itu satu-satunya cara ngasilin hasil yang sama)
let savedOrder = JSON.parse(localStorage.getItem('mkpk-saved-order') || '[]');
// migrasi/sinkron: pastikan savedOrder mencakup semua groupId yang ada, hapus yang udah nggak ada lagi
(function syncSavedOrder(){
  const groupIdsInSaved = [...new Set(saved.map(e => e.groupId))];
  savedOrder = savedOrder.filter(gid => groupIdsInSaved.includes(gid));
  groupIdsInSaved.forEach(gid => { if (!savedOrder.includes(gid)) savedOrder.push(gid); });
})();
let coeffValues = {};
let tambahan = 0;
let tahapanLanjutValue = 0;
let nilaiValue = 100;
let excludedCourses = {};
let targetMode = localStorage.getItem('mkpk-target-mode') || 'kesehatan';
let customTarget = Number(localStorage.getItem('mkpk-target-custom') || 10);

// ===========================================================================
// ELEMENTS
// ===========================================================================
const el = (id) => document.getElementById(id);
const categorySelect = el('categorySelect');
const itemSearchInput = el('itemSearchInput');
const itemComboList = el('itemComboList');
const syaratText = el('syaratText');
const namaSpesifikInput = el('namaSpesifikInput');
const coeffGrid = el('coeffGrid');
const tambahanField = el('tambahanField'), tambahanLabel = el('tambahanLabel'), tambahanInput = el('tambahanInput');
const tahapanLanjutBox = el('tahapanLanjutBox'), tahapanLanjutCheck = el('tahapanLanjutCheck'), tahapanLanjutLabel = el('tahapanLanjutLabel'), tahapanLanjutValueEl = el('tahapanLanjutValue');
const tambahanChecklist = el('tambahanChecklist'), tambahanNote = el('tambahanNote'), tambahanSum = el('tambahanSum');
const nilaiVariableWrap = el('nilaiVariableWrap'), nilaiSelect = el('nilaiSelect');
const nilaiField = el('nilaiField');
const nilaiWeightedWrap = el('nilaiWeightedWrap'), nilaiWeightedResult = el('nilaiWeightedResult');
const docsText = el('docsText');
const metNote = el('metNote'), recoText = el('recoText');
const allocEmptyState = el('allocEmptyState'), allocList = el('allocList');
const pendingFitBox = el('pendingFitBox'), pendingFitText = el('pendingFitText'), pendingFitViewBtn = el('pendingFitViewBtn');
const allocTotal = el('allocTotal'), allocAvailable = el('allocAvailable'), allocWasted = el('allocWasted');
const resultValue = el('resultValue'), addBtn = el('addBtn');
const courseSummaryArea = el('courseSummaryArea');
const savedTitle = el('savedTitle'), tableArea = el('tableArea');
const resetSavedBtn = el('resetSavedBtn');
const guideLinkBtn = el('guideLinkBtn');
const statMet = el('statMet'), statMetOf = el('statMetOf'), statSKS = el('statSKS'), statSaved = el('statSaved');
const targetProgressBar = el('targetProgressBar'), targetDone = el('targetDone'), targetRemaining = el('targetRemaining');
const customTargetInput = el('customTargetInput');

let selectedItemName = null;

function currentItem(){
  const cat = categorySelect.value;
  const list = DATA.filter(d => d.cat === cat);
  return DATA.find(d => d.cat === cat && d.name === selectedItemName) || list[0];
}

function earnedByCourse(){
  const map = {};
  for (const e of saved) map[e.courseId] = (map[e.courseId] || 0) + e.sks;
  return map;
}

function eligibleCourses(item){ return item.mkpk.map(id => courseById(id)).filter(Boolean); }

function computeAutoAllocation(item, currentSKSVal){
  const earned = earnedByCourse();
  const candidates = eligibleCourses(item)
    .map(c => ({
      ...c,
      already: Math.round((earned[c.id] || 0) * 100) / 100,
      remainingNeed: Math.max(0, Math.round((c.sksRequired - (earned[c.id] || 0)) * 100) / 100),
    }))
    .filter(c => c.remainingNeed > 0 && !excludedCourses[c.id])
    .sort((a, b) => a.remainingNeed - b.remainingNeed || a.id - b.id);

  let leftover = Math.round(currentSKSVal * 100) / 100;
  const rows = [];
  for (const c of candidates){
    if (leftover <= 0) break;
    const amt = Math.round(Math.min(c.remainingNeed, leftover) * 100) / 100;
    if (amt > 0) rows.push({...c, allocated: amt});
    leftover = Math.round((leftover - amt) * 100) / 100;
  }
  return { rows, wasted: Math.max(0, leftover) };
}

function populateCategories(){
  categorySelect.innerHTML = CATEGORIES.map(c => `<option value="${c}">${c}</option>`).join('');
}
function populateItems(){
  const list = DATA.filter(d => d.cat === categorySelect.value);
  selectedItemName = list[0]?.name || null;
  itemSearchInput.value = selectedItemName || '';
}

// ---------- combobox pencarian kegiatan ----------
let comboHighlightIdx = -1;

function comboFilteredList(){
  const raw = itemSearchInput.value.trim();
  const list = DATA.filter(d => d.cat === categorySelect.value);
  // kalau isi input masih persis nama yang lagi kepilih (belum diketik ulang), tampilkan semua opsi
  if (!raw || raw === selectedItemName) return list;
  const query = raw.toLowerCase();
  return list.filter(d => d.name.toLowerCase().includes(query));
}

function renderComboList(){
  const list = comboFilteredList();
  if (list.length === 0){
    itemComboList.innerHTML = `<div class="combo-empty">${t('comboEmpty')}</div>`;
  } else {
    itemComboList.innerHTML = list.map((d, i) => `
      <div class="combo-option${d.name === selectedItemName ? ' selected' : ''}${i === comboHighlightIdx ? ' highlighted' : ''}" data-name="${d.name}" data-idx="${i}">${d.name}</div>
    `).join('');
    itemComboList.querySelectorAll('.combo-option').forEach(opt => {
      opt.addEventListener('mousedown', (e) => {
        e.preventDefault();
        chooseComboItem(opt.dataset.name);
      });
    });
  }
  itemComboList.style.display = 'block';
}

function chooseComboItem(name){
  selectedItemName = name;
  itemSearchInput.value = name;
  itemComboList.style.display = 'none';
  comboHighlightIdx = -1;
  renderItemDetails();
  renderAll();
}

itemSearchInput.addEventListener('focus', (e) => { comboHighlightIdx = -1; e.target.select(); renderComboList(); });
itemSearchInput.addEventListener('input', () => { comboHighlightIdx = -1; renderComboList(); });
itemSearchInput.addEventListener('blur', () => {
  setTimeout(() => {
    itemComboList.style.display = 'none';
    // kalau user ngetik tapi nggak pilih apa-apa, balikin ke nama yang lagi kepilih
    itemSearchInput.value = selectedItemName || '';
  }, 120);
});
itemSearchInput.addEventListener('keydown', (e) => {
  const list = comboFilteredList();
  if (e.key === 'ArrowDown'){ e.preventDefault(); comboHighlightIdx = Math.min(comboHighlightIdx + 1, list.length - 1); renderComboList(); }
  else if (e.key === 'ArrowUp'){ e.preventDefault(); comboHighlightIdx = Math.max(comboHighlightIdx - 1, 0); renderComboList(); }
  else if (e.key === 'Enter'){ e.preventDefault(); if (list[comboHighlightIdx]) chooseComboItem(list[comboHighlightIdx].name); else if (list[0]) chooseComboItem(list[0].name); }
  else if (e.key === 'Escape'){ itemComboList.style.display = 'none'; itemSearchInput.blur(); }
});

function updateTambahanFromChecklist(){
  const item = currentItem();
  if (!item || !Array.isArray(item.tambahanOptions)) return;
  const checked = [...tambahanChecklist.querySelectorAll('input[type=checkbox]:checked')];
  const rawSum = checked.reduce((s, cb) => s + Number(cb.dataset.value), 0);
  const capped = Math.min(item.tambahanMax, Math.round(rawSum * 100) / 100);
  tambahan = capped;
  tambahanSum.style.display = 'block';
  tambahanSum.textContent = t('tambahanSumTemplate', capped.toFixed(2), item.tambahanMax) + (rawSum > item.tambahanMax ? ' ' + t('tambahanCappedNote') : '');

  // sinkronisasi nilai: kalau ada opsi tercentang yang punya padanan nilai (nilaiSync),
  // otomatis pilihkan nilai tertinggi di antara opsi-opsi itu ke dropdown Estimasi Nilai
  if (Array.isArray(item.nilai)){
    const syncValues = checked
      .map(cb => cb.dataset.nilaiSync)
      .filter(v => v !== '')
      .map(Number);
    if (syncValues.length > 0){
      const best = Math.max(...syncValues);
      nilaiValue = best;
      nilaiSelect.value = best;
      nilaiSelect.classList.remove('needs-review');
    } else {
      // nggak ada opsi tercentang yang punya padanan nilai, balikin ke default terendah
      nilaiValue = lowestOption(item.nilai).value;
      nilaiSelect.value = nilaiValue;
      nilaiSelect.classList.toggle('needs-review', item.nilai.length > 1);
    }
  }

  renderAllocationAndResult();
}

function computeWeightedNilai(){
  const item = currentItem();
  if (!item || !Array.isArray(item.nilaiWeighted)) return;
  let weightedSum = 0;
  item.nilaiWeighted.forEach((tahap, idx) => {
    const sel = el(`nilaiTahap${idx}`);
    weightedSum += Number(sel.value) * tahap.weight;
  });
  nilaiValue = Math.round(weightedSum * 10) / 10;
  nilaiWeightedResult.textContent = t('nilaiWeightedResultTemplate', nilaiValue.toFixed(1));
  renderAllocationAndResult();
}

function renderItemDetails(){
  const item = currentItem();
  if (!item) return;
  syaratText.textContent = item.syarat;
  docsText.textContent = item.docs;

  // tahapan lanjut: bukan tambahan/prestasi, tapi soal sampai tahap mana prosesnya
  // (mempengaruhi total SKS langsung, tidak kena batas maksimal tambahan)
  tahapanLanjutValue = 0;
  tahapanLanjutCheck.checked = false;
  if (item.tahapanLanjut){
    tahapanLanjutBox.style.display = 'block';
    tahapanLanjutLabel.textContent = item.tahapanLanjut.label;
    tahapanLanjutValueEl.textContent = `+${item.tahapanLanjut.value.toFixed(2)} SKS`;
  } else {
    tahapanLanjutBox.style.display = 'none';
  }

  // coefficients
  coeffValues = {};
  coeffGrid.innerHTML = '';
  (item.coeff || []).forEach(g => {
    const defaultVal = lowestOption(g.options).value;
    coeffValues[g.key] = defaultVal;
    const needsReview = g.options.length > 1;
    const wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.innerHTML = `<label class="field-label">${g.label}</label>
      <div class="select-wrap">
        <select class="field-select${needsReview ? ' needs-review' : ''}" data-key="${g.key}">
          ${g.options.map(o => `<option value="${o.value}">${o.label} (×${o.value})</option>`).join('')}
        </select>
        <svg class="chevron" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>`;
    wrap.querySelector('select').value = defaultVal;
    wrap.querySelector('select').addEventListener('change', e => {
      coeffValues[g.key] = Number(e.target.value);
      e.target.classList.remove('needs-review');
      const hint = wrap.querySelector('.review-hint');
      if (hint) hint.remove();
      renderAllocationAndResult();
    });
    coeffGrid.appendChild(wrap);
  });
  coeffGrid.style.display = (item.coeff && item.coeff.length > 0) ? 'grid' : 'none';

  // nilai (field ini disembunyikan total kalau kegiatan nilainya flat 100, biar tidak jadi noise berulang)
  // catatan: blok ini HARUS jalan sebelum blok tambahan, karena updateTambahanFromChecklist()
  // butuh nilaiSelect sudah terisi opsi buat sinkronisasi nilai otomatis (nilaiSync)
  nilaiVariableWrap.style.display = 'none';
  nilaiWeightedWrap.style.display = 'none';
  nilaiWeightedResult.style.display = 'none';
  if (Array.isArray(item.nilaiWeighted)){
    // nilai berbobot multi-tahap (Magang/Studi Independen): satu dropdown per tahap, hasil akhir dihitung berbobot
    nilaiField.style.display = 'flex';
    nilaiWeightedWrap.style.display = 'flex';
    nilaiWeightedResult.style.display = 'block';
    nilaiWeightedWrap.innerHTML = item.nilaiWeighted.map((tahap, idx) => `
      <div class="nilai-weighted-row">
        <div class="nilai-weighted-label"><span>${tahap.label}</span><span class="nilai-weighted-weight">${(tahap.weight * 100).toFixed(0)}%</span></div>
        <div class="select-wrap">
          <select class="field-select needs-review" id="nilaiTahap${idx}" data-weight="${tahap.weight}">
            ${tahap.options.map(o => `<option value="${o.value}">${o.label} (${o.value})</option>`).join('')}
          </select>
          <svg class="chevron" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
        </div>
      </div>`).join('');
    item.nilaiWeighted.forEach((tahap, idx) => {
      const sel = el(`nilaiTahap${idx}`);
      sel.value = lowestOption(tahap.options).value;
      sel.addEventListener('change', (e) => { e.target.classList.remove('needs-review'); computeWeightedNilai(); });
    });
    computeWeightedNilai();
  } else if (Array.isArray(item.nilai)){
    nilaiField.style.display = 'flex';
    nilaiVariableWrap.style.display = 'block';
    nilaiSelect.innerHTML = item.nilai.map(n => `<option value="${n.value}">${n.label}: ${n.value}</option>`).join('');
    nilaiValue = lowestOption(item.nilai).value;
    nilaiSelect.value = nilaiValue;
    nilaiSelect.classList.toggle('needs-review', item.nilai.length > 1);
  } else {
    nilaiField.style.display = 'none';
    nilaiValue = 100;
  }

  // tambahan
  tambahan = 0; tambahanInput.value = 0;
  tambahanChecklist.innerHTML = '';
  if (item.tambahanMax > 0){
    tambahanField.style.display = 'flex';
    tambahanLabel.textContent = t('tambahanLabelTemplate', item.tambahanMax);
    tambahanInput.max = item.tambahanMax;

    if (Array.isArray(item.tambahanOptions)){
      tambahanInput.style.display = 'none';
      tambahanChecklist.style.display = 'flex';
      tambahanChecklist.innerHTML = item.tambahanOptions.map((opt, idx) => `
        <label class="tambahan-check-row">
          <input type="checkbox" data-value="${opt.value}" data-group="${opt.group || ''}" data-nilai-sync="${opt.nilaiSync ?? ''}" id="tambahanOpt${idx}" />
          <span class="tambahan-check-label">${opt.label}</span>
          <span class="tambahan-check-value">+${opt.value.toFixed(2)} SKS</span>
        </label>`).join('');
      tambahanChecklist.querySelectorAll('input[type=checkbox]').forEach(cb => {
        cb.addEventListener('change', (e) => {
          const group = e.target.dataset.group;
          // kalau checkbox ini bagian dari grup saling-eksklusif, matikan checkbox lain di grup yang sama
          if (group && e.target.checked){
            tambahanChecklist.querySelectorAll(`input[type=checkbox][data-group="${group}"]`).forEach(other => {
              if (other !== e.target) other.checked = false;
            });
          }
          updateTambahanFromChecklist();
        });
      });
      if (item.tambahanNote){
        tambahanNote.style.display = 'block';
        tambahanNote.textContent = item.tambahanNote;
      } else {
        tambahanNote.style.display = 'none';
      }
      updateTambahanFromChecklist();
    } else {
      tambahanInput.style.display = 'block';
      tambahanChecklist.style.display = 'none';
      tambahanNote.style.display = 'none';
      tambahanSum.style.display = 'none';
    }
  } else {
    tambahanField.style.display = 'none';
  }

  namaSpesifikInput.value = '';
  excludedCourses = {};

  renderAllocationAndResult();
}

function renderAllocationAndResult(){
  const item = currentItem();
  if (!item) return;
  const currentSKS = computeSKS(item, coeffValues, tambahan) + tahapanLanjutValue;
  resultValue.textContent = currentSKS.toFixed(2) + ' SKS';

  const earned = earnedByCourse();
  const elig = eligibleCourses(item);
  const alreadyMet = elig.filter(c => (earned[c.id] || 0) >= c.sksRequired);

  if (alreadyMet.length > 0){
    metNote.style.display = 'block';
    metNote.textContent = t('metNoteTemplate', alreadyMet.map(c => c.name).join(', '));
  } else {
    metNote.style.display = 'none';
  }

  const auto = computeAutoAllocation(item, currentSKS);

  if (auto.rows.length === 0){
    recoText.style.display = 'none';
    allocList.innerHTML = '';

    const pendingFit = currentSKS > 0 ? computePendingFit(item, currentSKS) : null;
    if (pendingFit){
      allocEmptyState.style.display = 'none';
      pendingFitBox.style.display = 'flex';
      pendingFitText.textContent = t('pendingFitTemplate', pendingFit.pendingRows.reduce((s,r)=>s+r.allocated,0).toFixed(2));
      addBtn._pendingFit = pendingFit;
    } else {
      allocEmptyState.style.display = 'block';
      pendingFitBox.style.display = 'none';
      addBtn._pendingFit = null;
    }
  } else {
    pendingFitBox.style.display = 'none';
    addBtn._pendingFit = null;
    allocEmptyState.style.display = 'none';
    recoText.style.display = 'block';
    const itemsHtml = auto.rows.map(r => `
      <div class="reco-item">
        <span class="reco-item-name">${r.name}</span>
        <span class="reco-item-amount">+${r.allocated.toFixed(2)} SKS</span>
      </div>`).join('');
    recoText.innerHTML = `
      <div class="reco-label">${t('recoLabel')}</div>
      <div class="reco-list">${itemsHtml}</div>`;

    allocList.innerHTML = elig.filter(c => (earned[c.id] || 0) < c.sksRequired).map(c => {
      const row = auto.rows.find(r => r.id === c.id);
      const already = Math.round((earned[c.id] || 0) * 100) / 100;
      const excluded = !!excludedCourses[c.id];
      return `<div class="alloc-row" style="opacity:${excluded ? 0.5 : 1}">
        <input type="checkbox" ${excluded ? '' : 'checked'} data-course="${c.id}" class="alloc-check" />
        <div class="alloc-name">${c.name}<span class="alloc-req">${t('allocSudah', already.toFixed(2), c.sksRequired)}</span></div>
        <div class="alloc-amount${row ? '' : ' empty'}">${row ? '+' + row.allocated.toFixed(2) + ' SKS' : '-'}</div>
      </div>`;
    }).join('');

    allocList.querySelectorAll('.alloc-check').forEach(cb => {
      cb.addEventListener('change', e => {
        const cid = Number(e.target.dataset.course);
        excludedCourses[cid] = !e.target.checked;
        renderAllocationAndResult();
      });
    });
  }

  const totalAllocated = Math.round(auto.rows.reduce((s, r) => s + r.allocated, 0) * 100) / 100;
  allocTotal.textContent = totalAllocated.toFixed(2);
  allocAvailable.textContent = currentSKS.toFixed(2);
  if (auto.wasted > 0){
    allocWasted.style.display = 'inline';
    allocWasted.textContent = t('allocWastedTemplate', auto.wasted.toFixed(2));
  } else {
    allocWasted.style.display = 'none';
  }

  addBtn.disabled = auto.rows.length === 0;
  addBtn._autoAllocation = auto;
  addBtn._currentSKS = currentSKS;
}

function persist(){
  localStorage.setItem('mkpk-saved-v3', JSON.stringify(saved));
  localStorage.setItem('mkpk-saved-order', JSON.stringify(savedOrder));
  localStorage.setItem('mkpk-target-mode', targetMode);
  localStorage.setItem('mkpk-target-custom', String(customTarget));
}

function addEntry(){
  const item = currentItem();
  const auto = addBtn._autoAllocation;
  if (!item || !auto || auto.rows.length === 0) return;

  const coeffLabelParts = (item.coeff || []).map(g => {
    const val = coeffValues[g.key] ?? lowestOption(g.options).value;
    const opt = g.options.find(o => o.value === val);
    return `${g.label}: ${opt ? opt.label : '-'} (×${val})`;
  });
  const groupId = Date.now() + '-' + Math.random().toString(36).slice(2,5);
  const namaSpesifik = namaSpesifikInput.value.trim();
  const groupTotalSKS = Math.round((addBtn._currentSKS || 0) * 100) / 100; // total SKS asli kegiatan ini, termasuk yang mungkin belum/tidak teralokasi

  auto.rows.forEach((r, idx) => {
    saved.push({
      id: `${groupId}-${idx}`,
      groupId,
      groupTotalSKS,
      category: item.cat,
      name: item.name,
      namaSpesifik,
      coeffLabel: coeffLabelParts.join(' · ') || '-',
      tambahan: Number(tambahan) || 0,
      sks: r.allocated,
      nilai: nilaiValue,
      docs: item.docs,
      courseId: r.id,
      courseName: r.name,
      courseRequired: r.sksRequired,
    });
  });
  savedOrder.push(groupId); // tambahkan ke urutan global, di posisi paling akhir

  persist();
  renderAll();
  showToast();
}

let toastTimer = null;
function showToast(message){
  const toast = el('toast');
  if (message) el('toastText').textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
    el('toastText').textContent = t('toastAdded'); // kembalikan ke pesan default
  }, 2800);
}

function removeGroup(groupId){
  saved = saved.filter(e => e.groupId !== groupId);
  savedOrder = savedOrder.filter(gid => gid !== groupId);
  persist();
  renderAll();
}

function computeCourseSummary(){
  const map = new Map();
  for (const e of saved){
    if (!map.has(e.courseId)) map.set(e.courseId, {id:e.courseId, name:e.courseName, required:e.courseRequired, earned:0, entries:[], nilaiWeighted:0});
    const c = map.get(e.courseId);
    c.earned += e.sks;
    c.nilaiWeighted += e.sks * (e.nilai ?? 100);
    c.entries.push(e);
  }
  return [...map.values()].map(c => {
    const earned = Math.round(c.earned * 100) / 100;
    const avgNilai = c.earned > 0 ? Math.round((c.nilaiWeighted / c.earned) * 10) / 10 : 0;
    return {...c, earned, met: earned >= c.required, avgNilai};
  }).sort((a,b) => a.id - b.id);
}

// ===========================================================================
// RE-OPTIMASI GLOBAL: hitung ulang alokasi lintas semua kegiatan tersimpan,
// coba maksimalkan jumlah mata kuliah yang selesai (bukan cuma per-kegiatan
// saat ditambahkan, tapi mempertimbangkan gabungan semua kegiatan sekaligus).
// ===========================================================================
function findDataItem(category, name){
  return DATA.find(d => d.cat === category && d.name === name);
}

// ===========================================================================
// SIMULASI ALOKASI MULTI-START
// Menjalankan heuristik alokasi dengan beberapa strategi urutan berbeda,
// lalu ambil hasil terbaik (paling banyak mata kuliah selesai, tiebreak SKS
// terbuang paling sedikit). Ini menutup celah kasus di mana strategi
// "paling terbatas duluan" doang bisa kelewatan kombinasi yang lebih baik.
// ===========================================================================
function simulateAllocation(groups, order){
  const simEarned = {};
  const newRowsByGroup = new Map();
  for (const g of order){
    const candidates = g.eligibleIds
      .map(id => courseById(id))
      .filter(Boolean)
      .map(c => ({ ...c, remainingNeed: Math.max(0, Math.round((c.sksRequired - (simEarned[c.id] || 0)) * 100) / 100) }))
      .filter(c => c.remainingNeed > 0)
      .sort((a, b) => a.remainingNeed - b.remainingNeed || a.id - b.id);

    let leftover = g.totalSKS;
    const rows = [];
    for (const c of candidates){
      if (leftover <= 0) break;
      const amt = Math.round(Math.min(c.remainingNeed, leftover) * 100) / 100;
      if (amt > 0){
        rows.push({ courseId: c.id, courseName: c.name, courseRequired: c.sksRequired, allocated: amt });
        simEarned[c.id] = Math.round(((simEarned[c.id] || 0) + amt) * 100) / 100;
      }
      leftover = Math.round((leftover - amt) * 100) / 100;
    }
    newRowsByGroup.set(g.groupId, rows);
  }
  const completedIds = new Set(Object.keys(simEarned).map(Number).filter(id => simEarned[id] >= courseById(id).sksRequired));
  const wastedTotal = groups.reduce((sum, g) => {
    const allocated = (newRowsByGroup.get(g.groupId) || []).reduce((s, r) => s + r.allocated, 0);
    return sum + Math.max(0, g.totalSKS - allocated);
  }, 0);
  return { simEarned, newRowsByGroup, completedIds, completedCount: completedIds.size, wastedTotal };
}

function bestMultiStartAllocation(groups){
  const strategies = [
    [...groups].sort((a, b) => a.eligibleIds.length - b.eligibleIds.length || a.firstSeenIdx - b.firstSeenIdx), // paling terbatas duluan
    [...groups].sort((a, b) => b.eligibleIds.length - a.eligibleIds.length || a.firstSeenIdx - b.firstSeenIdx), // paling fleksibel duluan
    [...groups].sort((a, b) => b.totalSKS - a.totalSKS), // SKS terbesar duluan
    [...groups].sort((a, b) => a.totalSKS - b.totalSKS), // SKS terkecil duluan
    [...groups].sort(() => Math.random() - 0.5), // acak 1
    [...groups].sort(() => Math.random() - 0.5), // acak 2
    [...groups].sort(() => Math.random() - 0.5), // acak 3
  ];
  let best = null;
  for (const order of strategies){
    const result = simulateAllocation(groups, order);
    if (!best || result.completedCount > best.completedCount ||
        (result.completedCount === best.completedCount && result.wastedTotal < best.wastedTotal)){
      best = { ...result, winningOrder: order.map(g => g.groupId) };
    }
  }
  return best;
}

function buildReoptGroupsFromSaved(){
  const groupsMap = new Map();
  saved.forEach((e, idx) => {
    if (!groupsMap.has(e.groupId)){
      groupsMap.set(e.groupId, {
        groupId: e.groupId, category: e.category, name: e.name, namaSpesifik: e.namaSpesifik,
        coeffLabel: e.coeffLabel, tambahan: e.tambahan, nilai: e.nilai, docs: e.docs,
        totalSKS: 0, allocatedSum: 0, firstSeenIdx: idx, currentRows: [],
      });
    }
    const g = groupsMap.get(e.groupId);
    g.totalSKS = e.groupTotalSKS != null ? e.groupTotalSKS : g.totalSKS;
    g.allocatedSum = Math.round((g.allocatedSum + e.sks) * 100) / 100;
    g.currentRows.push({ courseId: e.courseId, courseName: e.courseName, allocated: e.sks });
  });
  groupsMap.forEach(g => { if (!g.totalSKS) g.totalSKS = g.allocatedSum; });

  return [...groupsMap.values()].map(g => {
    const dataItem = findDataItem(g.category, g.name);
    const eligibleIds = dataItem ? dataItem.mkpk : [...new Set(g.currentRows.map(r => r.courseId))];
    return { ...g, eligibleIds };
  });
}

function computeGlobalReoptimization(){
  if (saved.length === 0) return null;

  const groups = buildReoptGroupsFromSaved();
  if (groups.some(g => !g.eligibleIds || g.eligibleIds.length === 0)) return null;

  const best = bestMultiStartAllocation(groups);
  const { newRowsByGroup, completedIds: newCompletedIds, completedCount: newCompletedCount } = best;

  const currentSummary = computeCourseSummary();
  const currentCompletedCount = currentSummary.filter(c => c.met).length;

  if (newCompletedCount <= currentCompletedCount) return null; // tidak ada perbaikan

  // deteksi kegiatan yang alokasinya benar-benar berubah
  const changedGroups = groups.filter(g => {
    const oldRows = g.currentRows.map(r => `${r.courseId}:${r.allocated}`).sort().join('|');
    const newRows = (newRowsByGroup.get(g.groupId) || []).map(r => `${r.courseId}:${r.allocated}`).sort().join('|');
    return oldRows !== newRows;
  }).map(g => ({ ...g, newRows: newRowsByGroup.get(g.groupId) || [] }));

  const newlyCompletedCourses = [...newCompletedIds]
    .filter(id => !currentSummary.some(c => c.id === id && c.met))
    .map(id => courseById(id).name);

  return { changedGroups, newlyCompletedCourses, currentCompletedCount, newCompletedCount, newRowsByGroup, groups, winningOrder: best.winningOrder };
}

// ===========================================================================
// CEK APAKAH KEGIATAN BARU (BELUM TERSIMPAN) BISA DAPAT SLOT
// LEWAT REALOKASI, WALAU SAAT INI SEMUA MATA KULIAH BERHAKNYA SUDAH PENUH
// ===========================================================================
function computePendingFit(item, currentSKSVal){
  const existingGroups = buildReoptGroupsFromSaved();
  const pendingGroupId = '__pending__';
  const pendingGroup = {
    groupId: pendingGroupId, category: item.cat, name: item.name, namaSpesifik: '',
    coeffLabel: '-', tambahan: 0, nilai: 100, docs: item.docs,
    totalSKS: Math.round(currentSKSVal * 100) / 100, allocatedSum: 0, firstSeenIdx: existingGroups.length, currentRows: [],
    eligibleIds: item.mkpk,
  };
  const groups = [...existingGroups, pendingGroup];
  if (groups.some(g => !g.eligibleIds || g.eligibleIds.length === 0)) return null;

  const best = bestMultiStartAllocation(groups);
  const pendingRows = best.newRowsByGroup.get(pendingGroupId) || [];
  if (pendingRows.length === 0) return null; // tetap nggak kebagian slot sama sekali, walau udah dicoba realokasi

  const currentSummary = computeCourseSummary();
  const currentCompletedCount = currentSummary.filter(c => c.met).length;

  return {
    pendingRows,
    newCompletedCount: best.completedCount,
    currentCompletedCount,
    newRowsByGroup: best.newRowsByGroup,
    groups: existingGroups, // cuma yang lama, buat ditampilkan "kegiatan mana yang perlu pindah"
    winningOrder: best.winningOrder, // termasuk pendingGroupId di dalamnya
    pendingGroupId,
  };
}

function renderCourseSummary(){
  const summary = computeCourseSummary();
  if (summary.length === 0){
    courseSummaryArea.innerHTML = `<div class="empty-state">${t('emptyCourseSummary')}</div>`;
  } else {
    courseSummaryArea.innerHTML = `<div class="course-list">${summary.map(c => `
      <div class="course-row">
        <div>${c.met ? '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#177A4C" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#C7CCD4" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>'}</div>
        <div style="flex:1">
          <div class="course-name">${c.name}</div>
          <div class="course-sub">${t('courseSubTemplate', c.entries.length)}</div>
        </div>
        <div class="course-sks"><span style="color:${c.met ? '#177A4C' : '#1B2131'}; font-weight:700">${c.earned.toFixed(2)}</span><span style="color:#71788A"> / ${c.required} SKS</span></div>
        <div class="badge ${c.met ? 'badge-success' : 'badge-pending'}">${c.met ? t('badgeMet', c.avgNilai.toFixed(1)) : t('badgePendingTemplate', (c.required - c.earned).toFixed(2))}</div>
      </div>`).join('')}</div>`;
  }
  return summary;
}

// ===========================================================================
// HALAMAN PANDUAN KONVERSI KE SIPAKAMASE
// ===========================================================================
function getGroupsInSavedOrder(){
  return savedOrder.map(groupId => {
    const entries = saved.filter(e => e.groupId === groupId); // urutan natural = urutan proses mata kuliah
    if (entries.length === 0) return null;
    const first = entries[0];
    const totalAllocated = Math.round(entries.reduce((s, e) => s + e.sks, 0) * 100) / 100;
    const groupTotalSKS = first.groupTotalSKS != null ? first.groupTotalSKS : totalAllocated;
    const wasted = Math.round((groupTotalSKS - totalAllocated) * 100) / 100;
    return {
      groupId, entries, category: first.category, name: first.name, namaSpesifik: first.namaSpesifik,
      totalAllocated, groupTotalSKS, wasted: wasted > 0.005 ? wasted : 0,
    };
  }).filter(Boolean);
}

function renderGuidePage(){
  const groups = getGroupsInSavedOrder();
  const content = el('guidePageContent');
  if (groups.length === 0){
    content.innerHTML = `<div class="empty-state">${t('guideEmptyState')}</div>`;
    return;
  }

  content.innerHTML = groups.map((g, gIdx) => {
    const headHtml = `
      <div class="guide-activity-head">
        <span class="guide-activity-name">${gIdx + 1}. ${g.name}</span>
        <span class="guide-activity-total">${t('guideTotalLabel')} ${g.groupTotalSKS.toFixed(2)} SKS</span>
      </div>
      ${g.namaSpesifik ? `<div class="guide-activity-spesifik">${g.namaSpesifik}</div>` : ''}`;

    // kegiatan yang cuma ke 1 mata kuliah: langsung selesai, ga perlu langkah bernomor
    if (g.entries.length === 1 && g.wasted === 0){
      const e = g.entries[0];
      return `<div class="guide-activity-card">${headHtml}
        <div class="guide-step-row" style="border-top:none; padding-top:12px;">
          <div class="guide-step-num">1</div>
          <div class="guide-step-body">
            <div class="guide-step-action">${t('guideStepPilih')} <b>${e.courseName}</b></div>
            <div class="guide-step-done">${t('guideStepDoneSingle', e.sks.toFixed(2))}</div>
          </div>
        </div>
      </div>`;
    }

    // kegiatan yang kepecah ke beberapa mata kuliah: langkah bernomor + catatan sisa di tiap langkah
    let running = g.groupTotalSKS;
    const stepsHtml = g.entries.map((e, idx) => {
      running = Math.round((running - e.sks) * 100) / 100;
      const isLast = idx === g.entries.length - 1;
      let noteHtml;
      if (!isLast){
        noteHtml = `<div class="guide-step-note">${t('guideStepRemainingNote', running.toFixed(2))}</div>`;
      } else if (running <= 0.005){
        noteHtml = `<div class="guide-step-done">${t('guideStepDoneAll')}</div>`;
      } else {
        noteHtml = ''; // sisa di langkah terakhir bakal ditulis sebagai guide-wasted-note di luar loop
      }
      return `<div class="guide-step-row">
        <div class="guide-step-num">${idx + 1}</div>
        <div class="guide-step-body">
          <div class="guide-step-action">${t('guideStepPilih')} <b>${e.courseName}</b></div>
          ${noteHtml}
        </div>
      </div>`;
    }).join('');

    const wastedHtml = g.wasted > 0
      ? `<div class="guide-wasted-note">${t('guideWastedNote', g.wasted.toFixed(2))}</div>`
      : '';

    return `<div class="guide-activity-card">${headHtml}${stepsHtml}${wastedHtml}</div>`;
  }).join('');
}

function switchPage(page){
  const isGuide = page === 'guide';
  el('pageCalculator').style.display = isGuide ? 'none' : 'block';
  el('pageGuide').style.display = isGuide ? 'block' : 'none';
  el('siteNavCalc').classList.toggle('active', !isGuide);
  el('siteNavGuide').classList.toggle('active', isGuide);
  if (isGuide) renderGuidePage();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function renderTable(){
  savedTitle.textContent = t('savedTitleTemplate', saved.length);
  resetSavedBtn.style.display = saved.length > 0 ? 'flex' : 'none';
  guideLinkBtn.style.display = saved.length > 0 ? 'flex' : 'none';
  if (saved.length === 0){
    tableArea.innerHTML = `<div class="empty-state">${t('emptyTable')}</div>`;
    return;
  }
  // kelompokkan per groupId, biar 1 kegiatan = 1 baris meski SKS-nya kepecah ke beberapa mata kuliah
  const groupsMap = new Map();
  saved.forEach(e => {
    if (!groupsMap.has(e.groupId)) groupsMap.set(e.groupId, { ...e, allocations: [] });
    groupsMap.get(e.groupId).allocations.push({ courseName: e.courseName, sks: e.sks });
  });

  const rows = [...groupsMap.values()].map(g => `
    <tr>
      <td>
        <div class="td-cat">${g.category}</div>
        <div class="td-name">${g.name}</div>
        ${g.namaSpesifik ? `<div class="td-spesifik">${g.namaSpesifik}</div>` : ''}
      </td>
      <td style="color:#4A5162">${g.coeffLabel}${g.tambahan > 0 ? `<div style="margin-top:2px">${t('tambahanExtra', g.tambahan.toFixed(2))}</div>` : ''}</td>
      <td style="font-weight:600; color:#1A2C56">
        ${g.allocations.map(a => `<div class="alloc-line">${a.courseName}</div>`).join('')}
      </td>
      <td style="text-align:right; font-variant-numeric:tabular-nums">
        ${g.allocations.map(a => `<div class="alloc-line"><span class="sks-pill">${a.sks.toFixed(2)}</span></div>`).join('')}
        ${g.allocations.length > 1 ? `<div class="alloc-total"><span class="sks-pill">${g.allocations.reduce((s,a)=>s+a.sks,0).toFixed(2)}</span></div>` : ''}
      </td>
      <td style="text-align:right; font-variant-numeric:tabular-nums; color:#4A5162">${g.nilai ?? 100}</td>
      <td style="color:#71788A; font-size:14px">${g.docs}</td>
      <td class="no-print">
        <div class="row-actions">
          <button class="row-icon-btn edit-btn" data-group="${g.groupId}" aria-label="${t('editLabel')}" title="${t('editLabel')}">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
          </button>
          <button class="row-icon-btn del-btn" data-group="${g.groupId}" aria-label="${t('hapusLabel')}" title="${t('hapusLabel')}">
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      </td>
    </tr>`).join('');
  tableArea.innerHTML = `<div class="table-wrap"><table>
    <thead><tr><th>${t('thKegiatan')}</th><th>${t('thCakupan')}</th><th>${t('thMataKuliah')}</th><th style="text-align:right">${t('thSKS')}</th><th style="text-align:right">${t('thNilai')}</th><th>${t('thDokumen')}</th><th class="no-print"></th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
  tableArea.querySelectorAll('.del-btn').forEach(btn => btn.addEventListener('click', () => removeGroup(btn.dataset.group)));
  tableArea.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', () => editGroup(btn.dataset.group)));
}

function editGroup(groupId){
  const groupEntries = saved.filter(e => e.groupId === groupId);
  if (groupEntries.length === 0) return;
  const first = groupEntries[0];

  saved = saved.filter(e => e.groupId !== groupId);
  persist();

  categorySelect.value = first.category;
  populateItems();
  selectedItemName = first.name;
  itemSearchInput.value = first.name;
  renderItemDetails();
  namaSpesifikInput.value = first.namaSpesifik || '';
  renderAll();

  document.getElementById('langkah-1').scrollIntoView({ behavior: 'smooth', block: 'start' });
  showToast(t('editToast'));
}

function renderStatsAndTarget(summary){
  const met = summary.filter(c => c.met);
  const totalRecognized = Math.round(met.reduce((s,c) => s + c.required, 0) * 100) / 100;

  statMet.childNodes[0].textContent = met.length;
  statMetOf.textContent = ` / ${summary.length}`;
  statSKS.textContent = totalRecognized.toFixed(2);
  statSaved.textContent = saved.length;

  const targetSKS = targetMode === 'kesehatan' ? 10 : targetMode === 'nonkesehatan' ? 20 : Math.max(0, customTarget);
  const pct = targetSKS > 0 ? Math.min(100, (totalRecognized / targetSKS) * 100) : 0;
  const remaining = Math.max(0, Math.round((targetSKS - totalRecognized) * 100) / 100);

  targetProgressBar.style.width = pct + '%';
  targetDone.textContent = t('targetDoneTemplate', totalRecognized.toFixed(2), targetSKS.toFixed(2));
  targetRemaining.textContent = remaining > 0 ? t('targetRemainingShort', remaining.toFixed(2)) : t('targetReached');

  // versi ringkas yang sama, buat ditampilkan di halaman Panduan Konversi
  el('statMetGuide').childNodes[0].textContent = met.length;
  el('statMetOfGuide').textContent = ` / ${summary.length}`;
  el('statSKSGuide').textContent = totalRecognized.toFixed(2);
  el('statSavedGuide').textContent = saved.length;
  const donutCircumference = 2 * Math.PI * 27;
  el('targetDonutRing').setAttribute('stroke-dasharray', `${(pct / 100 * donutCircumference).toFixed(1)} ${donutCircumference.toFixed(1)}`);
  el('targetDonutPct').textContent = `${Math.round(totalRecognized)}/${Math.round(targetSKS)}`;
}

let reoptDismissedFor = null; // signature saved[] terakhir kali banner ini di-dismiss

function savedSignature(){
  return saved.map(e => `${e.id}:${e.courseId}:${e.sks}`).sort().join('|');
}

function renderReoptBanner(){
  const banner = el('reoptBanner');
  const result = computeGlobalReoptimization();
  window._lastReoptResult = result;

  const sig = savedSignature();
  if (!result || sig === reoptDismissedFor){
    banner.style.display = 'none';
    return;
  }
  banner.style.display = 'flex';
  el('reoptBannerText').textContent = t('reoptBannerText', result.newlyCompletedCourses.length);
}

function openReoptOverlay(){
  const result = window._lastReoptResult;
  if (!result) return;

  el('reoptSummary').textContent = t(
    'reoptSummaryTemplate',
    result.currentCompletedCount,
    result.newCompletedCount,
    result.newlyCompletedCourses.join(', ')
  );

  el('reoptChanges').innerHTML = result.changedGroups.map(g => {
    const oldPath = g.currentRows.map(r => `${r.courseName} (+${r.allocated.toFixed(2)})`).join(', ');
    const newPath = g.newRows.map(r => `${r.courseName} (+${r.allocated.toFixed(2)})`).join(', ');
    return `<div class="reopt-change-row">
      <div class="reopt-change-name">${g.name}${g.namaSpesifik ? ` &middot; <span style="font-style:italic; font-weight:400;">${g.namaSpesifik}</span>` : ''}</div>
      <div class="reopt-change-path">
        <span class="reopt-change-old">${oldPath}</span>
        <span>&rarr; ${t('reoptChangeArrow')}</span>
        <span class="reopt-change-new">${newPath}</span>
      </div>
    </div>`;
  }).join('');

  el('reoptOverlay').classList.add('show');
}
function closeReoptOverlay(){ el('reoptOverlay').classList.remove('show'); }

function applyReoptimization(){
  const result = window._lastReoptResult;
  if (!result) return;

  const newSaved = [];
  result.groups.forEach(g => {
    const rows = result.newRowsByGroup.get(g.groupId) || [];
    rows.forEach((r, idx) => {
      newSaved.push({
        id: `${g.groupId}-${idx}`,
        groupId: g.groupId,
        category: g.category,
        name: g.name,
        namaSpesifik: g.namaSpesifik,
        coeffLabel: g.coeffLabel,
        tambahan: g.tambahan,
        sks: r.allocated,
        nilai: g.nilai,
        docs: g.docs,
        courseId: r.courseId,
        courseName: r.courseName,
        courseRequired: r.courseRequired,
      });
    });
  });

  saved = newSaved;
  savedOrder = result.winningOrder; // urutan global ikut tersimpan sesuai strategi yang menang
  persist();
  closeReoptOverlay();
  renderAll();
  showToast(t('reoptAppliedToast'));
}

function openPendingFitOverlay(){
  const pendingFit = addBtn._pendingFit;
  if (!pendingFit) return;

  const totalRequested = pendingFit.pendingRows.reduce((s, r) => s + r.allocated, 0);
  el('pendingFitSummary').textContent = t('pendingFitSummaryTemplate', totalRequested.toFixed(2), (addBtn._currentSKS || 0).toFixed(2));

  const changedGroups = pendingFit.groups.filter(g => {
    const oldRows = g.currentRows.map(r => `${r.courseId}:${r.allocated}`).sort().join('|');
    const newRows = (pendingFit.newRowsByGroup.get(g.groupId) || []).map(r => `${r.courseId}:${r.allocated}`).sort().join('|');
    return oldRows !== newRows;
  });

  const pendingRowsHtml = `<div class="reopt-change-row" style="border-color:var(--blue)">
    <div class="reopt-change-name">${t('pendingFitNewActivity')}</div>
    <div class="reopt-change-path">
      <span class="reopt-change-new">${pendingFit.pendingRows.map(r => `${r.courseName} (+${r.allocated.toFixed(2)})`).join(', ')}</span>
    </div>
  </div>`;

  const changedRowsHtml = changedGroups.map(g => {
    const oldPath = g.currentRows.map(r => `${r.courseName} (+${r.allocated.toFixed(2)})`).join(', ');
    const newRows = pendingFit.newRowsByGroup.get(g.groupId) || [];
    const newPath = newRows.map(r => `${r.courseName} (+${r.allocated.toFixed(2)})`).join(', ');
    return `<div class="reopt-change-row">
      <div class="reopt-change-name">${g.name}${g.namaSpesifik ? ` &middot; <span style="font-style:italic; font-weight:400;">${g.namaSpesifik}</span>` : ''}</div>
      <div class="reopt-change-path">
        <span class="reopt-change-old">${oldPath}</span>
        <span>&rarr; ${t('reoptChangeArrow')}</span>
        <span class="reopt-change-new">${newPath}</span>
      </div>
    </div>`;
  }).join('');

  el('pendingFitChanges').innerHTML = pendingRowsHtml + changedRowsHtml;
  el('pendingFitOverlay').classList.add('show');
}
function closePendingFitOverlay(){ el('pendingFitOverlay').classList.remove('show'); }

function applyPendingFit(){
  const pendingFit = addBtn._pendingFit;
  const item = currentItem();
  if (!pendingFit || !item) return;

  // realokasi seluruh kegiatan yang sudah tersimpan sesuai hasil simulasi
  const newSaved = [];
  pendingFit.groups.forEach(g => {
    const rows = pendingFit.newRowsByGroup.get(g.groupId) || [];
    rows.forEach((r, idx) => {
      newSaved.push({
        id: `${g.groupId}-${idx}`, groupId: g.groupId, category: g.category, name: g.name,
        namaSpesifik: g.namaSpesifik, coeffLabel: g.coeffLabel, tambahan: g.tambahan,
        sks: r.allocated, nilai: g.nilai, docs: g.docs,
        courseId: r.courseId, courseName: r.courseName, courseRequired: r.courseRequired,
      });
    });
  });

  // sekaligus tambahkan kegiatan baru yang mau disimpan, pakai alokasi yang sudah dipastikan bisa dari simulasi
  const coeffLabelParts = (item.coeff || []).map(g => {
    const val = coeffValues[g.key] ?? lowestOption(g.options).value;
    const opt = g.options.find(o => o.value === val);
    return `${g.label}: ${opt ? opt.label : '-'} (×${val})`;
  });
  const newGroupId = Date.now() + '-' + Math.random().toString(36).slice(2,5);
  const namaSpesifik = namaSpesifikInput.value.trim();
  const groupTotalSKS = Math.round((addBtn._currentSKS || 0) * 100) / 100;
  pendingFit.pendingRows.forEach((r, idx) => {
    newSaved.push({
      id: `${newGroupId}-${idx}`, groupId: newGroupId, groupTotalSKS,
      category: item.cat, name: item.name, namaSpesifik,
      coeffLabel: coeffLabelParts.join(' · ') || '-', tambahan: Number(tambahan) || 0,
      sks: r.allocated, nilai: nilaiValue, docs: item.docs,
      courseId: r.courseId, courseName: r.courseName, courseRequired: r.courseRequired,
    });
  });

  saved = newSaved;
  // urutan global: ambil dari hasil simulasi, ganti id sementara '__pending__' jadi groupId asli yang baru dibuat
  savedOrder = pendingFit.winningOrder.map(gid => gid === pendingFit.pendingGroupId ? newGroupId : gid);
  persist();
  closePendingFitOverlay();
  renderAll();
  showToast(t('reoptAppliedToast'));
}

function renderPrintReport(){
  const summary = computeCourseSummary();
  const met = summary.filter(c => c.met);
  const totalRecognized = Math.round(met.reduce((s,c) => s + c.required, 0) * 100) / 100;
  const targetSKS = targetMode === 'kesehatan' ? 10 : targetMode === 'nonkesehatan' ? 20 : Math.max(0, customTarget);
  const targetLabel = targetMode === 'kesehatan' ? t('targetKesehatan') : targetMode === 'nonkesehatan' ? t('targetNonKesehatan') : t('targetCustom');

  const now = new Date();
  const dateStr = now.toLocaleDateString(lang === 'id' ? 'id-ID' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  const courseRows = summary.length === 0
    ? `<tr><td colspan="4" class="pr-empty">${t('prEmptyCourses')}</td></tr>`
    : summary.map(c => `
      <tr>
        <td>${c.name}</td>
        <td>${c.earned.toFixed(2)}</td>
        <td>${c.required}</td>
        <td class="${c.met ? 'pr-status-met' : 'pr-status-pending'}">${c.met ? t('prMet') : t('prPending')}</td>
      </tr>`).join('');

  const savedGroupsMap = new Map();
  saved.forEach(e => {
    if (!savedGroupsMap.has(e.groupId)) savedGroupsMap.set(e.groupId, { ...e, allocations: [] });
    savedGroupsMap.get(e.groupId).allocations.push({ courseName: e.courseName, sks: e.sks });
  });
  const savedRows = saved.length === 0
    ? `<tr><td colspan="5" class="pr-empty">${t('prEmptySaved')}</td></tr>`
    : [...savedGroupsMap.values()].map(g => `
      <tr>
        <td>${g.name}${g.namaSpesifik ? `<br><span style="color:var(--faint); font-style:italic; font-size:10.5px;">${g.namaSpesifik}</span>` : ''}</td>
        <td>${g.allocations.map(a => `<div style="padding:2px 0;">${a.courseName}</div>`).join('')}</td>
        <td>${g.allocations.map(a => `<div style="padding:2px 0;">${a.sks.toFixed(2)}</div>`).join('')}${g.allocations.length > 1 ? `<div style="border-top:1px solid var(--border); margin-top:3px; padding-top:3px; font-weight:700;">${g.allocations.reduce((s,a)=>s+a.sks,0).toFixed(2)}</div>` : ''}</td>
        <td>${g.nilai ?? 100}</td>
        <td style="font-size:10.5px; color:var(--muted);">${g.docs}</td>
      </tr>`).join('');

  el('printReport').innerHTML = `
    <div class="pr-page">
      <div class="pr-header">
        <div>
          <div class="pr-doc-label">${t('prDocLabel')}</div>
          <h1 class="pr-title">${t('prTitle')}</h1>
        </div>
        <div class="pr-meta"><b>${t('prPrintedOn')}</b> ${dateStr}<br>${t('prSource')}</div>
      </div>
      <hr class="pr-rule" />
      <hr class="pr-rule-thin" />

      <div class="pr-info-grid">
        <div class="pr-info-item">
          <div class="pr-info-label">${t('prStatSKS')}</div>
          <div class="pr-info-value">${totalRecognized.toFixed(2)}</div>
        </div>
        <div class="pr-info-item">
          <div class="pr-info-label">${t('prStatMet')}</div>
          <div class="pr-info-value">${met.length} / ${summary.length}</div>
        </div>
        <div class="pr-info-item">
          <div class="pr-info-label">${t('prStatTarget')} &middot; ${targetLabel}</div>
          <div class="pr-info-value">${totalRecognized.toFixed(2)} / ${targetSKS.toFixed(2)}</div>
        </div>
      </div>

      <div class="pr-section-title">${t('prCourseStatusTitle')}</div>
      <table class="pr-table">
        <thead><tr><th>${t('prColMataKuliah')}</th><th>${t('prColSKS')}</th><th>${t('prColKebutuhan')}</th><th>${t('prColStatus')}</th></tr></thead>
        <tbody>${courseRows}</tbody>
      </table>

      <div class="pr-section-title">${t('prSavedTitle')}</div>
      <table class="pr-table">
        <thead><tr><th>${t('prColKegiatan')}</th><th>${t('prColTujuan')}</th><th>${t('prColSKS')}</th><th>${t('prColNilai')}</th><th>${t('thDokumen')}</th></tr></thead>
        <tbody>${savedRows}</tbody>
      </table>

      <div class="pr-footer">${t('prDisclaimer')}</div>
    </div>`;
}

function renderAll(){
  const summary = renderCourseSummary();
  renderTable();
  renderStatsAndTarget(summary);
  renderAllocationAndResult();
  renderReoptBanner();
  renderPrintReport();
}

// ===========================================================================
// EVENTS
// ===========================================================================
categorySelect.addEventListener('change', () => { populateItems(); renderItemDetails(); renderAll(); });
nilaiSelect.addEventListener('change', e => { nilaiValue = Number(e.target.value); e.target.classList.remove('needs-review'); });
tahapanLanjutCheck.addEventListener('change', (e) => {
  const item = currentItem();
  tahapanLanjutValue = (e.target.checked && item.tahapanLanjut) ? item.tahapanLanjut.value : 0;
  renderAllocationAndResult();
});
tambahanInput.addEventListener('input', e => {
  const item = currentItem();
  let v = Number(e.target.value) || 0;
  if (item) v = Math.min(item.tambahanMax, Math.max(0, v));
  tambahan = v; e.target.value = v;
  renderAllocationAndResult();
});
addBtn.addEventListener('click', addEntry);

document.getElementById('identifyToggle').addEventListener('click', () => {
  const panel = el('identifyPanel');
  const btn = el('identifyToggle');
  const show = !panel.classList.contains('show');
  panel.classList.toggle('show', show);
  btn.classList.toggle('open', show);
});
el('footerIdentifyBtn').addEventListener('click', () => {
  el('identifyPanel').classList.add('show');
  el('identifyToggle').classList.add('open');
  window.scrollTo({top:0, behavior:'smooth'});
});

el('reoptBannerBtn').addEventListener('click', openReoptOverlay);
el('reoptBannerDismiss').addEventListener('click', () => {
  reoptDismissedFor = savedSignature();
  el('reoptBanner').style.display = 'none';
});
el('reoptOverlayClose').addEventListener('click', closeReoptOverlay);
el('reoptCancelBtn').addEventListener('click', closeReoptOverlay);
el('reoptOverlay').addEventListener('click', (e) => { if (e.target.id === 'reoptOverlay') closeReoptOverlay(); });
el('reoptApplyBtn').addEventListener('click', applyReoptimization);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeReoptOverlay(); });

pendingFitViewBtn.addEventListener('click', openPendingFitOverlay);
el('pendingFitOverlayClose').addEventListener('click', closePendingFitOverlay);
el('pendingFitCancelBtn').addEventListener('click', closePendingFitOverlay);
el('pendingFitOverlay').addEventListener('click', (e) => { if (e.target.id === 'pendingFitOverlay') closePendingFitOverlay(); });
el('pendingFitApplyBtn').addEventListener('click', applyPendingFit);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePendingFitOverlay(); });

function renderGuideSteps(){
  const steps = I18N[lang].guideSteps || [];
  el('guideSteps').innerHTML = steps.map((s, i) => `
    <div class="guide-step">
      <span class="onb-step-num">${i + 1}</span>
      <span class="guide-step-text">${s}</span>
    </div>`).join('');
}
function openGuideOverlay(){ renderGuideSteps(); el('guideOverlay').classList.add('show'); }
function closeGuideOverlay(){ el('guideOverlay').classList.remove('show'); }
el('guideBtn').addEventListener('click', openGuideOverlay);
el('guideOverlayClose').addEventListener('click', closeGuideOverlay);
el('guideOverlay').addEventListener('click', (e) => { if (e.target.id === 'guideOverlay') closeGuideOverlay(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeGuideOverlay(); });

['btnKesehatan','btnNonKesehatan','btnCustom'].forEach(id => {
  el(id).addEventListener('click', (e) => {
    targetMode = e.currentTarget.dataset.mode;
    document.querySelectorAll('.target-mode-btn').forEach(b => b.classList.remove('active'));
    e.currentTarget.classList.add('active');
    customTargetInput.style.display = targetMode === 'custom' ? 'inline-block' : 'none';
    persist();
    renderStatsAndTarget(computeCourseSummary());
  });
});
customTargetInput.addEventListener('input', e => {
  customTarget = Number(e.target.value) || 0;
  persist();
  renderStatsAndTarget(computeCourseSummary());
});

function refreshDynamicLabels(){
  // teks-teks ini dinamis dari kamus terjemahan (bukan dari DATA), jadi perlu di-refresh
  // manual pas ganti bahasa — tapi TANPA reset pilihan user (beda dari renderItemDetails penuh)
  const item = currentItem();
  if (!item) return;
  if (item.tambahanMax > 0) tambahanLabel.textContent = t('tambahanLabelTemplate', item.tambahanMax);
  if (Array.isArray(item.tambahanOptions)) updateTambahanFromChecklist();
  if (Array.isArray(item.nilaiWeighted)) computeWeightedNilai();
}

function switchLang(newLang){
  if (newLang === lang) return;
  lang = newLang;
  localStorage.setItem('mkpk-lang', lang);
  applyStaticTranslations();
  renderAll();
  refreshDynamicLabels();
  if (el('pageGuide').style.display !== 'none') renderGuidePage();
}
function closeLangDropdown(){
  el('langDropdownMenu').style.display = 'none';
  el('langDropdownBtn').setAttribute('aria-expanded', 'false');
}
el('langDropdownBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = el('langDropdownMenu');
  const isOpen = menu.style.display === 'block';
  menu.style.display = isOpen ? 'none' : 'block';
  el('langDropdownBtn').setAttribute('aria-expanded', String(!isOpen));
});
el('langBtnId').addEventListener('click', () => { switchLang('id'); closeLangDropdown(); });
el('langBtnEn').addEventListener('click', () => { switchLang('en'); closeLangDropdown(); });
document.addEventListener('click', (e) => { if (!e.target.closest('.lang-dropdown')) closeLangDropdown(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLangDropdown(); });

resetSavedBtn.addEventListener('click', () => {
  if (saved.length === 0) return;
  if (confirm(t('resetConfirm'))){
    saved = [];
    savedOrder = [];
    persist();
    renderAll();
    showToast(t('resetToast'));
  }
});

el('siteNavCalc').addEventListener('click', () => switchPage('calculator'));
el('siteNavGuide').addEventListener('click', () => switchPage('guide'));
guideLinkBtn.addEventListener('click', () => switchPage('guide'));

// ===========================================================================
// INIT
// ===========================================================================
applyStaticTranslations();
populateCategories();
populateItems();
if (targetMode === 'custom'){
  document.querySelectorAll('.target-mode-btn').forEach(b => b.classList.remove('active'));
  el('btnCustom').classList.add('active');
  customTargetInput.style.display = 'inline-block';
  customTargetInput.value = customTarget;
} else if (targetMode === 'nonkesehatan'){
  document.querySelectorAll('.target-mode-btn').forEach(b => b.classList.remove('active'));
  el('btnNonKesehatan').classList.add('active');
}
renderItemDetails();
renderAll();
window.addEventListener('beforeprint', renderPrintReport);
