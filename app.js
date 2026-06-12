// ============================================================
//  PONTO DIGITAL — app.js
// ============================================================

// ── Estado global ────────────────────────────────────────
const state = {
  apiUrl:       "",
  config:       { HorasDiarias: "8", Colaboradores: "", ToleranciaMinutos: "10" },
  colaboradores: [],
  colaborador:  "",
  registros:    [],       // todos carregados do sheet
  todayRecord:  null,     // registro do dia atual
  editingId:    null,     // ID em edição no modal
  relatorioData: [],      // dados do relatório em memória
};

// ── Init ─────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  loadLocalConfig();
  initClock();
  initNavigation();
  initFormListeners();
  setDefaultDates();
  if (state.apiUrl) {
    loadConfig().then(() => {
      populateColaboradores();
      loadDashboard();
    });
  } else {
    populateColaboradores();
    showToast("Configure a URL do Google Apps Script em Configurações", "info");
    navigateTo("config");
  }
});

// ── Config local (localStorage) ──────────────────────────
function loadLocalConfig() {
  try {
    state.apiUrl = localStorage.getItem("apiUrl") || "";
    const lc = localStorage.getItem("localConfig");
    if (lc) Object.assign(state.config, JSON.parse(lc));
    const colabs = state.config.Colaboradores;
    state.colaboradores = colabs
      ? colabs.split(",").map(s => s.trim()).filter(Boolean)
      : [];
    state.colaborador = localStorage.getItem("colaboradorSelecionado") || state.colaboradores[0] || "";
  } catch(_) {}
}

function saveLocalConfig() {
  localStorage.setItem("apiUrl", state.apiUrl);
  localStorage.setItem("localConfig", JSON.stringify(state.config));
}

// ── Relógio ───────────────────────────────────────────────
function initClock() {
  const tick = () => {
    const now = new Date();
    document.getElementById("clock-display").textContent =
      now.toLocaleTimeString("pt-BR");
    document.getElementById("date-display").textContent =
      now.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
  };
  tick();
  setInterval(tick, 1000);
}

// ── Navegação ─────────────────────────────────────────────
function initNavigation() {
  document.querySelectorAll(".nav-item").forEach(el => {
    el.addEventListener("click", e => {
      e.preventDefault();
      navigateTo(el.dataset.view);
      document.getElementById("sidebar").classList.remove("open");
    });
  });

  document.getElementById("menuToggle").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
  });

  document.getElementById("colaboradorSelect").addEventListener("change", e => {
    state.colaborador = e.target.value;
    localStorage.setItem("colaboradorSelecionado", state.colaborador);
    loadDashboard();
  });
}

function navigateTo(view) {
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  const el = document.getElementById("view-" + view);
  if (el) el.classList.add("active");
  const nav = document.querySelector(`.nav-item[data-view="${view}"]`);
  if (nav) nav.classList.add("active");

  const titles = {
    dashboard: "Dashboard", registrar: "Registrar Ponto",
    historico: "Histórico", relatorio: "Relatório / Banco de Horas",
    config: "Configurações"
  };
  document.getElementById("topbar-title").textContent = titles[view] || view;

  if (view === "historico") carregarHistorico();
  if (view === "relatorio") gerarRelatorio();
  if (view === "config")    preencherConfigForm();
  if (view === "dashboard") loadDashboard();
  if (view === "registrar") { resetForm(); }
}

// ── Populate colaboradores ────────────────────────────────
function populateColaboradores() {
  const selects = ["colaboradorSelect", "f-colaborador", "h-colab", "r-colab"];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    // Mantém opção vazia em filtros
    const hasEmpty = id !== "f-colaborador";
    el.innerHTML = "";
    if (hasEmpty) el.innerHTML = '<option value="">Todos</option>';
    state.colaboradores.forEach(c => {
      const o = document.createElement("option");
      o.value = c; o.textContent = c;
      el.appendChild(o);
    });
  });
  if (state.colaborador) {
    const sel = document.getElementById("colaboradorSelect");
    if (sel) sel.value = state.colaborador;
  }
}

// ── API calls ─────────────────────────────────────────────
async function api(params) {
  if (!state.apiUrl) throw new Error("URL do Apps Script não configurada.");
  const url = new URL(state.apiUrl);
  Object.entries(params).forEach(([k,v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
  });
  const res  = await fetch(url.toString());
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// Apps Script não suporta CORS em POST — usa GET para tudo
async function apiPost(body) {
  return api(body);
}

// ── Config remota ─────────────────────────────────────────
async function loadConfig() {
  try {
    const { config } = await api({ action: "getConfig" });
    Object.assign(state.config, config);
    const colabs = config.Colaboradores || "";
    state.colaboradores = colabs.split(",").map(s => s.trim()).filter(Boolean);
    if (!state.colaborador && state.colaboradores.length)
      state.colaborador = state.colaboradores[0];
    saveLocalConfig();
    populateColaboradores();
  } catch(e) {
    console.warn("Não foi possível carregar config remota:", e.message);
  }
}

// ── DASHBOARD ─────────────────────────────────────────────
async function loadDashboard() {
  const hoje    = todayStr();
  const mesIni  = hoje.slice(0, 7) + "-01";
  const mesFim  = hoje;

  try {
    const data = await api({
      action:      "getRegistros",
      colaborador: state.colaborador,
      dataInicio:  mesIni,
      dataFim:     mesFim
    });
    state.registros = data.registros || [];
  } catch(e) {
    state.registros = [];
  }

  const regs    = state.registros;
  const hDiarias = parseFloat(state.config.HorasDiarias) || 8;

  // KPI — saldo do mês
  let saldoMin = 0;
  regs.forEach(r => { saldoMin += parseSaldo(r.Saldo); });
  document.getElementById("kpi-saldo").textContent = formatMinutes(saldoMin);
  document.getElementById("kpi-saldo").style.color =
    saldoMin >= 0 ? "var(--green)" : "var(--red)";
  document.getElementById("kpi-saldo-sub").textContent =
    saldoMin >= 0 ? "de crédito no mês" : "de débito no mês";

  // KPI — dias trabalhados
  document.getElementById("kpi-dias").textContent = regs.length;

  // KPI — média diária
  const totalMin = regs.reduce((a,r) => a + parseHoras(r.HorasTrabalhadas), 0);
  const media = regs.length ? Math.round(totalMin / regs.length) : 0;
  document.getElementById("kpi-media").textContent = formatMinutes(media);

  // KPI — hoje
  state.todayRecord = regs.find(r => r.Data === hoje) || null;
  const hj = state.todayRecord;
  if (hj) {
    document.getElementById("kpi-hoje").textContent = hj.HorasTrabalhadas || "--:--";
    const s = parseSaldo(hj.Saldo);
    document.getElementById("kpi-hoje-sub").textContent =
      (s >= 0 ? "+" : "") + formatMinutes(s) + " saldo";
    document.getElementById("kpi-hoje").style.color =
      s >= 0 ? "var(--green)" : "var(--red)";
  } else {
    document.getElementById("kpi-hoje").textContent = "--:--";
    document.getElementById("kpi-hoje-sub").textContent = "sem registro hoje";
    document.getElementById("kpi-hoje").style.color = "var(--text)";
  }

  // Gráfico de barras
  renderBarChart(regs.slice(-10));

  // Quick punch
  renderQuickPunch(hj);
}

function renderBarChart(regs) {
  const container = document.getElementById("barChart");
  container.innerHTML = "";
  if (!regs.length) {
    container.innerHTML = '<div style="color:var(--muted);font-size:.8rem;width:100%;text-align:center">Sem registros no mês</div>';
    return;
  }
  const maxAbs = Math.max(...regs.map(r => Math.abs(parseSaldo(r.Saldo))), 1);
  const maxH   = 110;

  regs.forEach(r => {
    const min  = parseSaldo(r.Saldo);
    const hPx  = Math.round((Math.abs(min) / maxAbs) * maxH) + 4;
    const pos  = min >= 0;
    const data = r.Data ? r.Data.slice(5) : "??";
    const wrap = document.createElement("div");
    wrap.className = "bar-wrap";
    wrap.title = `${r.Data} — ${formatMinutes(min)}`;
    wrap.innerHTML = `
      <span class="bar-val ${pos ? "pos" : "neg"}">${formatMinutes(min, true)}</span>
      <div class="bar ${pos ? "pos" : "neg"}" style="height:${hPx}px"></div>
      <span class="bar-label">${data}</span>`;
    container.appendChild(wrap);
  });
}

function renderQuickPunch(reg) {
  const slots = ["Entrada","SaidaAlmoco","RetornoAlmoco","Saida"];
  const ids   = ["entrada","saida-almoco","retorno-almoco","saida"];
  const keys  = ["Entrada","SaidaAlmoco","RetornoAlmoco","Saida"];
  const horas = parseFloat(state.config.HorasDiarias) || 8;

  document.getElementById("horasEsperadas").textContent = `Meta: ${horas}h`;

  let lastFilled = -1;
  slots.forEach((s, i) => {
    const val = reg ? reg[keys[i]] || "" : "";
    const el  = document.getElementById("val-" + ids[i]);
    const slot = document.getElementById("slot-" + ids[i]);
    const btn = slot.querySelector(".punch-btn");

    el.textContent = val || "--:--";
    slot.classList.toggle("done", !!val);
    slot.classList.remove("active-slot");

    if (val) lastFilled = i;
    btn.disabled = !!val || (i > 0 && lastFilled < i - 1);
  });

  // Marca próximo slot como ativo
  if (lastFilled < slots.length - 1) {
    const nextSlot = document.getElementById("slot-" + ids[lastFilled + 1]);
    if (nextSlot) nextSlot.classList.add("active-slot");
  }

  // Badge
  const badge = document.getElementById("today-badge");
  if (!reg) { badge.textContent = "Sem registro"; badge.className = "badge off"; }
  else if (lastFilled === 3) { badge.textContent = "Completo ✓"; badge.className = "badge ok"; }
  else { badge.textContent = "Em andamento"; badge.className = "badge warn"; }

  // Progress
  const worked = reg ? parseHoras(reg.HorasTrabalhadas) : 0;
  const expected = horas * 60;
  const pct = Math.min(100, Math.round((worked / expected) * 100));
  document.getElementById("dayProgress").style.width = pct + "%";
  document.getElementById("progressLabel").textContent = pct + "% do dia";
}

// ── BATER PONTO (quick punch) ─────────────────────────────
async function baterPonto(campo) {
  const agora   = new Date();
  const hora    = agora.toTimeString().slice(0, 5);
  const hoje    = todayStr();
  const hDiarias = parseFloat(state.config.HorasDiarias) || 8;

  let reg = state.todayRecord;

  try {
    if (!reg) {
      // Primeiro ponto do dia
      if (campo !== "Entrada") { showToast("Registre a Entrada primeiro", "error"); return; }
      const body = {
        action: "saveRegistro",
        Data: hoje,
        Colaborador: state.colaborador,
        Entrada: hora,
        HorasEsperadas: formatFromHours(hDiarias),
        Saldo: "", HorasTrabalhadas: "",
      };
      const res = await apiPost(body);
      state.todayRecord = { ...body, ID: res.id };
    } else {
      // Atualiza registro existente
      reg[campo] = hora;
      // Recalcula trabalhado e saldo
      const trab = calcTrabalhado(reg);
      const esperado = hDiarias * 60;
      const saldo    = trab - esperado;
      reg.HorasTrabalhadas = formatMinutes(trab);
      reg.Saldo = formatMinutes(saldo);

      await apiPost({
        action: "updateRegistro",
        ...reg,
        [campo]: hora,
        HorasTrabalhadas: reg.HorasTrabalhadas,
        Saldo: reg.Saldo,
      });
    }
    showToast(`${labelCampo(campo)} registrado: ${hora}`, "success");
    loadDashboard();
  } catch(e) {
    showToast("Erro: " + e.message, "error");
  }
}

// ── FORMULÁRIO MANUAL ─────────────────────────────────────
function initFormListeners() {
  const timeInputs = ["f-entrada","f-saida-almoco","f-retorno-almoco","f-saida"];
  timeInputs.forEach(id => {
    document.getElementById(id)?.addEventListener("change", updatePreview);
  });
  document.getElementById("f-data").addEventListener("change", updatePreview);
}

function updatePreview() {
  const entrada  = document.getElementById("f-entrada").value;
  const sAlmoco  = document.getElementById("f-saida-almoco").value;
  const rAlmoco  = document.getElementById("f-retorno-almoco").value;
  const saida    = document.getElementById("f-saida").value;
  const horas    = parseFloat(state.config.HorasDiarias) || 8;

  const reg = { Entrada: entrada, SaidaAlmoco: sAlmoco, RetornoAlmoco: rAlmoco, Saida: saida };
  const trab = calcTrabalhado(reg);
  const saldo = trab - horas * 60;

  document.getElementById("prev-trabalhado").textContent = trab ? formatMinutes(trab) : "--:--";
  document.getElementById("prev-esperado").textContent   = formatFromHours(horas);
  document.getElementById("prev-saldo").textContent      = trab ? formatMinutes(saldo) : "--:--";
  const sw = document.getElementById("prev-saldo-wrap");
  sw.classList.toggle("positive", saldo >= 0);
  sw.classList.toggle("negative", saldo < 0);
}

async function salvarRegistro(e) {
  e.preventDefault();
  const btn   = document.getElementById("submitBtn");
  const label = document.getElementById("submitLabel");
  btn.disabled = true;
  label.innerHTML = '<span class="spinner"></span>Salvando...';

  const data     = document.getElementById("f-data").value;
  const colab    = document.getElementById("f-colaborador").value;
  const entrada  = document.getElementById("f-entrada").value;
  const sAlmoco  = document.getElementById("f-saida-almoco").value;
  const rAlmoco  = document.getElementById("f-retorno-almoco").value;
  const saida    = document.getElementById("f-saida").value;
  const obs      = document.getElementById("f-obs").value;
  const horas    = parseFloat(state.config.HorasDiarias) || 8;

  const reg  = { Entrada: entrada, SaidaAlmoco: sAlmoco, RetornoAlmoco: rAlmoco, Saida: saida };
  const trab = calcTrabalhado(reg);
  const saldo = trab - horas * 60;

  const body = {
    action: state.editingId ? "updateRegistro" : "saveRegistro",
    ID: state.editingId || undefined,
    Data: data, Colaborador: colab,
    Entrada: entrada, SaidaAlmoco: sAlmoco,
    RetornoAlmoco: rAlmoco, Saida: saida,
    HorasTrabalhadas: trab ? formatMinutes(trab) : "",
    HorasEsperadas:   formatFromHours(horas),
    Saldo:            trab ? formatMinutes(saldo) : "",
    Observacao:       obs,
  };

  try {
    await apiPost(body);
    showToast(state.editingId ? "Registro atualizado!" : "Registro salvo!", "success");
    resetForm();
    if (data === todayStr()) loadDashboard();
  } catch(ex) {
    showToast("Erro: " + ex.message, "error");
  } finally {
    btn.disabled = false;
    label.textContent = "Salvar Registro";
  }
}

function resetForm() {
  state.editingId = null;
  document.getElementById("pontoForm").reset();
  document.getElementById("f-data").value = todayStr();
  document.getElementById("f-colaborador").value = state.colaborador || "";
  document.getElementById("submitLabel").textContent = "Salvar Registro";
  updatePreview();
}

// ── HISTÓRICO ─────────────────────────────────────────────
async function carregarHistorico() {
  const mes   = document.getElementById("h-mes").value;     // "YYYY-MM"
  const colab = document.getElementById("h-colab").value;
  const tbody = document.getElementById("historicoBody");
  tbody.innerHTML = '<tr><td colspan="10" class="empty-row"><span class="spinner"></span>Carregando...</td></tr>';

  const params = { action: "getRegistros" };
  if (mes) { params.dataInicio = mes + "-01"; params.dataFim = mes + "-31"; }
  if (colab) params.colaborador = colab;

  try {
    const { registros } = await api(params);
    state.registros = registros;
    renderHistorico(registros);
  } catch(e) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-row">Erro: ${e.message}</td></tr>`;
  }
}

function renderHistorico(registros) {
  const tbody = document.getElementById("historicoBody");
  if (!registros.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="empty-row">Nenhum registro encontrado</td></tr>';
    return;
  }
  tbody.innerHTML = registros
    .sort((a,b) => b.Data.localeCompare(a.Data))
    .map(r => {
      const s = parseSaldo(r.Saldo);
      const cls = s > 0 ? "td-pos" : s < 0 ? "td-neg" : "td-mono";
      const sText = s !== 0 ? (s>0?"+":"") + r.Saldo : r.Saldo || "--";
      return `<tr>
        <td>${formatDate(r.Data)}</td>
        <td>${r.Colaborador}</td>
        <td class="td-mono">${r.Entrada||"--"}</td>
        <td class="td-mono">${r.SaidaAlmoco||"--"}</td>
        <td class="td-mono">${r.RetornoAlmoco||"--"}</td>
        <td class="td-mono">${r.Saida||"--"}</td>
        <td class="td-mono">${r.HorasTrabalhadas||"--"}</td>
        <td class="${cls}">${sText}</td>
        <td style="color:var(--muted);font-size:.78rem">${r.Observacao||""}</td>
        <td><div class="row-actions">
          <button class="icon-btn" title="Editar" onclick="editarRegistro('${r.ID}')">✎</button>
          <button class="icon-btn del" title="Excluir" onclick="excluirRegistro('${r.ID}')">✕</button>
        </div></td>
      </tr>`;
    }).join("");
}

function editarRegistro(id) {
  const reg = state.registros.find(r => r.ID === id);
  if (!reg) return;
  state.editingId = id;

  // Preenche form e navega
  navigateTo("registrar");
  setTimeout(() => {
    document.getElementById("f-data").value           = reg.Data || "";
    document.getElementById("f-colaborador").value    = reg.Colaborador || "";
    document.getElementById("f-entrada").value        = reg.Entrada || "";
    document.getElementById("f-saida-almoco").value   = reg.SaidaAlmoco || "";
    document.getElementById("f-retorno-almoco").value = reg.RetornoAlmoco || "";
    document.getElementById("f-saida").value          = reg.Saida || "";
    document.getElementById("f-obs").value            = reg.Observacao || "";
    document.getElementById("submitLabel").textContent = "Atualizar Registro";
    updatePreview();
  }, 50);
}

async function excluirRegistro(id) {
  if (!confirm("Deseja realmente excluir este registro?")) return;
  try {
    await apiPost({ action: "deleteRegistro", ID: id });
    showToast("Registro excluído", "success");
    carregarHistorico();
  } catch(e) {
    showToast("Erro: " + e.message, "error");
  }
}

// ── RELATÓRIO ─────────────────────────────────────────────
async function gerarRelatorio() {
  const ini   = document.getElementById("r-inicio").value;
  const fim   = document.getElementById("r-fim").value;
  const colab = document.getElementById("r-colab").value;

  const params = { action: "getRegistros" };
  if (ini && fim) { params.dataInicio = ini; params.dataFim = fim; }
  if (colab) params.colaborador = colab;

  document.getElementById("relatorioBody").innerHTML =
    '<tr><td colspan="6" class="empty-row"><span class="spinner"></span>Gerando...</td></tr>';

  try {
    const { registros } = await api(params);
    state.relatorioData = registros;
    renderRelatorio(registros);
  } catch(e) {
    document.getElementById("relatorioBody").innerHTML =
      `<tr><td colspan="6" class="empty-row">Erro: ${e.message}</td></tr>`;
  }
}

function renderRelatorio(registros) {
  const hDiarias = parseFloat(state.config.HorasDiarias) || 8;

  // ── KPIs
  const total = registros.reduce((a,r) => a + parseHoras(r.HorasTrabalhadas), 0);
  const saldo = registros.reduce((a,r) => a + parseSaldo(r.Saldo), 0);
  const dias  = registros.length;
  const media = dias ? Math.round(total / dias) : 0;

  const kpis = document.getElementById("relatorioKpis");
  kpis.innerHTML = `
    <div class="kpi-card"><div class="kpi-label">Total Trabalhado</div>
      <div class="kpi-value td-mono">${formatMinutes(total)}</div>
      <div class="kpi-sub">no período</div></div>
    <div class="kpi-card"><div class="kpi-label">Saldo do Período</div>
      <div class="kpi-value" style="color:${saldo>=0?"var(--green)":"var(--red)"}">${formatMinutes(saldo)}</div>
      <div class="kpi-sub">${saldo>=0?"crédito":"débito"}</div></div>
    <div class="kpi-card"><div class="kpi-label">Dias Registrados</div>
      <div class="kpi-value">${dias}</div>
      <div class="kpi-sub">registros</div></div>
    <div class="kpi-card"><div class="kpi-label">Média Diária</div>
      <div class="kpi-value td-mono">${formatMinutes(media)}</div>
      <div class="kpi-sub">horas/dia</div></div>`;

  // ── Banco por colaborador
  const porColab = {};
  registros.forEach(r => {
    const c = r.Colaborador || "—";
    if (!porColab[c]) porColab[c] = { total: 0, saldo: 0, dias: 0 };
    porColab[c].total += parseHoras(r.HorasTrabalhadas);
    porColab[c].saldo += parseSaldo(r.Saldo);
    porColab[c].dias++;
  });

  const banco = document.getElementById("bancoPorColab");
  banco.innerHTML = '<div class="banco-colab-grid">' +
    Object.entries(porColab).map(([nome, d]) => `
      <div class="banco-colab-card">
        <div class="banco-colab-name">${nome}</div>
        <div class="banco-colab-saldo" style="color:${d.saldo>=0?"var(--green)":"var(--red)"}">
          ${d.saldo>=0?"+":""}${formatMinutes(d.saldo)}</div>
        <div class="banco-colab-detail">
          ${d.dias} dias · ${formatMinutes(d.total)} trabalhadas
        </div>
      </div>`).join("") + '</div>';

  // ── Tabela detalhada com acumulado por colaborador
  const sorted = [...registros].sort((a,b) => {
    const c = a.Colaborador.localeCompare(b.Colaborador);
    return c !== 0 ? c : a.Data.localeCompare(b.Data);
  });

  const acums = {};
  const rows  = sorted.map(r => {
    const c = r.Colaborador || "—";
    if (!acums[c]) acums[c] = 0;
    acums[c] += parseSaldo(r.Saldo);
    const s  = parseSaldo(r.Saldo);
    const sc = s > 0 ? "td-pos" : s < 0 ? "td-neg" : "td-mono";
    const ac = acums[c];
    const ac_cls = ac > 0 ? "td-pos" : ac < 0 ? "td-neg" : "td-mono";
    return `<tr>
      <td>${formatDate(r.Data)}</td>
      <td>${r.Colaborador}</td>
      <td class="td-mono">${r.HorasTrabalhadas||"--"}</td>
      <td class="td-mono">${r.HorasEsperadas||"--"}</td>
      <td class="${sc}">${s!==0?(s>0?"+":""):""} ${r.Saldo||"--"}</td>
      <td class="${ac_cls}">${ac>=0?"+":""}${formatMinutes(ac)}</td>
    </tr>`;
  });

  document.getElementById("relatorioBody").innerHTML =
    rows.length ? rows.join("") : '<tr><td colspan="6" class="empty-row">Sem dados</td></tr>';
}

function exportarCSV() {
  if (!state.relatorioData.length) { showToast("Gere o relatório primeiro", "info"); return; }
  const headers = ["Data","Colaborador","Entrada","SaidaAlmoco","RetornoAlmoco","Saida","HorasTrabalhadas","HorasEsperadas","Saldo","Observacao"];
  const rows = [
    headers.join(";"),
    ...state.relatorioData.map(r => headers.map(h => r[h]||"").join(";"))
  ];
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `ponto_export_${todayStr()}.csv`;
  link.click();
  showToast("CSV exportado!", "success");
}

// ── CONFIG FORM ───────────────────────────────────────────
function preencherConfigForm() {
  document.getElementById("c-url").value          = state.apiUrl || "";
  document.getElementById("c-horas").value        = state.config.HorasDiarias || "8";
  document.getElementById("c-tolerancia").value   = state.config.ToleranciaMinutos || "10";
  document.getElementById("c-colaboradores").value =
    state.colaboradores.join("\n");
}

async function salvarConfig(e) {
  e.preventDefault();
  const url   = document.getElementById("c-url").value.trim();
  const horas = document.getElementById("c-horas").value;
  const tol   = document.getElementById("c-tolerancia").value;
  const colabs = document.getElementById("c-colaboradores").value
    .split("\n").map(s => s.trim()).filter(Boolean);

  state.apiUrl               = url;
  state.config.HorasDiarias      = horas;
  state.config.ToleranciaMinutos  = tol;
  state.config.Colaboradores      = colabs.join(",");
  state.colaboradores             = colabs;
  if (!state.colaborador && colabs.length) state.colaborador = colabs[0];
  saveLocalConfig();
  populateColaboradores();

  const status = document.getElementById("config-status");
  if (url) {
    try {
      await apiPost({ action: "saveConfig", HorasDiarias: horas, ToleranciaMinutos: tol, Colaboradores: state.config.Colaboradores });
      status.className = "config-status ok";
      status.textContent = "✓ Configurações salvas na planilha com sucesso!";
      showToast("Configurações salvas!", "success");
    } catch(ex) {
      status.className = "config-status err";
      status.textContent = "✗ Salvo localmente, mas erro na planilha: " + ex.message;
    }
  } else {
    status.className = "config-status ok";
    status.textContent = "✓ Configurações salvas localmente.";
    showToast("Configurações salvas localmente", "success");
  }
  setTimeout(() => { status.style.display = "none"; status.className = "config-status"; }, 5000);
}

async function testarConexao() {
  const url = document.getElementById("c-url").value.trim();
  if (!url) { showToast("Informe a URL primeiro", "error"); return; }
  const prev = state.apiUrl;
  state.apiUrl = url;
  const status = document.getElementById("config-status");
  status.className = "config-status info";
  status.style.display = "block";
  status.textContent = "⏳ Testando conexão...";
  try {
    const r = await api({ action: "getConfig" });
    status.className = "config-status ok";
    status.textContent = "✓ Conexão OK! Planilha encontrada.";
    showToast("Conexão com a planilha bem-sucedida!", "success");
  } catch(e) {
    state.apiUrl = prev;
    status.className = "config-status err";
    status.textContent = "✗ Falha na conexão: " + e.message;
    showToast("Falha na conexão", "error");
  }
}

// ── Modal ─────────────────────────────────────────────────
function closeModal() { document.getElementById("modal").classList.add("hidden"); }

// ── Toast ─────────────────────────────────────────────────
function showToast(msg, type = "info") {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.className = `toast ${type} show`;
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => { el.classList.remove("show"); }, 3500);
}

// ── Helpers ───────────────────────────────────────────────
function todayStr() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function formatDate(str) {
  if (!str) return "--";
  const [y, m, d] = str.split("-");
  return `${d}/${m}/${y}`;
}

// "HH:MM" → minutos
function parseHoras(str) {
  if (!str || str === "--:--") return 0;
  const neg = str.startsWith("-");
  const [h, m] = str.replace(/^[-+]/, "").split(":").map(Number);
  return (h * 60 + (m||0)) * (neg ? -1 : 1);
}

// Saldo pode ser "-01:30" ou "01:30"
function parseSaldo(str) { return parseHoras(str); }

// minutos → "HH:MM"
function formatMinutes(min, short = false) {
  const neg = min < 0;
  const abs = Math.abs(min);
  const h   = Math.floor(abs / 60);
  const m   = abs % 60;
  const s   = String(h).padStart(2,"0") + ":" + String(m).padStart(2,"0");
  if (short) return (neg ? "-" : "+") + s;
  return (neg ? "-" : "") + s;
}

function formatFromHours(h) {
  const min = Math.round(h * 60);
  return formatMinutes(min);
}

function calcTrabalhado(reg) {
  const { Entrada, SaidaAlmoco, RetornoAlmoco, Saida } = reg;
  if (!Entrada || !Saida) return 0;
  const toMin = s => { if (!s) return 0; const [h,m] = s.split(":").map(Number); return h*60+m; };
  let t = toMin(Saida) - toMin(Entrada);
  if (SaidaAlmoco && RetornoAlmoco) t -= (toMin(RetornoAlmoco) - toMin(SaidaAlmoco));
  return Math.max(0, t);
}

function labelCampo(c) {
  const m = { Entrada:"Entrada", SaidaAlmoco:"Saída Almoço", RetornoAlmoco:"Retorno", Saida:"Saída" };
  return m[c] || c;
}

function setDefaultDates() {
  const hoje = todayStr();
  const mesAtual = hoje.slice(0, 7);
  const mesIni = mesAtual + "-01";

  document.getElementById("f-data").value  = hoje;
  document.getElementById("h-mes").value   = mesAtual;
  document.getElementById("r-inicio").value = mesIni;
  document.getElementById("r-fim").value   = hoje;
}
