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

// ---------------------------------------------------------------------
// Puntos de miles al escribir en campos numéricos (monto, valor, etc.)
// Un <input type="number"> del navegador no permite mostrar "1.000.000"
// mientras se escribe (solo acepta dígitos y un punto decimal), así que
// estos campos usan type="text" + esta lógica para dar formato en vivo,
// igual que se ve el dinero en el resto de la app: puntos para los miles,
// coma para los decimales.
function formatearNumero(valorCrudo) {
  let [entero, decimal] = (valorCrudo || "").split(",");
  entero = (entero || "").replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  entero = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (decimal !== undefined) {
    decimal = decimal.replace(/\D/g, "").slice(0, 2);
    return entero + "," + decimal;
  }
  return entero;
}

// Convierte lo que el usuario ve ("1.234.567,89") al número real que hay
// que enviarle al servidor (1234567.89).
function desformatearNumero(valorFormateado) {
  if (!valorFormateado) return NaN;
  return parseFloat(valorFormateado.replace(/\./g, "").replace(",", "."));
}

// Formatea un número (que viene de la base de datos) para dejarlo ya listo
// dentro de un campo editable — sin ",00" de más si es un número entero.
function formatearParaInput(numero) {
  const n = Number(numero);
  if (!Number.isFinite(n)) return "";
  const tieneDecimales = Math.abs(n % 1) > 0.001;
  const texto = n.toFixed(tieneDecimales ? 2 : 0).replace(".", ",");
  return formatearNumero(texto);
}

// Handler de oninput para esos campos: reformatea el texto y trata de
// mantener el cursor en un punto razonable (contando desde el final, que es
// donde casi siempre se está escribiendo o borrando).
function manejarInputMiles(ev) {
  const el = ev.target;
  const distanciaDesdeElFinal = el.value.length - el.selectionStart;
  el.value = formatearNumero(el.value);
  const nuevaPos = Math.max(0, el.value.length - distanciaDesdeElFinal);
  el.setSelectionRange(nuevaPos, nuevaPos);
}

function fechaCorta(fecha) {
  if (!fecha) return "-";
  // Las fechas simples (YYYY-MM-DD) se interpretan como medianoche local.
  // Las que vienen de SQLite con datetime('now') traen fecha y hora
  // separadas por un espacio (ej. "2026-08-23 23:43:40") en vez de "T",
  // y son en UTC — hay que convertirlas al formato ISO real para que
  // Date las entienda en vez de devolver "Invalid Date".
  let iso = fecha;
  if (!iso.includes("T")) {
    iso = iso.includes(" ") ? iso.replace(" ", "T") + "Z" : iso + "T00:00:00";
  }
  const d = new Date(iso);
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

// Los datos de clientes (nombre, dirección, notas...) vienen de formularios
// y se insertan con innerHTML en varias vistas. Sin escapar, un nombre como
// `<img src=x onerror=...>` se ejecutaría como HTML/JS en vez de mostrarse
// como texto. Con un solo usuario administrador el riesgo es bajo, pero es
// una buena práctica no depender de eso.
function escapeHtml(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

// Fecha de "hoy" en hora de Colombia (no en UTC). new Date().toISOString()
// siempre da la fecha en UTC, así que entre las 7pm y la medianoche (hora
// Bogotá) ya "es mañana" para UTC — eso hacía que las cuotas de mañana
// aparecieran como si vencieran hoy, y que la fecha sugerida al crear un
// préstamo se adelantara un día en la noche.
function hoyISO() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Bogota",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Resta días de calendario a una fecha ISO (YYYY-MM-DD). Como ya partimos
// de una fecha calendario correcta (por ejemplo, de hoyISO()), aquí basta
// con aritmética simple de fechas — no hace falta volver a tocar zonas
// horarias.
function restarDiasISO(fechaISO, dias) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d - dias));
  return dt.toISOString().slice(0, 10);
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
  ruta: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M6 8.5V13a4 4 0 0 0 4 4h2a4 4 0 0 1 4 4"/></svg>`,
  empeno: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 3 8.5 12 14l9-5.5L12 3Z"/><path d="M3 8.5V15L12 20.5 21 15V8.5"/><path d="M12 14v6.5"/></svg>`,
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
        ${navItem("empenos", ICONS.empeno, "Empeños")}
        ${navItem("reportes", ICONS.reportes, "Reportes")}
        ${navItem("ajustes", ICONS.ajustes, "Ajustes")}
      </nav>
    </div>
  `;
  renderCurrentView();
}

function navItem(view, icon, label) {
  const raiz = ["dashboard", "agenda", "clientes", "empenos", "reportes", "ajustes"];
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
      case "empenos": html = await viewEmpenos(); break;
      case "empeno-detalle": html = await viewEmpenoDetalle(state.params.id); break;
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
  const raiz = ["dashboard", "agenda", "clientes", "empenos", "reportes", "ajustes"];
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
  const clientesEnMora = new Set(agenda.filter((a) => a.atrasada).map((a) => a.cliente_id)).size;

  return `
    ${topbar("Hola 👋")}
    <main class="view">
      <div class="quick-actions">
        <button class="quick-action" onclick="abrirNuevoCliente()">${ICONS.clientes}<span>Cliente</span></button>
        <button class="quick-action" onclick="abrirNuevoPrestamo()">${ICONS.plus}<span>Préstamo</span></button>
        <button class="quick-action" onclick="go('rutas')">${ICONS.ruta}<span>Rutas</span></button>
      </div>

      <div class="cards-grid">
        <div class="stat-card accent">
          <div class="label">Recaudado hoy</div>
          <div class="value">${money(resumen.recaudadoHoy)}</div>
        </div>
        <div class="stat-card ${resumen.moraTotal > 0 ? "warn" : ""}">
          <div class="label">En mora</div>
          <div class="value">${money(resumen.moraTotal)}</div>
          ${clientesEnMora > 0 ? `<div class="sublabel">${clientesEnMora} cliente${clientesEnMora === 1 ? "" : "s"}</div>` : ""}
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
      <div class="avatar">${escapeHtml(iniciales(c.cliente_nombre))}</div>
      <div class="info">
        <div class="title">${escapeHtml(c.cliente_nombre)}</div>
        <div class="subtitle">${escapeHtml(c.ruta_nombre) || "Sin ruta"} · Cuota #${c.numero} · ${fechaCorta(c.fecha_vencimiento)}</div>
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

  // El filtro por ruta solo tiene sentido si ya existe al menos una ruta
  // creada (Ajustes → Rutas de cobro). Mientras no la usen, no se muestra
  // un select vacío que no hace nada; en cuanto creen la primera ruta,
  // este filtro reaparece solo, sin tocar nada de código.
  const filtros = `<option value="">Todas las rutas</option>` +
    rutas.map((r) => `<option value="${r.id}" ${String(r.id) === String(rutaId) ? "selected" : ""}>${escapeHtml(r.nombre)}</option>`).join("");

  const deHoy = agenda.filter((c) => !c.atrasada);
  const atrasados = agenda.filter((c) => c.atrasada);

  const filaCuota = (c) => `
    <div class="list-item">
      <div class="avatar">${escapeHtml(iniciales(c.cliente_nombre))}</div>
      <div class="info" onclick="go('cliente-detalle', {id: ${c.cliente_id}})">
        <div class="title">${escapeHtml(c.cliente_nombre)}</div>
        <div class="subtitle">${escapeHtml(c.direccion || c.telefono || "")} · Cuota #${c.numero}</div>
        <span class="badge ${c.atrasada ? "atrasada" : "pendiente"}">${c.atrasada ? "Atrasada · " + fechaCorta(c.fecha_vencimiento) : "Vence hoy"}</span>
      </div>
      <div style="text-align:right;">
        <div class="amount debt">${money(c.valor - c.valor_pagado)}</div>
        <button class="btn btn-primary btn-sm" style="margin-top:6px;" onclick="abrirRegistrarPago(${c.id}, ${c.valor - c.valor_pagado}, '${(c.cliente_nombre || "").replace(/['"\\]/g, "")}')">Cobrar</button>
      </div>
    </div>
  `;

  return `
    ${topbar("Agenda de cobro")}
    <main class="view">
      ${
        rutas.length > 0
          ? `<div class="field"><select onchange="go('agenda', {ruta_id: this.value})">${filtros}</select></div>`
          : ""
      }
      ${
        agenda.length === 0
          ? `<div class="empty-state"><div class="icon">✅</div><p>No hay cuotas pendientes${rutaId ? " en esta ruta" : ""}</p></div>`
          : `
            <div class="section-title"><span>Hoy</span><span class="muted">${deHoy.length}</span></div>
            ${
              deHoy.length === 0
                ? `<div class="empty-state" style="padding:16px 0;"><p>Ningún pago programado para hoy${rutaId ? " en esta ruta" : ""}</p></div>`
                : deHoy.map(filaCuota).join("")
            }

            <div class="section-title" style="margin-top:20px;"><span>Atrasados</span><span class="muted">${atrasados.length}</span></div>
            ${
              atrasados.length === 0
                ? `<div class="empty-state" style="padding:16px 0;"><p>Ningún cliente atrasado${rutaId ? " en esta ruta" : ""} 🎉</p></div>`
                : atrasados.map(filaCuota).join("")
            }
          `
      }
    </main>
  `;
}

// ---------------------------------------------------------------------
// CLIENTES
// ---------------------------------------------------------------------
// Aplica los 3 filtros (texto, ruta, estado) sobre la lista completa de
// clientes ya cargada. Se usa tanto al entrar a la pestaña como al escribir
// en el buscador (filtrarClientes), para no tener que volver a pedirle la
// lista al servidor cada vez.
function aplicarFiltrosClientes(clientes, { q, ruta_id, estado }) {
  const qNorm = (q || "").toLowerCase();
  let filtrados = clientes;
  if (qNorm) {
    filtrados = filtrados.filter((c) => c.nombre.toLowerCase().includes(qNorm) || (c.telefono || "").includes(qNorm));
  }
  if (ruta_id) {
    filtrados = filtrados.filter((c) => String(c.ruta_id) === String(ruta_id));
  }
  // "En mora" es SOLO el que tiene cuotas ya vencidas sin pagar. Un cliente
  // con un préstamo activo pero que va pagando a tiempo (todavía no le
  // vence nada) no está en mora — está "Activo" — aunque técnicamente
  // todavía deba plata (las cuotas futuras). Antes se mezclaban los dos.
  if (estado === "mora") {
    filtrados = filtrados.filter((c) => c.deuda_atrasada > 0);
  } else if (estado === "activo") {
    filtrados = filtrados.filter((c) => c.deuda_pendiente > 0 && !(c.deuda_atrasada > 0));
  } else if (estado === "al_dia") {
    filtrados = filtrados.filter((c) => c.deuda_pendiente <= 0);
  }
  return filtrados;
}

function estadoClienteBadge(c) {
  if (c.deuda_atrasada > 0) return `<span class="badge atrasada">En mora</span>`;
  if (c.deuda_pendiente > 0) return `<span class="badge activo">Activo</span>`;
  return "";
}

function renderListaClientes(filtrados, totalClientes) {
  return filtrados.length === 0
    ? `<div class="empty-state"><div class="icon">👤</div><p>${totalClientes === 0 ? "Todavía no tienes clientes" : "No se encontraron clientes con ese filtro"}</p></div>`
    : filtrados.map((c) => `
        <div class="list-item" onclick="go('cliente-detalle', {id: ${c.id}})">
          <div class="avatar">${escapeHtml(iniciales(c.nombre))}</div>
          <div class="info">
            <div class="title">${escapeHtml(c.nombre)}</div>
            <div class="subtitle">${escapeHtml(c.ruta_nombre) || "Sin ruta"} ${c.telefono ? "· " + escapeHtml(c.telefono) : ""}</div>
            ${estadoClienteBadge(c)}
          </div>
          <div class="amount ${c.deuda_pendiente > 0 ? "debt" : "ok"}">${c.deuda_pendiente > 0 ? money(c.deuda_pendiente) : "Al día"}</div>
        </div>
      `).join("");
}

async function viewClientes() {
  const [clientes, rutas] = await Promise.all([api("/clientes"), api("/rutas")]);
  state.cache.clientes = clientes;
  state.cache.rutas = rutas;

  const q = state.params.q || "";
  const rutaId = state.params.ruta_id || "";
  const estadoFiltro = state.params.estado || ""; // "" | "mora" | "al_dia"

  const filtrados = aplicarFiltrosClientes(clientes, { q, ruta_id: rutaId, estado: estadoFiltro });

  const enMora = clientes.filter((c) => c.deuda_atrasada > 0).length;
  const carteraTotal = clientes.reduce((s, c) => s + c.deuda_pendiente, 0);

  return `
    ${topbar("Clientes")}
    <main class="view">
      <div class="cards-grid">
        <div class="stat-card">
          <div class="label">Clientes activos</div>
          <div class="value">${clientes.length}</div>
        </div>
        <div class="stat-card ${enMora > 0 ? "warn" : ""}">
          <div class="label">En mora</div>
          <div class="value">${enMora}</div>
        </div>
        <div class="stat-card" style="grid-column: span 2;">
          <div class="label">Cartera pendiente</div>
          <div class="value">${money(carteraTotal)}</div>
        </div>
      </div>

      <div class="search-bar">
        <span class="muted">🔎</span>
        <input id="cf-q" placeholder="Buscar cliente..." value="${escapeHtml(state.params.q || "")}" oninput="filtrarClientes()" />
      </div>

      <div class="row-2" style="margin-bottom:14px;">
        ${
          rutas.length > 0
            ? `<select id="cf-ruta" onchange="filtrarClientes()">
                <option value="" ${!rutaId ? "selected" : ""}>Todas las rutas</option>
                ${rutas.map((r) => `<option value="${r.id}" ${String(r.id) === String(rutaId) ? "selected" : ""}>${escapeHtml(r.nombre)}</option>`).join("")}
              </select>`
            : `<span></span>`
        }
        <select id="cf-estado" onchange="filtrarClientes()">
          <option value="" ${!estadoFiltro ? "selected" : ""}>Todos los estados</option>
          <option value="mora" ${estadoFiltro === "mora" ? "selected" : ""}>En mora</option>
          <option value="activo" ${estadoFiltro === "activo" ? "selected" : ""}>Activos (al corriente)</option>
          <option value="al_dia" ${estadoFiltro === "al_dia" ? "selected" : ""}>Al día (sin deuda)</option>
        </select>
      </div>

      <div id="clientes-lista">${renderListaClientes(filtrados, clientes.length)}</div>
    </main>
    <button class="fab" onclick="abrirNuevoCliente()">${ICONS.plus}</button>
  `;
}

// IMPORTANTE: esto NO llama a go()/renderCurrentView(). Antes sí lo hacía, y
// como eso reconstruye toda la página (incluido el propio buscador) en cada
// letra que se escribía, el campo perdía el foco al instante — parecía que
// "la página se actualizaba sola" y no dejaba seguir escribiendo. Ahora solo
// se recalcula el filtro sobre los clientes que ya están en memoria y se
// reemplaza únicamente la lista de resultados; el buscador y los selects no
// se tocan, así que el cursor y el foco se quedan donde estaban.
function filtrarClientes() {
  const q = document.getElementById("cf-q").value;
  const rutaSel = document.getElementById("cf-ruta");
  const ruta_id = rutaSel ? rutaSel.value : "";
  const estado = document.getElementById("cf-estado").value;

  // Se guarda en state.params (sin re-renderizar) para que si el usuario
  // sale de Clientes y vuelve, encuentre el mismo filtro que dejó.
  state.params = { q, ruta_id, estado };

  const clientes = state.cache.clientes || [];
  const filtrados = aplicarFiltrosClientes(clientes, { q, ruta_id, estado });
  document.getElementById("clientes-lista").innerHTML = renderListaClientes(filtrados, clientes.length);
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
        ${rutas.map((r) => `<option value="${r.id}">${escapeHtml(r.nombre)}</option>`).join("")}
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

async function abrirEditarCliente(id) {
  const [cliente, rutas] = await Promise.all([
    api(`/clientes/${id}`),
    state.cache.rutas || api("/rutas"),
  ]);
  state.cache.rutas = rutas;
  openSheet(`
    <h3>Editar cliente</h3>
    <div id="form-error"></div>
    <div class="field"><label>Nombre completo *</label><input id="ec-nombre" value="${escapeHtml(cliente.nombre)}" required /></div>
    <div class="row-2">
      <div class="field"><label>Teléfono</label><input id="ec-telefono" value="${escapeHtml(cliente.telefono || "")}" /></div>
      <div class="field"><label>Identificación (opcional)</label><input id="ec-id" value="${escapeHtml(cliente.identificacion || "")}" /></div>
    </div>
    <div class="field"><label>Dirección</label><input id="ec-direccion" value="${escapeHtml(cliente.direccion || "")}" /></div>
    <div class="field">
      <label>Ruta de cobro (opcional)</label>
      <select id="ec-ruta">
        <option value="">Sin ruta</option>
        ${rutas.map((r) => `<option value="${r.id}" ${String(r.id) === String(cliente.ruta_id) ? "selected" : ""}>${escapeHtml(r.nombre)}</option>`).join("")}
      </select>
    </div>
    <div class="field"><label>Notas</label><textarea id="ec-notas" rows="2">${escapeHtml(cliente.notas || "")}</textarea></div>
    <button class="btn btn-primary btn-block" onclick="guardarEdicionCliente(${id})">Guardar cambios</button>
  `);
}

async function guardarEdicionCliente(id) {
  const nombre = document.getElementById("ec-nombre").value.trim();
  if (!nombre) {
    document.getElementById("form-error").innerHTML = `<div class="error-msg">El nombre es obligatorio</div>`;
    return;
  }
  try {
    await api(`/clientes/${id}`, {
      method: "PUT",
      body: {
        nombre,
        telefono: document.getElementById("ec-telefono").value.trim(),
        identificacion: document.getElementById("ec-id").value.trim(),
        direccion: document.getElementById("ec-direccion").value.trim(),
        ruta_id: document.getElementById("ec-ruta").value || null,
        notas: document.getElementById("ec-notas").value.trim(),
      },
    });
    closeSheet();
    state.cache.clientes = null;
    toast("Cliente actualizado", "success");
    renderCurrentView();
  } catch (e) {
    document.getElementById("form-error").innerHTML = `<div class="error-msg">${e.message}</div>`;
  }
}

async function viewClienteDetalle(id) {
  const cliente = await api(`/clientes/${id}`);
  const prestamosActivos = cliente.prestamos.filter((p) => p.estado === "activo");
  const otros = cliente.prestamos.filter((p) => p.estado !== "activo");
  const empenosActivos = cliente.empenos.filter((e) => e.estado === "activo");
  const empenosHistorial = cliente.empenos.filter((e) => e.estado !== "activo");

  return `
    ${topbar(escapeHtml(cliente.nombre), "clientes")}
    <main class="view">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;">
          <div style="flex:1;">
            ${cliente.telefono ? `<div style="padding:4px 0;"><span class="muted">Teléfono:</span> ${escapeHtml(cliente.telefono)}</div>` : ""}
            ${cliente.direccion ? `<div style="padding:4px 0;"><span class="muted">Dirección:</span> ${escapeHtml(cliente.direccion)}</div>` : ""}
            ${cliente.identificacion ? `<div style="padding:4px 0;"><span class="muted">Identificación:</span> ${escapeHtml(cliente.identificacion)}</div>` : ""}
            ${cliente.notas ? `<div style="padding:4px 0;"><span class="muted">Notas:</span> ${escapeHtml(cliente.notas)}</div>` : ""}
          </div>
          <button class="btn-edit-fecha" title="Editar cliente" onclick="abrirEditarCliente(${cliente.id})">✏️</button>
        </div>
      </div>

      <button class="btn btn-primary btn-block" onclick="abrirNuevoPrestamo(${cliente.id})">+ Nuevo préstamo para ${escapeHtml(cliente.nombre.split(" ")[0])}</button>

      <div class="section-title"><span>Préstamos activos</span></div>
      ${
        prestamosActivos.length === 0
          ? `<p class="muted">Sin préstamos activos</p>`
          : prestamosActivos.map(prestamoListItem).join("")
      }

      ${
        otros.length
          ? `<div class="section-title"><span>Historial de préstamos</span></div>` + otros.map(prestamoListItem).join("")
          : ""
      }

      <button class="btn btn-secondary btn-block" style="margin-top:22px;" onclick="abrirNuevoEmpeno(${cliente.id})">+ Nuevo empeño para ${escapeHtml(cliente.nombre.split(" ")[0])}</button>

      <div class="section-title"><span>Empeños activos</span></div>
      ${
        empenosActivos.length === 0
          ? `<p class="muted">Sin empeños activos</p>`
          : empenosActivos.map((e) => empenoListItem(e, false)).join("")
      }

      ${
        empenosHistorial.length
          ? `<div class="section-title"><span>Historial de empeños</span></div>` + empenosHistorial.map((e) => empenoListItem(e, false)).join("")
          : ""
      }

      <button class="btn btn-danger btn-block" style="margin-top:24px;" onclick="eliminarCliente(${cliente.id}, ${prestamosActivos.length})">Eliminar cliente</button>
    </main>
  `;
}

async function eliminarCliente(id, tienePrestamosActivos) {
  const advertencia = tienePrestamosActivos
    ? "Este cliente tiene préstamos activos. Si lo eliminas, dejará de aparecer en tu lista de clientes (pero el historial de sus préstamos y pagos se conserva). ¿Seguro que quieres eliminarlo?"
    : "¿Seguro que quieres eliminar este cliente? Dejará de aparecer en tu lista de clientes.";
  if (!confirm(advertencia)) return;
  try {
    await api(`/clientes/${id}`, { method: "DELETE" });
    state.cache.clientes = null;
    toast("Cliente eliminado", "success");
    go("clientes");
  } catch (e) {
    toast(e.message, "error");
  }
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

  if (clientes.length === 0) {
    openSheet(`
      <h3>Nuevo préstamo</h3>
      <div class="empty-state">
        <div class="icon">👤</div>
        <p>Todavía no tienes ningún cliente. Crea uno primero y luego podrás registrarle un préstamo.</p>
      </div>
      <button class="btn btn-primary btn-block" onclick="closeSheet(); go('clientes'); setTimeout(abrirNuevoCliente, 150);">+ Crear cliente</button>
    `);
    return;
  }

  openSheet(`
    <h3>Nuevo préstamo</h3>
    <div id="form-error"></div>
    <div class="field">
      <label>Cliente *</label>
      <select id="np-cliente">
        ${clientes.map((c) => `<option value="${c.id}" ${clienteIdPreseleccionado == c.id ? "selected" : ""}>${escapeHtml(c.nombre)}</option>`).join("")}
      </select>
    </div>
    <div class="row-2">
      <div class="field"><label>Monto prestado *</label><input id="np-monto" type="text" inputmode="decimal" oninput="manejarInputMiles(event)" required /></div>
      <div class="field"><label>Tasa de interés (%) *</label><input id="np-tasa" type="text" inputmode="decimal" oninput="manejarInputMiles(event)" required /></div>
    </div>
    <div class="field">
      <label>Tipo de interés</label>
      <select id="np-tipo">
        <option value="fijo">Fijo (tasa total del préstamo, ej. 20% = 20% una sola vez)</option>
        <option value="saldo">Sobre saldo (tasa por cada cuota, tipo bancario)</option>
        <option value="capitalizado">Capitalizado (tasa por cuota, se acumula si hay mora)</option>
      </select>
      <p class="muted" style="font-size:12px;margin:6px 0 0;">En "Fijo" la tasa se cobra una sola vez sobre todo el préstamo (100.000 al 20% = 120.000 en total). En "Sobre saldo" y "Capitalizado" la tasa se cobra en cada cuota sobre el saldo pendiente.</p>
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
      <div class="field"><label>Número de cuotas *</label><input id="np-cuotas" type="text" inputmode="numeric" oninput="manejarInputMiles(event)" required /></div>
    </div>
    <div class="field"><label>Fecha de inicio *</label><input id="np-fecha" type="date" value="${hoyISO()}" required /></div>
    <div class="field"><label>Notas</label><textarea id="np-notas" rows="2"></textarea></div>
    <div id="np-preview" class="muted" style="font-size:13px;margin-bottom:12px;"></div>
    <button class="btn btn-primary btn-block" onclick="guardarPrestamo()">Crear préstamo</button>
  `);
}

async function guardarPrestamo() {
  const cliente_id = document.getElementById("np-cliente").value;
  const monto = desformatearNumero(document.getElementById("np-monto").value);
  const tasa_interes = desformatearNumero(document.getElementById("np-tasa").value);
  const tipo_interes = document.getElementById("np-tipo").value;
  const frecuencia = document.getElementById("np-frecuencia").value;
  const num_cuotas = parseInt(desformatearNumero(document.getElementById("np-cuotas").value), 10);
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
            <div class="title" style="font-size:17px;font-weight:700;">${escapeHtml(p.cliente.nombre)}</div>
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
        <div class="title">
          Cuota #${c.numero} · ${fechaCorta(c.fecha_vencimiento)}
          <button class="btn-edit-fecha" title="Editar fecha" onclick="abrirEditarFecha(${prestamo.id}, ${c.id}, '${c.fecha_vencimiento}', ${c.numero})">✏️</button>
        </div>
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

function abrirEditarFecha(prestamoId, cuotaId, fechaActual, numero) {
  openSheet(`
    <h3>Editar fecha · Cuota #${numero}</h3>
    <div id="form-error"></div>
    <p class="muted" style="margin-top:-8px;">Las cuotas siguientes se recalculan solas a partir de esta nueva fecha, respetando la frecuencia del préstamo.</p>
    <div class="field"><label>Nueva fecha de vencimiento</label><input id="ef-fecha" type="date" value="${fechaActual}" /></div>
    <button class="btn btn-primary btn-block" onclick="guardarFechaCuota(${prestamoId}, ${cuotaId})">Guardar fecha</button>
  `);
}

async function guardarFechaCuota(prestamoId, cuotaId) {
  const fecha_vencimiento = document.getElementById("ef-fecha").value;
  if (!fecha_vencimiento) {
    document.getElementById("form-error").innerHTML = `<div class="error-msg">Elige una fecha</div>`;
    return;
  }
  try {
    await api(`/prestamos/${prestamoId}/cuotas/${cuotaId}/fecha`, {
      method: "PUT",
      body: { fecha_vencimiento },
    });
    closeSheet();
    toast("Fecha actualizada", "success");
    renderCurrentView();
  } catch (e) {
    document.getElementById("form-error").innerHTML = `<div class="error-msg">${e.message}</div>`;
  }
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
    <div class="field"><label>Valor a pagar</label><input id="pg-valor" type="text" inputmode="decimal" oninput="manejarInputMiles(event)" value="${formatearParaInput(pendiente)}" /></div>
    <div class="field"><label>Notas (opcional)</label><input id="pg-notas" /></div>
    <button class="btn btn-primary btn-block" onclick="guardarPago(${cuotaId})">Confirmar pago</button>
  `);
}

async function guardarPago(cuotaId) {
  const valor = desformatearNumero(document.getElementById("pg-valor").value);
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
// EMPEÑOS (dinero prestado bajo prenda — aparte de los préstamos, este
// dinero nunca se mezcla con el de arriba: tiene su propia tabla, su
// propia ruta de API y su propia pantalla).
// ---------------------------------------------------------------------
async function viewEmpenos() {
  const [empenos, resumen] = await Promise.all([
    api("/empenos"),
    api("/empenos/reportes/resumen"),
  ]);
  const activos = empenos.filter((e) => e.estado === "activo");
  const historial = empenos.filter((e) => e.estado !== "activo");

  return `
    ${topbar("Empeños")}
    <main class="view">
      <div class="cards-grid">
        <div class="stat-card accent">
          <div class="label">Capital en empeños</div>
          <div class="value">${money(resumen.capitalActivo)}</div>
        </div>
        <div class="stat-card ${resumen.atrasados > 0 ? "warn" : ""}">
          <div class="label">Atrasados</div>
          <div class="value">${resumen.atrasados}</div>
        </div>
        <div class="stat-card">
          <div class="label">Empeños activos</div>
          <div class="value">${resumen.empenosActivos}</div>
        </div>
        <div class="stat-card">
          <div class="label">Interés cobrado</div>
          <div class="value">${money(resumen.interesCobradoHistorico)}</div>
        </div>
      </div>

      <p class="muted" style="font-size:12px;margin:2px 0 14px;">Este dinero es aparte de los préstamos: aquí solo se cobra el interés mensual fijo por guardar la prenda. El valor de la prenda se paga completo cuando el cliente la rescata.</p>

      <div class="section-title"><span>Activos (${activos.length})</span></div>
      ${
        activos.length === 0
          ? `<div class="empty-state"><div class="icon">🪙</div><p>Todavía no tienes empeños activos</p></div>`
          : activos.map((e) => empenoListItem(e)).join("")
      }

      ${
        historial.length
          ? `<div class="section-title"><span>Historial</span></div>` + historial.map((e) => empenoListItem(e)).join("")
          : ""
      }
    </main>
    <button class="fab" onclick="abrirNuevoEmpeno()">${ICONS.plus}</button>
  `;
}

// mostrarCliente=false se usa en la ficha del cliente, donde el nombre ya
// está de sobra (es la pantalla de ese mismo cliente).
function empenoListItem(e, mostrarCliente = true) {
  const estado = e.estado === "activo" && e.atrasado ? "atrasada" : e.estado;
  const estadoTexto =
    e.estado === "activo" ? (e.atrasado ? "Atrasado" : "Activo") : e.estado === "pagado" ? "Pagado" : "Cancelado";
  const detalle = mostrarCliente ? `${escapeHtml(e.cliente_nombre)} · interés ${money(e.interes_mensual)}/mes` : `Interés ${money(e.interes_mensual)}/mes`;
  return `
    <div class="list-item" onclick="go('empeno-detalle', {id: ${e.id}})">
      <div class="info">
        <div class="title">${escapeHtml(e.descripcion)}</div>
        <div class="subtitle">${detalle}${e.estado === "activo" ? " · vence " + fechaCorta(e.fecha_proximo_pago) : ""}</div>
      </div>
      <div style="text-align:right;">
        <div class="amount">${money(e.valor)}</div>
        <span class="badge ${estado}">${estadoTexto}</span>
      </div>
    </div>
  `;
}

async function abrirNuevoEmpeno(clienteIdPreseleccionado) {
  const clientes = state.cache.clientes || (await api("/clientes"));
  state.cache.clientes = clientes;

  if (clientes.length === 0) {
    openSheet(`
      <h3>Nuevo empeño</h3>
      <div class="empty-state">
        <div class="icon">👤</div>
        <p>Todavía no tienes ningún cliente. Crea uno primero y luego podrás registrarle un empeño.</p>
      </div>
      <button class="btn btn-primary btn-block" onclick="closeSheet(); go('clientes'); setTimeout(abrirNuevoCliente, 150);">+ Crear cliente</button>
    `);
    return;
  }

  openSheet(`
    <h3>Nuevo empeño</h3>
    <div id="form-error"></div>
    <div class="field">
      <label>Cliente *</label>
      <select id="ne-cliente">
        ${clientes.map((c) => `<option value="${c.id}" ${clienteIdPreseleccionado == c.id ? "selected" : ""}>${escapeHtml(c.nombre)}</option>`).join("")}
      </select>
    </div>
    <div class="field"><label>¿Qué dejó empeñado? *</label><input id="ne-descripcion" placeholder="Ej. Cadena de oro, TV 42 pulgadas..." required /></div>
    <div class="row-2">
      <div class="field"><label>Valor de la prenda *</label><input id="ne-valor" type="text" inputmode="decimal" oninput="manejarInputMiles(event)" required /></div>
      <div class="field"><label>Interés mensual *</label><input id="ne-interes" type="text" inputmode="decimal" oninput="manejarInputMiles(event)" required /></div>
    </div>
    <p class="muted" style="font-size:12px;margin:-6px 0 0;">El interés es un valor fijo en pesos que el cliente paga cada mes para mantener la prenda (no se calcula como porcentaje).</p>
    <div class="field"><label>Fecha de inicio *</label><input id="ne-fecha" type="date" value="${hoyISO()}" required /></div>
    <div class="field"><label>Notas</label><textarea id="ne-notas" rows="2"></textarea></div>
    <button class="btn btn-primary btn-block" onclick="guardarEmpeno()">Guardar empeño</button>
  `);
}

async function guardarEmpeno() {
  const cliente_id = document.getElementById("ne-cliente").value;
  const descripcion = document.getElementById("ne-descripcion").value.trim();
  const valor = desformatearNumero(document.getElementById("ne-valor").value);
  const interes_mensual = desformatearNumero(document.getElementById("ne-interes").value);
  const fecha_inicio = document.getElementById("ne-fecha").value;
  const notas = document.getElementById("ne-notas").value.trim();

  if (!cliente_id || !descripcion || !valor || !interes_mensual || !fecha_inicio) {
    document.getElementById("form-error").innerHTML = `<div class="error-msg">Completa todos los campos obligatorios (*)</div>`;
    return;
  }
  try {
    await api("/empenos", {
      method: "POST",
      body: { cliente_id, descripcion, valor, interes_mensual, fecha_inicio, notas },
    });
    closeSheet();
    toast("Empeño guardado", "success");
    go("empenos");
  } catch (e) {
    document.getElementById("form-error").innerHTML = `<div class="error-msg">${e.message}</div>`;
  }
}

async function viewEmpenoDetalle(id) {
  const e = await api(`/empenos/${id}`);
  const estado = e.estado === "activo" && e.atrasado ? "atrasada" : e.estado;
  const estadoTexto =
    e.estado === "activo" ? (e.atrasado ? "Atrasado" : "Activo") : e.estado === "pagado" ? "Pagado" : "Cancelado";

  return `
    ${topbar("Empeño", "empenos")}
    <main class="view">
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div class="title" style="font-size:17px;font-weight:700;">${escapeHtml(e.descripcion)}</div>
            <div class="subtitle muted">${escapeHtml(e.cliente_nombre)}${e.telefono ? " · " + escapeHtml(e.telefono) : ""}</div>
          </div>
          <span class="badge ${estado}">${estadoTexto}</span>
        </div>
        <div style="display:flex;justify-content:space-between;padding:10px 0 4px;">
          <span class="muted">Valor de la prenda</span><b>${money(e.valor)}</b>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;">
          <span class="muted">Interés mensual</span><b>${money(e.interes_mensual)}</b>
        </div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;">
          <span class="muted">Empeñado desde</span><b>${fechaCorta(e.fecha_inicio)}</b>
        </div>
        ${
          e.estado === "activo"
            ? `<div style="display:flex;justify-content:space-between;padding:4px 0;">
                <span class="muted">Próximo pago de interés</span><b>${fechaCorta(e.fecha_proximo_pago)}</b>
              </div>`
            : ""
        }
        ${e.notas ? `<div style="padding:4px 0;"><span class="muted">Notas:</span> ${escapeHtml(e.notas)}</div>` : ""}
      </div>

      ${
        e.estado === "activo"
          ? `
            <button class="btn btn-primary btn-block" onclick="abrirPagoInteresEmpeno(${e.id}, ${e.interes_mensual})">Registrar pago de interés</button>
            <button class="btn btn-secondary btn-block" style="margin-top:10px;" onclick="rescatarEmpeno(${e.id})">Rescatar prenda (pagar todo)</button>
            <button class="btn btn-danger btn-block" style="margin-top:10px;" onclick="cancelarEmpeno(${e.id})">Cancelar (prenda perdida)</button>
          `
          : ""
      }

      <div class="section-title"><span>Historial de pagos</span></div>
      ${
        e.pagos.length === 0
          ? `<p class="muted">Todavía no hay pagos registrados</p>`
          : e.pagos
              .map(
                (p) => `
            <div class="list-item">
              <div class="info">
                <div class="title">${p.tipo === "interes" ? "Pago de interés" : "Rescate de la prenda"}</div>
                <div class="subtitle">${fechaCorta(p.fecha)}${p.notas ? " · " + escapeHtml(p.notas) : ""}</div>
              </div>
              <div style="text-align:right;">
                <div class="amount ok">${money(p.valor)}</div>
                <button class="btn-edit-fecha" title="Deshacer pago" onclick="deshacerPagoEmpeno(${p.id})">↩️</button>
              </div>
            </div>
          `
              )
              .join("")
      }
    </main>
  `;
}

function abrirPagoInteresEmpeno(empenoId, interesMensual) {
  openSheet(`
    <h3>Pago de interés</h3>
    <div id="form-error"></div>
    <p class="muted" style="margin-top:-8px;">Interés mensual de este empeño: <b>${money(interesMensual)}</b></p>
    <div class="field"><label>Valor a pagar</label><input id="pie-valor" type="text" inputmode="decimal" oninput="manejarInputMiles(event)" value="${formatearParaInput(interesMensual)}" /></div>
    <div class="field"><label>Notas (opcional)</label><input id="pie-notas" /></div>
    <button class="btn btn-primary btn-block" onclick="guardarPagoInteresEmpeno(${empenoId})">Confirmar pago</button>
  `);
}

async function guardarPagoInteresEmpeno(empenoId) {
  const valor = desformatearNumero(document.getElementById("pie-valor").value);
  const notas = document.getElementById("pie-notas").value.trim();
  if (!valor || valor <= 0) {
    document.getElementById("form-error").innerHTML = `<div class="error-msg">Ingresa un valor válido</div>`;
    return;
  }
  try {
    await api(`/empenos/${empenoId}/pago-interes`, { method: "POST", body: { valor, notas } });
    closeSheet();
    toast("Pago de interés registrado", "success");
    renderCurrentView();
  } catch (e) {
    document.getElementById("form-error").innerHTML = `<div class="error-msg">${e.message}</div>`;
  }
}

async function rescatarEmpeno(id) {
  if (!confirm("¿Confirmas que el cliente pagó el valor completo de la prenda y se la lleva? No se cobrará el interés de este mes.")) return;
  try {
    await api(`/empenos/${id}/rescatar`, { method: "POST" });
    toast("Prenda rescatada", "success");
    renderCurrentView();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function cancelarEmpeno(id) {
  if (!confirm("¿Seguro que quieres cancelar este empeño? Se marcará como que la prenda se perdió o se remató.")) return;
  try {
    await api(`/empenos/${id}/cancelar`, { method: "PUT" });
    toast("Empeño cancelado");
    renderCurrentView();
  } catch (e) {
    toast(e.message, "error");
  }
}

async function deshacerPagoEmpeno(pagoId) {
  if (!confirm("¿Deshacer este pago? Se eliminará del historial y se ajustará la fecha o el estado del empeño.")) return;
  try {
    await api(`/empenos/pagos/${pagoId}`, { method: "DELETE" });
    toast("Pago deshecho");
    renderCurrentView();
  } catch (e) {
    toast(e.message, "error");
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
              <div class="info"><div class="title">${escapeHtml(r.nombre)}</div></div>
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
  const rango = parseInt(state.params.rango, 10) || 14;
  const hoy = hoyISO();
  const desde = restarDiasISO(hoy, rango);
  const rangosDisponibles = [7, 14, 30, 90];

  const [resumen, recaudo, enMora, empenosResumen] = await Promise.all([
    api("/reportes/resumen"),
    api(`/reportes/recaudo-por-dia?desde=${desde}&hasta=${hoy}`),
    api("/reportes/clientes-en-mora"),
    api("/empenos/reportes/resumen"),
  ]);

  const max = Math.max(1, ...recaudo.map((d) => d.total));

  return `
    ${topbar("Reportes")}
    <main class="view">
      <div class="cards-grid">
        <div class="stat-card accent"><div class="label">Total prestado</div><div class="value">${money(resumen.totalPrestado)}</div></div>
        <div class="stat-card"><div class="label">Por cobrar</div><div class="value">${money(resumen.totalPorCobrar)}</div></div>
        <div class="stat-card warn"><div class="label">En mora</div><div class="value">${money(resumen.moraTotal)}</div></div>
        <div class="stat-card"><div class="label">Ganancia proyectada</div><div class="value">${money(resumen.gananciaProyectada)}</div></div>
      </div>

      <div class="section-title"><span>Recaudo</span></div>
      <div class="range-selector">
        ${rangosDisponibles.map((r) => `<button class="range-chip ${rango === r ? "active" : ""}" onclick="go('reportes', {rango: ${r}})">${r}d</button>`).join("")}
      </div>
      <div class="card">
        <div class="bar-chart">
          ${recaudo.map((d) => `<div class="bar" title="${d.dia}: ${money(d.total)}"><div class="fill" style="height:${Math.max(4, (d.total / max) * 100)}%"></div></div>`).join("") || `<span class="muted">Sin datos todavía en este rango</span>`}
        </div>
      </div>

      <div class="section-title"><span>Clientes en mora</span></div>
      ${
        enMora.length === 0
          ? `<div class="empty-state"><div class="icon">✅</div><p>Ningún cliente está en mora</p></div>`
          : enMora
              .map(
                (c) => `
            <div class="list-item" onclick="go('cliente-detalle', {id: ${c.id}})">
              <div class="avatar">${escapeHtml(iniciales(c.nombre))}</div>
              <div class="info">
                <div class="title">${escapeHtml(c.nombre)}</div>
                <div class="subtitle">${c.cuotas_atrasadas} cuota${c.cuotas_atrasadas === 1 ? "" : "s"} atrasada${c.cuotas_atrasadas === 1 ? "" : "s"}${c.telefono ? " · " + escapeHtml(c.telefono) : ""}</div>
              </div>
              <div class="amount debt">${money(c.deuda)}</div>
            </div>
          `
              )
              .join("")
      }

      <div class="section-title"><span>Totales</span></div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;padding:6px 0;"><span class="muted">Recaudado histórico</span><b>${money(resumen.totalRecaudadoHistorico)}</b></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;"><span class="muted">Clientes activos</span><b>${resumen.clientesActivos}</b></div>
        <div style="display:flex;justify-content:space-between;padding:6px 0;"><span class="muted">Préstamos activos</span><b>${resumen.prestamosActivos}</b></div>
      </div>

      <div class="section-title"><span>Empeños</span></div>
      <p class="muted" style="font-size:12px;margin:-6px 0 12px;">Este dinero es aparte de los préstamos — aquí solo se muestra para tener el panorama completo en un mismo lugar, sin mezclarse con los totales de arriba.</p>
      <div class="cards-grid">
        <div class="stat-card"><div class="label">Capital en empeños</div><div class="value">${money(empenosResumen.capitalActivo)}</div></div>
        <div class="stat-card ${empenosResumen.atrasados > 0 ? "warn" : ""}"><div class="label">Atrasados</div><div class="value">${empenosResumen.atrasados}</div></div>
        <div class="stat-card"><div class="label">Empeños activos</div><div class="value">${empenosResumen.empenosActivos}</div></div>
        <div class="stat-card"><div class="label">Interés cobrado</div><div class="value">${money(empenosResumen.interesCobradoHistorico)}</div></div>
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
        <div style="padding:4px 0;"><span class="muted">Usuario:</span> <b>${escapeHtml(state.user.username)}</b></div>
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

      <div class="section-title"><span>Importar datos</span></div>
      <div class="card">
        <p class="muted" style="margin-top:0;">Si tienes una copia de seguridad (CSV) de otra app de cobros, puedes traer aquí los clientes y los saldos que todavía deban. Es seguro intentarlo más de una vez: no se duplican los clientes ni los préstamos que ya se hayan importado antes.</p>
        <div id="import-resultado"></div>
        <input type="file" id="import-file" accept=".csv,text/csv" onchange="seleccionarArchivoImportacion(event)" style="margin-bottom:10px;width:100%;" />
        <button class="btn btn-secondary btn-block" id="import-btn" disabled onclick="ejecutarImportacion()">Importar archivo</button>
        <p class="muted" style="margin-top:14px;">Si ya importaste antes y la Agenda no mostraba bien los días de pago de esos clientes, sube el mismo archivo aquí y corrige solo las fechas (no crea clientes ni préstamos nuevos, y no toca préstamos que ya tengan pagos registrados):</p>
        <div id="corregir-resultado"></div>
        <button class="btn btn-secondary btn-block" id="corregir-btn" disabled onclick="ejecutarCorreccionFechas()">Corregir fechas de préstamos ya importados</button>
      </div>

      <button class="btn btn-danger btn-block" style="margin-top:20px;" onclick="logout()">Cerrar sesión</button>
    </main>
  `;
}

async function seleccionarArchivoImportacion(ev) {
  const file = ev.target.files[0];
  const btn = document.getElementById("import-btn");
  const corregirBtn = document.getElementById("corregir-btn");
  const resultado = document.getElementById("import-resultado");
  resultado.innerHTML = "";
  document.getElementById("corregir-resultado").innerHTML = "";
  if (!file) {
    btn.disabled = true;
    corregirBtn.disabled = true;
    state.importCsv = null;
    return;
  }
  try {
    state.importCsv = await file.text();
    btn.disabled = false;
    corregirBtn.disabled = false;
  } catch (e) {
    resultado.innerHTML = `<div class="error-msg">No se pudo leer el archivo</div>`;
    btn.disabled = true;
    corregirBtn.disabled = true;
  }
}

async function ejecutarImportacion() {
  if (!state.importCsv) return;
  const btn = document.getElementById("import-btn");
  const resultado = document.getElementById("import-resultado");
  btn.disabled = true;
  btn.textContent = "Importando...";
  try {
    const r = await api("/sistema/importar-clientes", { method: "POST", body: { csv: state.importCsv } });
    resultado.innerHTML = `
      <div class="ok-msg">
        Importación completada.<br>
        Clientes nuevos: <b>${r.clientesCreados}</b> (ya existían: ${r.clientesYaExistian})<br>
        Préstamos importados: <b>${r.prestamosCreados}</b> (ya estaban importados antes: ${r.prestamosOmitidosYaImportados})<br>
        Cartera importada: <b>${money(r.carteraTotalImportada)}</b>
        ${
          r.advertencias && r.advertencias.length
            ? `<br><br><b>Advertencias:</b><br>${r.advertencias.map(escapeHtml).join("<br>")}`
            : ""
        }
      </div>
    `;
    toast("Importación completada", "success");
    state.cache.clientes = null;
  } catch (e) {
    resultado.innerHTML = `<div class="error-msg">${e.message}</div>`;
  }
  btn.disabled = false;
  btn.textContent = "Importar archivo";
}

async function ejecutarCorreccionFechas() {
  if (!state.importCsv) return;
  const btn = document.getElementById("corregir-btn");
  const resultado = document.getElementById("corregir-resultado");
  btn.disabled = true;
  btn.textContent = "Corrigiendo...";
  try {
    const r = await api("/sistema/corregir-fechas-importacion", { method: "POST", body: { csv: state.importCsv } });
    resultado.innerHTML = `
      <div class="ok-msg">
        Corrección completada.<br>
        Préstamos revisados: <b>${r.prestamosRevisados}</b><br>
        Corregidos: <b>${r.prestamosCorregidos}</b> · Ya estaban bien: ${r.prestamosSinCambios} · Con pagos (no se tocaron): ${r.prestamosOmitidosPorTenerPagos}
        ${
          r.advertencias && r.advertencias.length
            ? `<br><br><b>Advertencias:</b><br>${r.advertencias.map(escapeHtml).join("<br>")}`
            : ""
        }
      </div>
    `;
    toast("Fechas corregidas", "success");
    state.cache.clientes = null;
  } catch (e) {
    resultado.innerHTML = `<div class="error-msg">${e.message}</div>`;
  }
  btn.disabled = false;
  btn.textContent = "Corregir fechas de préstamos ya importados";
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
