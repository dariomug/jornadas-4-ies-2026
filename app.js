"use strict";

const API_URL = "https://script.google.com/macros/s/AKfycbzSs4wcBRRtBGTaKfjsVwyzG67u70GliVFIyZvSFWSxXxwC7RBFG2-LNp2J88bPmFUT/exec";
const EVENT_START = new Date("2026-10-01T14:00:00-03:00");
const EVENT_END = new Date("2026-10-02T22:00:00-03:00");
const MENU_POPUP_START = new Date("2026-10-02T11:30:00-03:00");
const MENU_POPUP_END = new Date("2026-10-02T15:00:00-03:00");
const CACHE_KEY = "jornadas4ies:data:v1";

const state = {
  data: { actividades: [], espacios: [], avisos: [], menu: [], sponsors: [], institutos: [], configuracion: [] },
  day: "2026-10-01",
  query: "",
  status: "all",
  type: "all",
  space: "all",
  hasLoaded: false,
  isLoading: false,
  lastUpdated: null,
  selectedMapSpace: "sum"
};

const MAP_SPACES = {
  "sum": { label: "SUM", aliases: ["sum", "salon de usos multiples"] },
  "aula-1": { label: "Aula 1", aliases: ["aula 1"] },
  "aula-2": { label: "Aula 2", aliases: ["aula 2"] },
  "aula-4": { label: "Aula 4", aliases: ["aula 4"] },
  "aula-5": { label: "Aula 5", aliases: ["aula 5"] },
  "aula-6": { label: "Aula 6", aliases: ["aula 6"] },
  "aula-7": { label: "Aula 7", aliases: ["aula 7"] },
  "aula-8": { label: "Aula 8", aliases: ["aula 8"] },
  "aula-9": { label: "Aula 9", aliases: ["aula 9"] },
  "aula-10": { label: "Aula 10", aliases: ["aula 10"] },
  "aula-11": { label: "Aula 11", aliases: ["aula 11"] },
  "aula-12": { label: "Aula 12", aliases: ["aula 12"] },
  "aulas-13-14": { label: "Aulas 13 y 14", aliases: ["aula 13", "aula 14", "aulas 13 y 14", "aulas 13-14"] },
  "aula-musica": { label: "Aula de Música", aliases: ["aula musica", "aula de musica"] },
  "laboratorio": { label: "Laboratorio de Informática", aliases: ["laboratorio", "laboratorio informatica", "laboratorio de informatica"] },
  "biblioteca": { label: "Biblioteca", aliases: ["biblioteca"] },
  "taller-arte": { label: "Taller de Arte", aliases: ["taller de arte"] },
  "espacio-arte-vera": { label: "Espacio de Arte Vera", aliases: ["espacio de arte vera", "espacio arte vera"] },
  "aula-abierta": { label: "Aula abierta", aliases: ["aula abierta"] },
  "patio-artesanos": { label: "Patio de artesanos", aliases: ["patio artesanos", "patio de artesanos"] },
  "corredor-4-8": { label: "Corredor de aulas 4 a 8", aliases: ["corredor aulas 4 a 8", "corredor de aulas 4 a 8", "corredor 4 a 8"] }
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const normalizeKey = value => String(value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

function valueOf(object, ...keys) {
  if (!object) return "";
  const entries = Object.entries(object);
  for (const key of keys) {
    const wanted = normalizeKey(key);
    const match = entries.find(([actual]) => normalizeKey(actual) === wanted);
    if (match && match[1] !== null && match[1] !== undefined) return match[1];
  }
  return "";
}

function isTrue(value, defaultValue = true) {
  if (value === "" || value === null || value === undefined) return defaultValue;
  if (typeof value === "boolean") return value;
  return !["no", "false", "0", "inactivo", "oculto"].includes(normalizeKey(value));
}

function parseDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "'":"&#039;", '"':"&quot;" })[char]);
}

function safeUrl(value) {
  const url = String(value ?? "").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url, location.href);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch { return ""; }
}

function formatTime(value) {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false }).format(date) : "—";
}

function localDateKey(value) {
  const date = parseDate(value);
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function activityStatus(activity, now = new Date()) {
  const manual = normalizeKey(valueOf(activity, "estado_manual", "estado", "status"));
  if (manual && !["automatico", "auto"].includes(manual)) {
    if (["encurso", "envivo", "sucediendo"].includes(manual)) return "live";
    if (["finalizada", "finalizado", "terminada", "terminado"].includes(manual)) return "finished";
    if (["cancelada", "cancelado", "suspendida", "suspendido"].includes(manual)) return "cancelled";
    if (["proximamente", "pendiente", "programada", "programado"].includes(manual)) return "upcoming";
  }
  const start = parseDate(valueOf(activity, "inicio", "fecha_inicio"));
  const end = parseDate(valueOf(activity, "fin", "fecha_fin"));
  if (!start || !end) return "upcoming";
  if (now < start) return "upcoming";
  if (now >= end) return "finished";
  return "live";
}

function statusLabel(status) {
  return ({ live: "En curso", upcoming: "Próximamente", finished: "Finalizada", cancelled: "Cancelada" })[status] || "Programada";
}

function visibleRows(rows) {
  return (Array.isArray(rows) ? rows : []).filter(row => isTrue(valueOf(row, "visible", "activo", "publicar"), true));
}

function setConnectionStatus(mode, label, date = null) {
  const connection = $("#connection-status");
  connection.className = `live-pill ${mode}`;
  $("#connection-label").textContent = label;
  $("#last-updated").textContent = date ? `Última actualización: ${formatTime(date)}` : "Esperando datos";
}

async function loadData({ manual = false } = {}) {
  if (state.isLoading) return;
  state.isLoading = true;
  const refreshButton = $("#refresh-button");
  refreshButton.disabled = true;
  refreshButton.classList.add("loading");
  setConnectionStatus("loading", "Actualizando…", state.lastUpdated);
  try {
    const response = await fetch(`${API_URL}?t=${Date.now()}`, { redirect: "follow", cache: "no-store" });
    if (!response.ok) throw new Error(`Respuesta ${response.status}`);
    const data = await response.json();
    if (!data || data.ok === false) throw new Error(data?.error || "La API no respondió correctamente");
    state.data = { ...state.data, ...data };
    state.lastUpdated = new Date();
    state.hasLoaded = true;
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: state.lastUpdated.getTime(), data: state.data }));
    setConnectionStatus("online", "Datos actualizados", state.lastUpdated);
    if (manual) showToast("Información actualizada");
  } catch (error) {
    const cached = readCache();
    if (state.hasLoaded) {
      setConnectionStatus("offline", "No se pudo actualizar", state.lastUpdated);
      if (manual) showToast("No se pudo actualizar. Se mantienen los datos anteriores");
    } else if (cached) {
      state.data = { ...state.data, ...cached.data };
      state.lastUpdated = new Date(cached.savedAt || Date.now());
      state.hasLoaded = true;
      setConnectionStatus("offline", "Datos guardados", state.lastUpdated);
      showToast("Sin conexión: se muestran los últimos datos guardados");
    } else {
      state.hasLoaded = true;
      setConnectionStatus("offline", "Sin conexión", null);
      renderLoadError(error);
      return;
    }
    console.error(error);
  } finally {
    state.isLoading = false;
    refreshButton.disabled = false;
    refreshButton.classList.remove("loading");
  }
  populateFilters();
  renderAll();
  maybeShowFoodPopup();
}

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
}

function renderLoadError(error) {
  const html = `<div class="empty-state error-state"><strong>No pudimos cargar la programación</strong><span>Revisá la conexión e intentá nuevamente.</span><br><button class="button secondary" type="button" data-retry>Reintentar</button></div>`;
  $("#now-grid").innerHTML = html;
  $("#next-list").innerHTML = "";
  $("#schedule-results").innerHTML = html;
  console.error(error);
}

function renderAll() {
  renderEventStatus();
  renderAlerts();
  renderHome();
  renderSchedule();
  renderMap();
  renderMenu();
  renderMemories();
  renderSponsors();
}

function renderEventStatus() {
  const now = new Date();
  const card = $("#event-status-card");
  if (now < EVENT_START) {
    const days = Math.max(1, Math.ceil((EVENT_START - now) / 86400000));
    card.innerHTML = `<span class="event-card-label">Falta${days === 1 ? "" : "n"}</span><strong>${days} día${days === 1 ? "" : "s"} para encontrarnos</strong><small>Jueves 1 y viernes 2 de octubre</small>`;
  } else if (now <= EVENT_END) {
    const live = visibleRows(state.data.actividades).filter(item => activityStatus(item, now) === "live").length;
    card.innerHTML = `<span class="event-card-label">Jornadas en curso</span><strong>${live ? `${live} propuesta${live === 1 ? "" : "s"} ahora` : "Revisá lo que viene"}</strong><small>Información actualizada desde la organización</small>`;
  } else {
    card.innerHTML = `<span class="event-card-label">Jornadas finalizadas</span><strong>Gracias por ser parte</strong><small>Recorré las memorias del encuentro</small>`;
  }
}

function renderAlerts() {
  const now = new Date();
  const alerts = visibleRows(state.data.avisos).filter(alert => {
    const start = parseDate(valueOf(alert, "inicio", "desde", "fecha_inicio"));
    const end = parseDate(valueOf(alert, "fin", "hasta", "fecha_fin"));
    return (!start || now >= start) && (!end || now <= end);
  });
  $("#alerts-home").innerHTML = alerts.map(alert => {
    const title = valueOf(alert, "titulo", "nombre") || "Aviso importante";
    const message = valueOf(alert, "mensaje", "descripcion", "texto");
    const type = normalizeKey(valueOf(alert, "tipo", "categoria"));
    const go = /menu|comida|almuerzo/.test(type) ? "menu" : valueOf(alert, "seccion", "destino");
    return `<article class="alert"><span class="alert-icon" aria-hidden="true">${/menu|comida|almuerzo/.test(type) ? "⌁" : "!"}</span><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div>${go ? `<button type="button" data-go="${escapeHtml(go)}">Ver más</button>` : ""}</article>`;
  }).join("");
}

function getActivities() {
  return visibleRows(state.data.actividades).sort((a,b) => (parseDate(valueOf(a,"inicio")) || 0) - (parseDate(valueOf(b,"inicio")) || 0));
}

function activityCard(activity) {
  const id = valueOf(activity, "id") || `activity-${Math.random()}`;
  const status = activityStatus(activity);
  const type = valueOf(activity, "tipo", "categoria") || "Actividad";
  const title = valueOf(activity, "titulo", "actividad") || "Actividad sin título";
  const space = valueOf(activity, "espacio", "aula") || "Espacio a confirmar";
  const institute = valueOf(activity, "instituto", "ies");
  const start = valueOf(activity, "inicio");
  const end = valueOf(activity, "fin");
  return `<button class="activity-card" type="button" data-activity-id="${escapeHtml(id)}" style="--card-accent:${status === "live" ? "var(--live)" : typeAccent(type)}">
    <div class="card-top"><span class="status-badge ${status}">${statusLabel(status)}</span><span class="activity-time">${formatTime(start)}–${formatTime(end)}</span></div>
    <div><span class="type-badge">${escapeHtml(type)}</span><h3>${escapeHtml(title)}</h3></div>
    <div class="activity-meta"><span><strong>⌖ ${escapeHtml(space)}</strong></span>${institute ? `<span>${escapeHtml(institute)}</span>` : ""}</div>
  </button>`;
}

function typeAccent(type) {
  const value = normalizeKey(type);
  if (value.includes("taller")) return "var(--gold)";
  if (value.includes("muestra") || value.includes("arte")) return "var(--lime)";
  if (value.includes("mesa")) return "var(--blue)";
  return "var(--purple)";
}

function renderHome() {
  const activities = getActivities();
  const now = new Date();
  const live = activities.filter(item => activityStatus(item, now) === "live");
  const upcoming = activities.filter(item => activityStatus(item, now) === "upcoming").slice(0, 5);
  const nowGrid = $("#now-grid");
  if (live.length) nowGrid.innerHTML = live.map(activityCard).join("");
  else if (now < EVENT_START) nowGrid.innerHTML = `<div class="empty-state"><strong>Las jornadas comienzan el jueves 1</strong><span>Mientras tanto, podés recorrer el cronograma completo y ubicar cada espacio.</span></div>`;
  else nowGrid.innerHTML = `<div class="empty-state"><strong>No hay actividades en curso en este momento</strong><span>Consultá lo próximo para organizar tu recorrido.</span></div>`;

  $("#next-list").innerHTML = upcoming.length ? upcoming.map(item => {
    const id = valueOf(item,"id");
    const title = valueOf(item,"titulo","actividad");
    const space = valueOf(item,"espacio","aula") || "A confirmar";
    const day = localDateKey(valueOf(item,"inicio")) === "2026-10-01" ? "Jue" : "Vie";
    return `<button class="timeline-row" type="button" data-activity-id="${escapeHtml(id)}"><span class="timeline-time">${day} ${formatTime(valueOf(item,"inicio"))}</span><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(valueOf(item,"tipo","categoria"))}</small></span><span class="timeline-space">${escapeHtml(space)}</span></button>`;
  }).join("") : `<div class="empty-state"><strong>No quedan actividades programadas</strong><span>Recorré las memorias del encuentro.</span></div>`;
}

function populateFilters() {
  const activities = getActivities();
  const types = [...new Set(activities.map(item => String(valueOf(item,"tipo","categoria")).trim()).filter(Boolean))].sort();
  const spaces = [...new Set(activities.map(item => String(valueOf(item,"espacio","aula")).trim()).filter(Boolean))].sort();
  $("#type-filter").innerHTML = '<option value="all">Todos los tipos</option>' + types.map(type => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`).join("");
  $("#space-filter").innerHTML = '<option value="all">Todos los espacios</option>' + spaces.map(space => `<option value="${escapeHtml(space)}">${escapeHtml(space)}</option>`).join("");
}

function renderSchedule() {
  if (!state.hasLoaded) {
    $("#schedule-results").innerHTML = `<div class="empty-state"><strong>Actualizando programación…</strong><span>Estamos consultando los últimos cambios.</span></div>`;
    return;
  }
  const query = normalizeKey(state.query);
  const filtered = getActivities().filter(item => {
    const haystack = normalizeKey([valueOf(item,"titulo","actividad"), valueOf(item,"responsables","expositores"), valueOf(item,"espacio","aula"), valueOf(item,"instituto","ies")].join(" "));
    return (state.day === "all" || localDateKey(valueOf(item,"inicio")) === state.day)
      && (!query || haystack.includes(query))
      && (state.status === "all" || activityStatus(item) === state.status)
      && (state.type === "all" || valueOf(item,"tipo","categoria") === state.type)
      && (state.space === "all" || valueOf(item,"espacio","aula") === state.space);
  });
  const groups = new Map();
  filtered.forEach(item => {
    const key = `${localDateKey(valueOf(item,"inicio"))}|${formatTime(valueOf(item,"inicio"))}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  $("#schedule-results").innerHTML = filtered.length ? [...groups.entries()].map(([key, items]) => {
    const [date, time] = key.split("|");
    const day = date === "2026-10-01" ? "Jueves" : "Viernes";
    return `<section class="time-group"><div class="time-label"><small>${state.day === "all" ? day : ""}</small><div>${time} h</div></div><div class="time-group-cards">${items.map(activityCard).join("")}</div></section>`;
  }).join("") : `<div class="empty-state"><strong>No encontramos actividades</strong><span>Probá quitando algún filtro o usando otra búsqueda.</span></div>`;
}

function mapActivities(key) {
  const definition = MAP_SPACES[key];
  if (!definition) return [];
  const aliases = definition.aliases.map(normalizeKey);
  return getActivities().filter(item => {
    const spaceId = normalizeKey(valueOf(item, "espacio_id", "id_espacio"));
    const spaceName = normalizeKey(valueOf(item, "espacio", "aula"));
    return normalizeKey(key) === spaceId || aliases.includes(spaceId) || aliases.includes(spaceName);
  });
}

function mapSpaceInfo(key, now = new Date()) {
  const activities = mapActivities(key);
  return {
    definition: MAP_SPACES[key],
    activities,
    live: activities.find(item => activityStatus(item, now) === "live") || null,
    next: activities.find(item => activityStatus(item, now) === "upcoming") || null,
    finished: activities.length > 0 && activities.every(item => ["finished", "cancelled"].includes(activityStatus(item, now)))
  };
}

function renderMap() {
  const now = new Date();
  $$("[data-map-key]").forEach(element => {
    const key = element.dataset.mapKey;
    const info = mapSpaceInfo(key, now);
    element.classList.remove("is-live", "is-next", "is-finished", "is-free", "is-selected");
    const status = info.live ? "is-live" : info.next ? "is-next" : info.finished ? "is-finished" : "is-free";
    element.classList.add(status);
    element.classList.toggle("is-selected", key === state.selectedMapSpace);
    const statusText = info.live ? "En curso" : info.next ? `Próxima ${formatTime(valueOf(info.next,"inicio"))}` : info.finished ? "Finalizada" : "Sin actividad ahora";
    element.setAttribute("aria-label", `${info.definition?.label || key}. ${statusText}`);
    const text = $(".map-status-text", element);
    if (text) text.textContent = statusText;
  });

  const rows = Object.entries(MAP_SPACES).map(([key, definition]) => {
    const info = mapSpaceInfo(key, now);
    const item = info.live || info.next;
    const stateClass = info.live ? "live" : info.next ? "next" : "";
    const stateText = info.live ? "En curso" : info.next ? formatTime(valueOf(info.next,"inicio")) : "—";
    return `<button class="space-row ${key === state.selectedMapSpace ? "is-selected" : ""}" type="button" data-map-select="${escapeHtml(key)}"><span><strong>${escapeHtml(definition.label)}</strong><small>${item ? escapeHtml(valueOf(item,"titulo","actividad")) : "Sin actividad programada ahora"}</small></span><span class="space-state ${stateClass}">${stateText}</span></button>`;
  });
  $("#spaces-list").innerHTML = rows.join("");

  if (!MAP_SPACES[state.selectedMapSpace]) {
    const firstLive = Object.keys(MAP_SPACES).find(key => mapSpaceInfo(key, now).live);
    state.selectedMapSpace = firstLive || "sum";
  }
  selectMapSpace(state.selectedMapSpace, false);
}

function selectMapSpace(key, scrollIntoView = false) {
  if (!MAP_SPACES[key]) return;
  state.selectedMapSpace = key;
  const info = mapSpaceInfo(key);
  const current = info.live || info.next;
  const status = info.live ? "live" : info.next ? "upcoming" : info.finished ? "finished" : "";
  const statusText = info.live ? "En curso" : info.next ? "Próximamente" : info.finished ? "Actividades finalizadas" : "Sin actividad ahora";
  const nextAfterLive = info.live ? info.activities.find(item => activityStatus(item) === "upcoming") : null;
  const actualSpace = current ? valueOf(current, "espacio", "aula") : info.definition.label;

  $("#map-selection").innerHTML = current
    ? `<span class="status-badge ${status}">${statusText}</span><strong class="selection-title">${escapeHtml(info.definition.label)}</strong><span>${escapeHtml(valueOf(current,"titulo","actividad"))}</span><span class="selection-meta">${formatTime(valueOf(current,"inicio"))}–${formatTime(valueOf(current,"fin"))} · ${escapeHtml(valueOf(current,"tipo","categoria"))}</span>${nextAfterLive ? `<div class="selection-next"><small>Después, a las ${formatTime(valueOf(nextAfterLive,"inicio"))}</small><strong>${escapeHtml(valueOf(nextAfterLive,"titulo","actividad"))}</strong></div>` : ""}<button class="map-agenda-button" type="button" data-map-agenda="${escapeHtml(actualSpace)}" data-map-day="${escapeHtml(localDateKey(valueOf(current,"inicio")))}">Ver en la agenda →</button>`
    : `<span class="status-badge finished">${statusText}</span><strong class="selection-title">${escapeHtml(info.definition.label)}</strong><span>No hay una actividad programada en este momento.</span>`;

  $$("[data-map-key]").forEach(element => element.classList.toggle("is-selected", element.dataset.mapKey === key));
  $$("[data-map-select]").forEach(button => button.classList.toggle("is-selected", button.dataset.mapSelect === key));
  if (scrollIntoView) $("#map-selection").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderMenu() {
  const items = visibleRows(state.data.menu);
  const available = items.filter(item => isTrue(valueOf(item,"disponible","activo","visible"), true));
  $("#menu-status").innerHTML = available.length
    ? `<strong>${available.length} opción${available.length === 1 ? "" : "es"} disponible${available.length === 1 ? "" : "s"}.</strong> Recordá: la app es informativa; la elección y el pago se hacen personalmente.`
    : `<strong>El menú todavía no está habilitado.</strong> Volvé a consultar cerca del horario del almuerzo.`;
  $("#menu-grid").innerHTML = available.length ? available.map(item => {
    const name = valueOf(item,"nombre","titulo","opcion") || "Opción de menú";
    const description = valueOf(item,"descripcion","detalle","incluye");
    const priceRaw = valueOf(item,"precio","valor");
    const price = priceRaw === "" ? "Consultar" : (/^\$/.test(String(priceRaw)) ? priceRaw : `$ ${priceRaw}`);
    const photo = safeUrl(valueOf(item,"foto_url","imagen_url","foto"));
    return `<article class="menu-card">${photo ? `<img src="${escapeHtml(photo)}" alt="${escapeHtml(name)}" loading="lazy">` : ""}<div class="menu-card-body"><h3>${escapeHtml(name)}</h3><p>${escapeHtml(description)}</p><div class="menu-card-bottom"><span class="price">${escapeHtml(price)}</span><span class="availability">Disponible</span></div></div></article>`;
  }).join("") : `<div class="empty-state"><strong>Próximamente</strong><span>Las opciones se publicarán desde la organización.</span></div>`;
}

function renderMemories() {
  const memories = getActivities().filter(item => {
    const finished = activityStatus(item) === "finished";
    return finished && (valueOf(item,"resumen","reseña","memoria") || valueOf(item,"foto_url","imagen_url") || valueOf(item,"materiales_url","material_url"));
  }).reverse();
  $("#memory-grid").innerHTML = memories.length ? memories.map(item => {
    const title = valueOf(item,"titulo","actividad");
    const type = valueOf(item,"tipo","categoria");
    const summary = valueOf(item,"resumen","reseña","memoria");
    const photo = safeUrl(valueOf(item,"foto_url","imagen_url","foto"));
    const materials = safeUrl(valueOf(item,"materiales_url","material_url","enlace"));
    return `<article class="memory-card">${photo ? `<img src="${escapeHtml(photo)}" alt="Registro de ${escapeHtml(title)}" loading="lazy">` : ""}<div class="memory-card-body"><span class="type-badge">${escapeHtml(type)}</span><h3>${escapeHtml(title)}</h3>${summary ? `<p>${escapeHtml(summary)}</p>` : ""}${materials ? `<a href="${escapeHtml(materials)}" target="_blank" rel="noopener">Ver materiales →</a>` : ""}</div></article>`;
  }).join("") : `<div class="empty-state"><strong>Las memorias se construirán durante las jornadas</strong><span>Cuando finalicen las actividades, acá aparecerán sus reseñas, fotos y materiales.</span></div>`;
}

function renderSponsors() {
  const sponsors = visibleRows(state.data.sponsors).sort((a,b) => Number(valueOf(a,"orden") || 999) - Number(valueOf(b,"orden") || 999));
  const sponsorContent = (item, compact = false) => {
    const name = valueOf(item,"nombre","sponsor","institucion") || "Sponsor";
    const logo = safeUrl(valueOf(item,"logo_url","imagen_url","logo"));
    const link = safeUrl(valueOf(item,"enlace","url","sitio_web"));
    const content = logo ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(name)}" loading="lazy">` : `<span>${escapeHtml(name)}</span>`;
    const classes = `sponsor${compact ? " sponsor-mini" : ""}`;
    return link ? `<a class="${classes}" href="${escapeHtml(link)}" target="_blank" rel="noopener" aria-label="Visitar el sitio de ${escapeHtml(name)}">${content}</a>` : `<div class="${classes}">${content}</div>`;
  };
  $("#sponsors-grid").innerHTML = sponsors.length
    ? sponsors.map(item => sponsorContent(item)).join("")
    : `<div class="empty-state"><strong>Espacio para sponsors</strong><span>Los logos se mostrarán automáticamente cuando se carguen en la planilla.</span></div>`;
  const preview = $("#sponsors-preview");
  const previewSection = $(".home-sponsors");
  if (preview && previewSection) {
    previewSection.hidden = sponsors.length === 0;
    preview.innerHTML = sponsors.slice(0, 6).map(item => sponsorContent(item, true)).join("");
  }
}

function showActivity(id) {
  const item = getActivities().find(activity => String(valueOf(activity,"id")) === String(id));
  if (!item) return;
  const title = valueOf(item,"titulo","actividad");
  const status = activityStatus(item);
  const photo = safeUrl(valueOf(item,"foto_url","imagen_url","foto"));
  const materials = safeUrl(valueOf(item,"materiales_url","material_url","enlace"));
  const summary = valueOf(item,"resumen","reseña","memoria");
  $("#activity-detail").innerHTML = `<div class="detail-header"><span class="status-badge ${status}">${statusLabel(status)}</span><h2>${escapeHtml(title)}</h2><span class="type-badge">${escapeHtml(valueOf(item,"tipo","categoria"))}</span></div>
    <div class="detail-meta"><div><small>Horario</small><strong>${formatTime(valueOf(item,"inicio"))}–${formatTime(valueOf(item,"fin"))}</strong></div><div><small>Espacio</small><strong>${escapeHtml(valueOf(item,"espacio","aula") || "A confirmar")}</strong></div><div><small>Instituto</small><strong>${escapeHtml(valueOf(item,"instituto","ies") || "Organización")}</strong></div><div><small>Responsables</small><strong>${escapeHtml(valueOf(item,"responsables","expositores") || "—")}</strong></div></div>
    ${summary ? `<div class="detail-text"><h3>Resumen</h3><p>${escapeHtml(summary)}</p></div>` : ""}${photo ? `<img class="detail-photo" src="${escapeHtml(photo)}" alt="Registro de ${escapeHtml(title)}">` : ""}${materials ? `<a class="detail-link" href="${escapeHtml(materials)}" target="_blank" rel="noopener">Abrir materiales →</a>` : ""}`;
  $("#activity-dialog").showModal();
}

function showView(name, updateHash = true) {
  const target = $(`[data-view="${name}"]`);
  if (!target) return;
  $$(".view").forEach(view => { view.hidden = view !== target; view.classList.toggle("active", view === target); });
  $$(".bottom-nav [data-go]").forEach(button => button.classList.toggle("active", button.dataset.go === name));
  if (updateHash) history.replaceState(null, "", `#${name}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (name === "cronograma") renderSchedule();
  if (name === "mapa") renderMap();
}

function maybeShowFoodPopup() {
  const now = new Date();
  const activeFoodAlert = visibleRows(state.data.avisos).find(alert => {
    const type = normalizeKey(valueOf(alert,"tipo","categoria","titulo"));
    const start = parseDate(valueOf(alert,"inicio","desde","fecha_inicio"));
    const end = parseDate(valueOf(alert,"fin","hasta","fecha_fin"));
    return /menu|comida|almuerzo/.test(type) && (!start || now >= start) && (!end || now <= end);
  });
  const defaultWindow = now >= MENU_POPUP_START && now <= MENU_POPUP_END;
  const hasMenu = visibleRows(state.data.menu).length > 0;
  const dismissed = sessionStorage.getItem("food-popup-dismissed") === localDateKey(now);
  if (!dismissed && hasMenu && (activeFoodAlert || defaultWindow)) {
    if (activeFoodAlert) {
      $("#food-popup-title").textContent = valueOf(activeFoodAlert,"titulo","nombre") || "Ya podés consultar el menú";
      $("#food-popup-message").textContent = valueOf(activeFoodAlert,"mensaje","descripcion","texto") || "Mirá las opciones disponibles. Para elegir y comprar, acercate personalmente al punto de venta.";
    }
    $("#food-popup").showModal();
  }
}

function closeFoodPopup() {
  sessionStorage.setItem("food-popup-dismissed", localDateKey(new Date()));
  $("#food-popup").close();
}

let toastTimer;
function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

document.addEventListener("click", event => {
  const go = event.target.closest("[data-go]");
  if (go) showView(go.dataset.go);
  const activity = event.target.closest("[data-activity-id]");
  if (activity) showActivity(activity.dataset.activityId);
  if (event.target.closest("[data-close-dialog]")) $("#activity-dialog").close();
  if (event.target.closest("[data-close-food]")) closeFoodPopup();
  if (event.target.closest("[data-open-menu]")) { closeFoodPopup(); showView("menu"); }
  if (event.target.closest("[data-retry]")) loadData();
  const dayButton = event.target.closest("[data-day]");
  if (dayButton) {
    state.day = dayButton.dataset.day;
    $$("#day-filter button").forEach(button => button.classList.toggle("active", button === dayButton));
    renderSchedule();
  }
  const mapSpace = event.target.closest("[data-map-key], [data-map-select]");
  if (mapSpace) selectMapSpace(mapSpace.dataset.mapKey || mapSpace.dataset.mapSelect, true);
  const mapAgenda = event.target.closest("[data-map-agenda]");
  if (mapAgenda) {
    state.space = mapAgenda.dataset.mapAgenda;
    state.day = mapAgenda.dataset.mapDay || "all";
    $("#space-filter").value = state.space;
    $$("#day-filter button").forEach(button => button.classList.toggle("active", button.dataset.day === state.day));
    showView("cronograma");
  }
});

document.addEventListener("keydown", event => {
  const mapSpace = event.target.closest?.("[data-map-key]");
  if (mapSpace && ["Enter", " "].includes(event.key)) {
    event.preventDefault();
    selectMapSpace(mapSpace.dataset.mapKey, true);
  }
});

$("#refresh-button").addEventListener("click", () => loadData({ manual: true }));

$("#schedule-search").addEventListener("input", event => { state.query = event.target.value; renderSchedule(); });
$("#status-filter").addEventListener("change", event => { state.status = event.target.value; renderSchedule(); });
$("#type-filter").addEventListener("change", event => { state.type = event.target.value; renderSchedule(); });
$("#space-filter").addEventListener("change", event => { state.space = event.target.value; renderSchedule(); });

[$("#activity-dialog"), $("#food-popup")].forEach(dialog => dialog.addEventListener("click", event => {
  if (event.target === dialog) {
    if (dialog.id === "food-popup") closeFoodPopup(); else dialog.close();
  }
}));

window.addEventListener("hashchange", () => showView(location.hash.slice(1) || "inicio", false));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && (!state.lastUpdated || Date.now() - state.lastUpdated.getTime() > 15000)) loadData();
});
window.addEventListener("focus", () => {
  if (!state.lastUpdated || Date.now() - state.lastUpdated.getTime() > 15000) loadData();
});
window.addEventListener("online", () => loadData());

function scheduleNextRefresh() {
  const jitter = Math.round((Math.random() - 0.5) * 30000);
  const delay = Math.max(90000, 120000 + jitter);
  window.setTimeout(async () => {
    await loadData();
    scheduleNextRefresh();
  }, delay);
}

showView(location.hash.slice(1) || "inicio", false);
loadData().finally(scheduleNextRefresh);
setInterval(() => { renderAll(); }, 60000);

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(console.error));
