// =====================================================================
// Cobrador App — frontend (sin frameworks, para que cargue rápido y
// funcione bien como PWA instalada en el celular).
// =====================================================================

const state = {
  user: null,
  view: "dashboard",
  params: {},
  cache: {
    clientes: null,
    rutas: null,
    prestamos: null,
  },
  loading: false,
};

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function money(n) {
  const v = Number(n || 0);
  return "$" + v.toLocaleString("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fechaCorta(iso) {
  if (!iso) return "-";
  const d = new Date(iso.includes("T") ? iso : iso + "T00:00:00");
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "short" });
}

function iniciales(nombre) {
  return (nombre || "?")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join("");
}

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

async function api(path, options = {}) {
  const resp = await fetch("/api" + path, {
    method: options.method || "GET",
    headers: options.body ? { "Content-Type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: "include",
  });
  let data = null;
  try {
    data = await resp.json();
  } catch (e) {
    data = null;
  }
  if (!resp.ok) {
    const msg = (data && data.error) || "Ocurrió un error. Intenta de nuevo.";
    throw new Error(msg);
  }
  return data;
}

function toast(msg, type = "") {
  const el = document.createElement("div");
  el.className = "toast" + (type ? " " + type : "");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

function go(view, params = {}) {
  state.view = view;
  state.params = params;
  window.scrollTo(0, 0);
  render();
}

function closeSheet() {
  const el = document.getElementById("sheet-root");
  if (el) el.innerHTML = "";
}

function openSheet(html) {
  const el = document.getElementById("sheet-root");
  el.innerHTML = `<div class="sheet-backdrop" onclick="if(event.target===this) closeSheet()">
      <div class="sheet">
        <div class="sheet-handle"></div>
        ${html}
      </div>
    </div>`;
}

// ---------------------------------------------------------------------
// Íconos (SVG en línea, sin depender de internet)
// ---------------------------------------------------------------------
const ICONS = {
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></svg>`,
  agenda: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/><path d="m9 15 2 2 4-4"/></svg>`,
  clientes: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6.5 6.5-6.5s6.5 2.9 6.5 6.5"/><circle cx="17.5" cy="8.5" r="2.7"/><path d="M16 13.5c2.9.3 5 2.8 5 6.5"/></svg>`,
  reportes: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>`,
  ajustes: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`,
  back: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
};

// ---------------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------------
async function checkSesion() {
  try {
    const { user } = await api("/auth/me");
    state.user = user;
  } catch (e) {
    state.user = null;
  }
}

async function login(username, password) {
  const data = await api("/auth/login", { method: "POST", body: { username, password } });
  state.user = data.user;
}

async function logout() {
  await api("/auth/logout", { method: "POST" });
  state.user = null;
  state.cache = { clientes: null, rutas: null, prestamos: null };
  go("dashboard");
}

// ---------------------------------------------------------------------
// Render principal
// ---------------------------------------------------------------------
function render() {
  const app = document.getElementById("app");
  if (!state.user) {
    app.innerHTML = viewLogin();
    return;
  }

  app.innerHTML = `
    <div class="app-shell">
      <div id="view-root"></div>
      <div id="sheet-root"></div>
      <nav class="bottom-nav">
        ${navItem("dashboard", ICONS.home, "Inicio")}
        ${navItem("agenda", ICONS.agenda, "Agenda")}
        ${navItem("clientes", ICONS.clientes, "Clientes")}
        ${navItem("reportes", ICONS.reportes, "Reportes")}
        ${navItem("ajustes", ICONS.ajustes, "Ajustes")}
      </nav>
    </div>
  `;
  renderCurrentView();
}

function navItem(view, icon, label) {
  const raiz = ["dashboard", "agenda", "clientes", "reportes", "ajustes"];
  const active = state.view === view || (!raiz.includes(state.view) && view === "dashboard" && false);
  return `<button class="nav-item ${state.view === view ? "active" : ""}" onclick="go('${view}')">
      ${icon}<span>${label}</span>
    </button>`;
}

async function renderCurrentView() {
  const root = document.getElementById("view-root");
  root.innerHTML = `<div class="spinner"></div>`;
  try {
    let html = "";
    switch (state.view) {
      case "dashboard": html = await viewDashboard(); break;
      case "agenda": html = await viewAgenda(); break;
      case "clientes": html = await viewClientes(); break;
      case "cliente-detalle": html = await viewClienteDetalle(state.params.id); break;
      case "prestamo-detalle": html = await viewPrestamoDetalle(state.params.id); break;
      case "reportes": html = await viewReportes(); break;
      case "ajustes": html = await viewAjustes(); break;
      case "rutas": html = await viewRutas(); break;
      default: html = await viewDashboard();
    }
    root.innerHTML = html;
  } catch (e) {
    root.innerHTML = `<main class="view"><div class="empty-state"><div class="icon">⚠️</div><p>${e.message}</p>
      <button class="btn btn-secondary" onclick="renderCurrentView()">Reintentar</button></div></main>`;
  }
  // refresca clases activas del menú
  document.querySelectorAll(".nav-item").forEach((btn) => btn.classList.remove("active"));
  const raiz = ["dashboard", "agenda", "clientes", "reportes", "ajustes"];
  const activo = raiz.includes(state.view) ? state.view : null;
  if (activo) {
    const idx = raiz.indexOf(activo);
    const btns = document.querySelectorAll(".nav-item");
    if (btns[idx]) btns[idx].classList.add("active");
  }
}

function topbar(title, backView) {
  return `<div class="topbar">
      ${backView ? `<button class="back-btn" onclick="go('${backView}')">${ICONS.back}</button>` : "<span></span>"}
      <h2>${title}</h2>
      <span style="width:24px"></span>
    </div>`;
}

// ---------------------------------------------------------------------
// LOGIN
// ---------------------------------------------------------------------
function viewLogin() {
  return `
    <div class="login-screen">
      <div class="login-card">
        <div class="login-logo">$</div>
        <h1>Cobrador App</h1>
        <p class="subtitle">Ingresa con tu usuario y contraseña</p>
        <div id="login-error"></div>
        <form onsubmit="return submitLogin(event)">
          <div class="field">
            <label>Usuario</label>
            <input type="text" id="login-user" autocomplete="username" required />
          </div>
          <div class="field">
            <label>Contraseña</label>
            <input type="password" id="login-pass" autocomplete="current-password" required />
          </div>
          <button class="btn btn-primary" type="submit" id="login-btn">Entrar</button>
        </form>
      </div>
    </div>
  `;
}

async function submitLogin(ev) {
  ev.preventDefault();
  const user = document.getElementById("login-user").value.trim();
  const pass = document.getElementById("login-pass").value;
  const btn = document.getElementById("login-btn");
  const errBox = document.getElementById("login-error");
  errBox.innerHTML = "";
  btn.disabled = true;
  btn.textContent = "Entrando...";
  try {
    await login(user, pass);
    go("dashboard");
  } catch (e) {
    errBox.innerHTML = `<div class="error-msg">${e.message}</div>`;
    btn.disabled = false;
    btn.textContent = "Entrar";
  }
  return false;
}

// ---------------------------------------------------------------------
// DASHBOARD
// ---------------------------------------------------------------------
async function viewDashboard() {
  const [resumen, agenda] = await Promise.all([
    api("/reportes/resumen"),
    api("/pagos/agenda/hoy"),
  ]);
  const atrasadas = agenda.filter((a) => a.atrasada).length;
  const hoyPendientes = agenda.length;

  return `
    ${topbar("Hola 👋")}
    <main class="view">
      <div class="cards-grid">
        <div class="stat-card accent">
          <div class="label">Recaudado hoy</div>
          <div class="value">${money(resumen.recaudadoHoy)}</div>
        </div>
        <div class="stat-card ${resumen.moraTotal > 0 ? "warn" : ""}">
          <div class="label">En mora</div>
          <div class="value">${money(resumen.moraTotal)}</div>
        </div>
        <div class="stat-card">
          <div class="label">Cartera por cobrar</div>
          <div class="value">${money(resumen.totalPorCobrar)}</div>
        </div>
        <div class="stat-card">
          <div class="label">Ganancia proyectada</div>
          <div class="value">${money(resumen.gananciaProyectada)}</div>
        </div>
      </div>

      <div class="section-title">
        <span>Agenda de hoy (${hoyPendientes})</span>
        <a onclick="go('agenda')" style="font-size:13px;color:var(--primary);font-weight:600;cursor:pointer;">Ver todo</a>
      </div>
      ${
        agenda.length === 0
          ? `<div class="empty-state"><div class="icon">✅</div><p>No hay cobros pendientes para hoy</p></div>`
          : agenda.slice(0, 5).map(cuotaListItem).join("")
      }

      <div class="section-title">
        <span>Resumen general</span>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;padding:6px 0;">
          <span class="muted">Clientes activos</span><b>${resumen.clientesActivos}</b>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;">
          <span class="muted">Préstamos activos</span><b>${resumen.prestamosActivos}</b>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;">
          <span class="muted">Total prestado</span><b>${money(resumen.totalPrestado)}</b>
        </div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;">
          <span class="muted">Recaudado histórico</span><b>${money(resumen.totalRecaudadoHistorico)}</b>
        </div>
      </div>

      <button class="btn btn-secondary btn-block" style="margin-top:14px;" onclick="abrirNuevoPrestamo()">+ Nuevo préstamo</button>
    </main>
  `;
}

function cuotaListItem(c) {
  const estadoBadge = c.atrasada ? "atrasada" : "pendiente";
  const estadoTexto = c.atrasada ? "Atrasada" : "Hoy";
  return `
    <div class="list-item" onclick="go('cliente-detalle', {id: ${c.cliente_id}})">
      <div class="avatar">${iniciales(c.cliente_nombre)}</div>
      <div class="info">
        <div class="title">${c.cliente_nombre}</div>
        <div class="subtitle">${c.ruta_nombre || "Sin ruta"} · Cuota #${c.numero} · ${fechaCorta(c.fecha_vencimiento)}</div>
      </div>
      <div style="text-align:right;">
        <div class="amount debt">${money(c.valor - c.valor_pagado)}</div>
        <span class="badge ${estadoBadge}">${estadoTexto}</span>
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------
// AGENDA DEL DÍA
// ---------------------------------------------------------------------
async function viewAgenda() {
  const rutaId = state.params.ruta_id || "";
  const [agenda, rutas] = await Promise.all([
    api("/pagos/agenda/hoy" + (rutaId ? `?ruta_id=${rutaId}` : "")),
    api("/rutas"),
  ]);

  const filtros = `<option value="">Todas las rutas</option>` +
    rutas.map((r) => `<option value="${r.id}" ${String(r.id) === String(rutaId) ? "selected" : ""}>${r.nombre}</option>`).join("");

  return `
    ${topbar("Agenda de cobro")}
    <main class="view">
      <div class="field">
        <select onchange="go('agenda', {ruta_id: this.value})">${filtros}</select>
      </div>
      ${
        agenda.length === 0
          ? `<div class="empty-state"><div class="icon">✅</div><p>No hay cuotas pendientes${rutaId ? " en esta ruta" : ""}</p></div>`
          : agenda.map((c) => `
            <div class="list-item">
              <div class="avatar">${iniciales(c.cliente_nombre)}</div>
              <div class="info" onclick="go('cliente-detalle', {id: ${c.cliente_id}})">
                <div class="title">${c.cliente_nombre}</div>
                <div class="subtitle">${c.direccion || c.telefono || ""} · Cuota #${c.numero}</div>
                <span class="badge ${c.atrasada ? "atrasada" : "pendiente"}">${c.atrasada ? "Atrasada · " + fechaCorta(c.fecha_vencimiento) : "Vence hoy"}</span>
              </div>
              <div style="text-align:right;">
                <div class="amount debt">${money(c.valor - c.valor_pagado)}</div>
                <button class="btn btn-primary btn-sm" style="margin-top:6px;" onclick="abrirRegistrarPago(${c.id}, ${c.valor - c.valor_pagado}, '${(c.cliente_nombre || "").replace(/'/g, "")}')">Cobrar</button>
              </div>
            </div>
          `).join("")
      }
    </main>
  `;
}

// ---------------------------------------------------------------------
// CLIENTES
// ---------------------------------------------------------------------
async function viewClientes() {
  const clientes = await api("/clientes");
  state.cache.clientes = clientes;
  const q = (state.params.q || "").toLowerCase();
  const filtrados = q
    ? clientes.filter((c) => c.nombre.toLowerCase().includes(q) || (c.telefono || "").includes(q))
    : clientes;

  return `
    ${topbar("Clientes")}
    <main class="view">
      <div class="search-bar">
        <span class="muted">🔎</span>
        <input placeholder="Buscar cliente..." value="${state.params.q || ""}" oninput="go('clientes', {q: this.value})" />
      </div>
      ${
        filtrados.length === 0
          ? `<div class="empty-state"><div class="icon">👤</div><p>${clientes.length === 0 ? "Todavía no tienes clientes" : "No se encontraron clientes"}</p></div>`
          : filtrados.map((c) => `
            <div class="list-item" onclick="go('cliente-detalle', {id: ${c.id}})">
              <div class="avatar">${iniciales(c.nombre)}</div>
              <div class="info">
                <div class="title">${c.nombre}</div>
                <div class="subtitle">${c.ruta_nombre || "Sin ruta"} ${c.telefono ? "· " + c.telefono : ""}</div>
              </div>
              <div class="amount ${c.deuda_pendiente > 0 ? "debt" : "ok"}">${c.deuda_pendiente > 0 ? money(c.deuda_pendiente) : "Al día"}</div>
            </div>
          `).join("")
      }
    </main>
    <button class="fab" onclick="abrirNuevoCliente()">${ICONS.plus}</button>
  `;
}

async function abrirNuevoCliente() {
  const rutas = state.cache.rutas || (await api("/rutas"));
  state.cache.rutas = rutas;
  openSheet(`
    <h3>Nuevo cliente</h3>
    <div id="form-error"></div>
    <div class="field"><label>Nombre completo *</label><input id="nc-nombre" required /></div>
    <div class="row-2">
      <div class="field"><label>Teléfono</label><input id="nc-telefono" /></div>
      <div class="field"><label>Identificación (opcional)</label><input id="nc-id" /></div>
    </div>
    <div class="field"><label>Dirección</label><input id="nc-direccion" /></div>
    <div class="field">
      <label>Ruta de cobro (opcional)</label>
      <select id="nc-ruta">
        <option value="">Sin ruta</option>
        ${rutas.map((r) => `<option value="${r.id}">${r.nombre}</option>`).join("")}
      </select>
      <p class="muted" style="font-size:12px;margin:6px 0 0;">Una ruta es una zona o grupo de clientes que visitas juntos (ej. "Barrio Centro"). Si no tienes ninguna creada todavía, solo verás "Sin ruta" — puedes crearlas en Ajustes → Rutas de cobro y luego asignarlas aquí.</p>
    </div>
    <div class="field"><label>Notas</label><textarea id="nc-notas" rows="2"></textarea></div>
    <button class="btn btn-primary btn-block" onclick="guardarCliente()">Guardar cliente</button>
  `);
}

async function guardarCliente() {
  const nombre = document.getElementById("nc-nombre").value.trim();
  if (!nombre) {
    document.getElementById("form-error").innerHTML = `<div class="error-msg">El nombre es obligatorio</div>`;
    return;
  }
  try {
    await api("/clientes", {
      method: "POST",
      body: {
        nombre,
        telefono: document.getElementById("nc-telefono").value.trim(),
        identificacion: document.getElementById("nc-id").value.trim(),
        direccion: document.getElementById("nc-direccion").value.trim(),
        ruta_id: document.getElementById("nc-ruta").value || null,
        notas: document.getElementById("nc-notas").value.trim(),
      },
    });
    closeSheet();
    toast("Cliente guardado", "success");
    go("clientes");
  } catch (e) {
    document.getElementById("form-error").innerHTML = `<div class="error-msg">${e.message}</div>`;
  }
}

async function viewClienteDetalle(id) {
  const cliente = await api(`/clientes/${id}`);
  const prestamosActivos = cliente.prestamos.filter((p) => p.estado === "activo");
  const otros = cliente.prestamos.filter((p) => p.estado !== "activo");

  return `
    ${topbar(cliente.nombre, "clientes")}
    <main class="view">
      <div class="card">
        ${cliente.telefono ? `<div style="padding:4px 0;"><span class="muted">Teléfono:</span> ${cliente.telefono}</div>` : ""}
        ${cliente.direccion ? `<div style="padding:4px 0;"><span class="muted">Dirección:</span> ${cliente.direccion}</div>` : ""}
        ${cliente.identificacion ? `<div style="padding:4px 0;"><span class="muted">Identificación:</span> ${cliente.identificacion}</div>` : ""}
        ${cliente.notas ? `<div style="padding:4px 0;"><span class="muted">Notas:</span> ${cliente.notas}</div>` : ""}
      </div>

      <button class="btn btn-primary btn-block" onclick="abrirNuevoPrestamo(${cliente.id})">+ Nuevo préstamo para ${cliente.nombre.split(" ")[0]}</button>

      <div class="section-title"><span>Préstamos activos</span></div>
      ${
        prestamosActivos.length === 0
          ? `<p class="muted">Sin préstamos activos</p>`
          : prestamosActivos.map(prestamoListItem).join("")
      }

      ${
        otros.length
          ? `<div class="section-title"><span>Historial</span></div>` + otros.map(prestamoListItem).join("")
          : ""
      }
    </main>
  `;
}

function prestamoListItem(p) {
  return `
    <div class="list-item" onclick="go('prestamo-detalle', {id: ${p.id}})">
      <div class="info">
        <div class="title">${money(p.monto)} · ${p.frecuencia}</div>
        <div class="subtitle">${p.num_cuotas} cuotas de ${money(p.valor_cuota)} · desde ${fechaCorta(p.fecha_inicio)}</div>
      </div>
      <span class="badge ${p.estado}">${p.estado}</span>
    </div>
  `;
}

// ---------------------------------------------------------------------
// NUEVO PRÉSTAMO
// ---------------------------------------------------------------------
async function abrirNuevoPrestamo(clienteIdPreseleccionado) {
  const clientes = state.cache.clientes || (await api("/clientes"));
  state.cache.clientes = clientes;

  openSheet(`
    <h3>Nuevo préstamo</h3>
    <div id="form-error"></div>
    <div class="field">
      <label>Cliente *</label>
      <select id="np-cliente">
        ${clientes.map((c) => `<option value="${c.id}" ${clienteIdPreseleccionado == c.id ? "selected" : ""}>${c.nombre}</option>`).join("")}
      </select>
    </div>
    <div class="row-2">
      <div class="field"><label>Monto prestado *</label><input id="np-monto" type="number" min="0" step="0.01" required /></div>
      <div class="field"><label>Tasa de interés (%) *</label><input id="np-tasa" type="number" min="0" step="0.01" required /></div>
    </div>
    <div class="field">
      <label>Tipo de interés</label>
      <select id="np-tipo">
        <option value="fijo">Fijo (sobre el monto original)</option>
        <option value="saldo">Sobre saldo (cuota tipo bancario)</option>
        <option value="capitalizado">Capitalizado (se acumula si hay mora)</option>
      </select>
    </div>
    <div class="row-2">
      <div class="field">
        <label>Frecuencia de pago</label>
        <select id="np-frecuencia">
          <option value="diario">Diario</option>
          <option value="semanal">Semanal</option>
          <option value="quincenal">Quincenal</option>
          <option value="mensual">Mensual</option>
        </select>
      </div>
      <div class="field"><label>Número de cuotas *</label><input id="np-cuotas" type="number" min="1" step="1" required /></div>
    </div>
    <div class="field"><label>Fecha de inicio *</label><input id="np-fecha" type="date" value="${hoyISO()}" required /></div>
    <div class="field"><label>Notas</label><textarea id="np-notas" rows="2"></textarea></div>
    <div id="np-preview" class="muted" style="font-size:13px;margin-bottom:12px;"></div>
    <button class="btn btn-primary btn-block" onclick="guardarPrestamo()">Crear préstamo</button>
  `);
}

async function guardarPrestamo() {
  const cliente_id = document.getElementById("np-cliente").value;
  const monto = parseFloat(document.getElementById("np-monto").value);
  const tasa_interes = parseFloat(document.getElementById("np-tasa").value);
  const tipo_interes = document.getElementById("np-tipo").value;
  const frecuencia = document.getElementById("np-frecuencia").value;
  const num_cuotas = parseInt(document.getElementById("np-cuotas").value, 10);
  const fecha_inicio = document.getElementById("np-fecha").value;
  const notas = document.getElementById("np-notas").value.trim();

  if (!cliente_id || !monto || isNaN(tasa_interes) || !num_cuotas || !fecha_inicio) {
    document.getElementById("form-error").innerHTML = `<div class="error-msg">Completa todos los campos obligatorios (*)</div>`;
    return;
  }
  try {
    const r = await api("/prestamos", {
      method: "POST",
      body: { cliente_id, monto, tasa_interes, tipo_interes, frecuencia, num_cuotas, fecha_inicio, notas },
    });
    closeSheet();
    toast(`Préstamo creado. Cuota: ${money(r.valor_cuota)}`, "success");
    go("prestamo-detalle", { id: r.id });
  } catch (e) {
    document.getElementById("form-error").innerHTML = `<div class="error-msg">${e.message}</div>`;
  }
}

// ---------------------------------------------------------------------
// DETALLE DE PRÉSTAMO / CUOTAS
// ---------------------------------------------------------------------
async function viewPrestamoDetalle(id) {
  const p = await api(`/prestamos/${id}`);
  const pagadas = p.cuotas.filter((c) => c.estado === "pagada").length;
  const totalPagado = p.cuotas.reduce((s, c) => s + c.valor_pagado, 0);
  const pct = p.total_pagar > 0 ? Math.round((totalPagado / p.total_pagar) * 100) : 0;

  return `
    ${topbar("Préstamo", "cliente-detalle")}
    <main class="view">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div class="title" style="font-size:17px;font-weight:700;">${p.cliente.nombre}</div>
            <div class="subtitle muted">${money(p.monto)} prestados · ${p.tipo_interes} · ${p.frecuencia}</div>
          </div>
          <span class="badge ${p.estado}">${p.estado}</span>
        </div>
        <div class="progress-bar"><div class="fill" style="width:${pct}%"></div></div>
        <div class="subtitle muted" style="margin-top:6px;">${money(totalPagado)} pagados de ${money(p.total_pagar)} (${pagadas}/${p.cuotas.length} cuotas)</div>
        ${p.estado === "activo" ? `<button class="btn btn-danger btn-sm" style="margin-top:12px;" onclick="cancelarPrestamo(${p.id})">Cancelar préstamo</button>` : ""}
      </div>

      <div class="section-title"><span>Cuotas</span></div>
      ${p.cuotas.map((c) => cuotaRow(c, p)).join("")}
    </main>
  `;
}

function cuotaRow(c, prestamo) {
  const hoy = hoyISO();
  const atrasada = c.estado !== "pagada" && c.fecha_vencimiento < hoy;
  const estado = atrasada ? "atrasada" : c.estado;
  const pendiente = Math.round((c.valor - c.valor_pagado) * 100) / 100;
  return `
    <div class="list-item">
      <div class="info">
        <div class="title">Cuota #${c.numero} · ${fechaCorta(c.fecha_vencimiento)}</div>
        <div class="subtitle">${money(c.valor)} ${c.valor_pagado > 0 ? "· pagado " + money(c.valor_pagado) : ""}</div>
      </div>
      <div style="text-align:right;">
        <span class="badge ${estado}">${estado}</span>
        ${
          c.estado !== "pagada"
            ? `<div><button class="btn btn-primary btn-sm" style="margin-top:6px;" onclick="abrirRegistrarPago(${c.id}, ${pendiente}, '')">Registrar pago</button></div>`
            : ""
        }
      </div>
    </div>
  `;
}

async function cancelarPrestamo(id) {
  if (!confirm("¿Seguro que quieres cancelar este préstamo? Las cuotas pendientes quedarán inactivas.")) return;
  await api(`/prestamos/${id}/cancelar`, { method: "PUT" });
  toast("Préstamo cancelado");
  renderCurrentView();
}

function abrirRegistrarPago(cuotaId, pendiente, nombreCliente) {
  openSheet(`
    <h3>Registrar pago ${nombreCliente ? "· " + nombreCliente : ""}</h3>
    <div id="form-error"></div>
    <p class="muted" style="margin-top:-8px;">Saldo pendiente de esta cuota: <b>${money(pendiente)}</b></p>
    <div class="field"><label>Valor a pagar</label><input id="pg-valor" type="number" min="0.01" step="0.01" value="${pendiente}" /></div>
    <div class="field"><label>Notas (opcional)</label><input id="pg-notas" /></div>
    <button class="btn btn-primary btn-block" onclick="guardarPago(${cuotaId})">Confirmar pago</button>
  `);
}

async function guardarPago(cuotaId) {
  const valor = parseFloat(document.getElementById("pg-valor").value);
  const notas = document.getElementById("pg-notas").value.trim();
  if (!valor || valor <= 0) {
    document.getElementById("form-error").innerHTML = `<div class="error-msg">Ingresa un valor válido</div>`;
    return;
  }
  try {
    await api("/pagos", { method: "POST", body: { cuota_id: cuotaId, valor, notas } });
    closeSheet();
    toast("Pago registrado", "success");
    renderCurrentView();
  } catch (e) {
    document.getElementById("form-error").innerHTML = `<div class="error-msg">${e.message}</div>`;
  }
}

// ---------------------------------------------------------------------
// RUTAS
// ---------------------------------------------------------------------
async function viewRutas() {
  const rutas = await api("/rutas");
  state.cache.rutas = rutas;
  return `
    ${topbar("Rutas de cobro", "ajustes")}
    <main class="view">
      <div class="field" style="display:flex;gap:8px;">
        <input id="nr-nombre" placeholder="Nombre de la nueva ruta" style="flex:1;" />
        <button class="btn btn-primary" onclick="crearRuta()">Agregar</button>
      </div>
      ${
        rutas.length === 0
          ? `<div class="empty-state"><div class="icon">🗺️</div><p>Todavía no tienes rutas creadas</p></div>`
          : rutas.map((r) => `
            <div class="list-item">
              <div class="info"><div class="title">${r.nombre}</div></div>
              <button class="btn btn-danger btn-sm" onclick="borrarRuta(${r.id})">Eliminar</button>
            </div>
          `).join("")
      }
    </main>
  `;
}

async function crearRuta() {
  const nombre = document.getElementById("nr-nombre").value.trim();
  if (!nombre) return;
  await api("/rutas", { method: "POST", body: { nombre } });
  toast("Ruta creada", "success");
  state.cache.rutas = null;
  renderCurrentView();
}

async function borrarRuta(id) {
  if (!confirm("¿Eliminar esta ruta? Los clientes quedarán sin ruta asignada.")) return;
  await api(`/rutas/${id}`, { method: "DELETE" });
  state.cache.rutas = null;
  renderCurrentView();
}

// ---------------------------------------------------------------------
// REPORTES
// ---------------------------------------------------------------------
async function viewReportes() {
  const [resumen, recaudo] = await Promise.all([
    api("/reportes/resumen"),
    api("/reportes/recaudo-por-dia"),
  ]);

  const ultimos = recaudo.slice(-14);
  const max = Math.max(1, ...ultimos.map((d) => d.total));

  return `
    ${topbar("Reportes")}
    <main class="view">
      <div class="cards-grid">
        <div class="stat-card accent"><div class="label">Total prestado</div><div class="value">${money(resumen.totalPrestado)}</div></div>
        <div class="stat-card"><div class="label">Por cobrar</div><div class="value">${money(resumen.totalPorCobrar)}</div></div>
        <div class="stat-card warn"><div class="label">En mora</div><div class="value">${money(resumen.moraTotal)}</div></div>
        <div class="stat-card"><div class="label">Ganancia proyectada</div><div class="value">${money(resumen.gananciaProyectada)}</div></div>
      </div>

      <div class="section-title"><span>Recaudo (últimos 14 días)</span></div>
      <div class="card">
        <div class="bar-chart">
          ${ultimos.map((d) => `<div class="bar" title="${d.dia}: ${money(d.total)}"><div class="fill" style="height:${Math.max(4, (d.total / max) * 100)}%"></div></div>`).join("") || `<span class="muted">Sin datos todavía</span>`}
        </div>
      </div>

      <div class="section-title"><span>Totales</span></div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;padding:6px 0;"><span class="muted">Recaudado histórico</span><b>${money(resumen.totalRecaudadoHistorico)}</b></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;"><span class="muted">Clientes activos</span><b>${resumen.clientesActivos}</b></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;"><span class="muted">Préstamos activos</span><b>${resumen.prestamosActivos}</b></div>
      </div>
    </main>
  `;
}

// ---------------------------------------------------------------------
// AJUSTES
// ---------------------------------------------------------------------
async function viewAjustes() {
  return `
    ${topbar("Ajustes")}
    <main class="view">
      <div class="section-title"><span>Cuenta</span></div>
      <div class="card">
        <div style="padding:4px 0;"><span class="muted">Usuario:</span> <b>${state.user.username}</b></div>
      </div>

      <div class="section-title"><span>Organización</span></div>
      <div class="list-item" onclick="go('rutas')">
        <div class="info"><div class="title">Rutas de cobro</div><div class="subtitle">Crear y administrar zonas/rutas</div></div>
        <span>›</span>
      </div>

      <div class="section-title"><span>Seguridad</span></div>
      <div class="card">
        <div id="form-error-pass"></div>
        <div class="field"><label>Contraseña actual</label><input id="ap-actual" type="password" /></div>
        <div class="field"><label>Nueva contraseña</label><input id="ap-nueva" type="password" /></div>
        <button class="btn btn-secondary btn-block" onclick="cambiarPassword()">Cambiar contraseña</button>
      </div>

      <div class="section-title"><span>Copia de seguridad</span></div>
      <div class="card">
        <p class="muted" style="margin-top:0;">Cada día se envía automáticamente una copia completa de tus datos por correo. También puedes enviarla ahora mismo:</p>
        <button class="btn btn-secondary btn-block" onclick="enviarBackupAhora()">Enviar copia de seguridad ahora</button>
      </div>

      <button class="btn btn-danger btn-block" style="margin-top:20px;" onclick="logout()">Cerrar sesión</button>
    </main>
  `;
}

async function cambiarPassword() {
  const passwordActual = document.getElementById("ap-actual").value;
  const passwordNueva = document.getElementById("ap-nueva").value;
  const box = document.getElementById("form-error-pass");
  box.innerHTML = "";
  if (!passwordActual || !passwordNueva) {
    box.innerHTML = `<div class="error-msg">Completa ambos campos</div>`;
    return;
  }
  try {
    await api("/auth/cambiar-password", { method: "POST", body: { passwordActual, passwordNueva } });
    box.innerHTML = `<div class="ok-msg">Contraseña actualizada correctamente</div>`;
    document.getElementById("ap-actual").value = "";
    document.getElementById("ap-nueva").value = "";
  } catch (e) {
    box.innerHTML = `<div class="error-msg">${e.message}</div>`;
  }
}

async function enviarBackupAhora() {
  toast("Enviando copia de seguridad...");
  try {
    const r = await api("/sistema/backup-ahora", { method: "POST" });
    if (r.enviado) toast("Copia de seguridad enviada por correo", "success");
    else toast("No se pudo enviar: " + (r.motivo || "revisa la configuración de correo"), "error");
  } catch (e) {
    toast(e.message, "error");
  }
}

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
window.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("app").innerHTML = `<div class="spinner" style="margin-top:40vh"></div>`;
  await checkSesion();
  render();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }
});
