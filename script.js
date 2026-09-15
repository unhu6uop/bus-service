function updateClock() {
  var now = new Date();
  var h = now.getHours();
  var m = now.getMinutes();
  var period = h < 12 ? "오전" : "오후";
  var h12 = h % 12;
  if (h12 === 0) h12 = 12;
  var mm = (m < 10 ? "0" : "") + m;
  var el = document.getElementById("clock");
  if (el) el.textContent = period + " " + h12 + ":" + mm;
}

const YOUR_API_KEY = "your api key";
const CITY_CODES = ["22", "37050"];
const CITY_NAMES = { 22: "대구", 37050: "구미" };
const CITY_STOP_BASED = { 37050: true };
const DEFAULT_STOP_CITY = "37050";
const DEFAULT_STOP_NAME = "구미역";
let currentCityCode = "22";
let currentNodeId = "DGB7001010600";
const API_BASE =
  "https://apis.data.go.kr/1613000/ArvlInfoInqireService/getSttnAcctoArvlPrearngeInfoList";
const ROUTE_API_BASE =
  "https://apis.data.go.kr/1613000/BusRouteInfoInqireService/getRouteNoList";
const ROUTE_STOPS_API_BASE =
  "https://apis.data.go.kr/1613000/BusRouteInfoInqireService/getRouteAcctoThrghSttnList";
const LOC_API_BASE =
  "https://apis.data.go.kr/1613000/BusLcInfoInqireService/getRouteAcctoBusLcList";
const STOP_API_BASE =
  "https://apis.data.go.kr/1613000/BusSttnInfoInqireService/getSttnNoList";
const ODSAY_API_KEY = "your api key";
const ODSAY_BASE = "https://api.odsay.com/v1/api/searchPubTransPathT";
const ODSAY_LANE_BASE = "https://api.odsay.com/v1/api/loadLane";
const GUMI_BIS_BASE = "https://bis.gumi.go.kr/realtime";
const PROXY = "";
const BADGE_COLORS = ["b-blue", "b-orange", "b-green"];
const ROUTE_TYPE_COLORS = {
  일반버스: "#16a34a",
  지선버스: "#16a34a",
  순환버스: "#8b5cf6",
  좌석버스: "#0a6cff",
  간선버스: "#0a6cff",
  급행버스: "#e0392f",
  광역버스: "#e0392f",
  마을버스: "#f4b400",
  default: "#16a34a",
};
const FAV_ICON = "kid_star";
const POS_REQUEST_GAP_MS = 220;
const DEFAULT_GLIDE_MS = 16000;
let initialCenterOverride = null;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildUrl() {
  const qs = new URLSearchParams({
    serviceKey: YOUR_API_KEY,
    cityCode: currentCityCode,
    nodeId: currentNodeId,
    numOfRows: "100",
    pageNo: "1",
    _type: "json",
  });
  const url = `${API_BASE}?${qs.toString()}`;
  return PROXY ? PROXY + encodeURIComponent(url) : url;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

function asArray(x) {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

function debounce(fn, ms) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

function parseResponse(raw) {
  const pick = (o, ...keys) => {
    for (const k of keys) if (o?.[k] !== undefined && o[k] !== "") return o[k];
    return undefined;
  };
  try {
    const json = JSON.parse(raw);
    const header = json?.response?.header;
    const body = json?.response?.body;
    if (header && header.resultCode !== "00")
      return {
        code: header.resultCode === "03" ? "NO_DATA" : "ERROR",
        msg: header.resultMsg,
      };
    if (!body || Number(body.totalCount ?? 0) === 0)
      return { code: "NO_DATA", items: [] };
    let items = body?.items?.item ?? [];
    if (!Array.isArray(items)) items = [items];
    return { code: "OK", items: items.map((it) => normalize(it, pick)) };
  } catch (e) {}
  const doc = new DOMParser().parseFromString(raw, "application/xml");
  if (doc.querySelector("parsererror"))
    return { code: "ERROR", msg: "XML 파싱 실패" };
  const resultCode = doc.querySelector("resultCode")?.textContent?.trim();
  if (resultCode && resultCode !== "00")
    return {
      code: resultCode === "03" ? "NO_DATA" : "ERROR",
      msg: doc.querySelector("resultMsg")?.textContent,
    };
  const nodes = [...doc.querySelectorAll("item")];
  if (!nodes.length) return { code: "NO_DATA", items: [] };
  return {
    code: "OK",
    items: nodes.map((el) => {
      const o = {};
      [...el.children].forEach((c) => {
        o[c.tagName.toLowerCase()] = c.textContent.trim();
      });
      return normalize(o, pick);
    }),
  };
}

function normalize(it, pick) {
  const lower = {};
  Object.keys(it).forEach((k) => {
    lower[k.toLowerCase()] = it[k];
  });
  let sec = Number(pick(lower, "arrtime", "arrivaltime", "arrtm") ?? NaN);
  if (Number.isNaN(sec)) {
    const min = Number(
      pick(lower, "predicttime", "predicttime1", "arrivalmin") ?? NaN,
    );
    sec = Number.isNaN(min) ? NaN : min * 60;
  }
  return {
    routeno: String(
      pick(lower, "routeno", "routenm", "busnumber") ?? "",
    ).trim(),
    arrtime: Number.isNaN(sec) ? null : sec,
    prevCnt: Number(
      pick(lower, "arrprevstationcnt", "prevstationcnt", "locationno") ?? 0,
    ),
  };
}

function formatArrival(sec, prevCnt) {
  if (sec === null) return "도착 정보 확인 중";
  if (sec <= 0) return "곧 도착";
  const min = Math.floor(sec / 60);
  const stops = prevCnt ? ` · ${prevCnt}정거장 전` : "";
  return min < 1 ? "잠시 후 도착" : `${min}분 후 도착${stops}`;
}

const FAV_STORAGE_KEY = "gumibus_favorites_v2";
function loadFavorites() {
  try {
    const raw = localStorage.getItem(FAV_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    const oldRaw = localStorage.getItem("gumibus_favorites_v1");
    if (oldRaw) {
      const oldArr = JSON.parse(oldRaw);
      if (Array.isArray(oldArr))
        return oldArr.map((r) => ({ city: "22", routeno: r }));
    }
    return [];
  } catch (e) {
    return [];
  }
}
function saveFavorites() {
  try {
    localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(favorites));
  } catch (e) {}
}
let favorites = loadFavorites();
function isFavorite(city, routeno) {
  return favorites.some((f) => f.city === city && f.routeno === routeno);
}
function toggleFavorite(city, routeno) {
  if (isFavorite(city, routeno))
    favorites = favorites.filter(
      (f) => !(f.city === city && f.routeno === routeno),
    );
  else favorites.push({ city: city, routeno: routeno });
  saveFavorites();
  renderFavoritesSidebar();
}

function renderFavoritesSidebar() {
  const list = document.getElementById("favList");
  if (!list) return;
  list.innerHTML = "";
  if (favorites.length === 0) {
    const empty = document.createElement("li");
    empty.className = "fav-empty";
    empty.textContent =
      "즐겨찾는 노선이 없습니다. 위의 검색이나 도착정보의 별 버튼을 누르면 추가됩니다.";
    list.appendChild(empty);
    return;
  }
  favorites.forEach((fav, i) => {
    const li = document.createElement("li");
    li.className = "fav-card";

    const badge = document.createElement("span");
    badge.className = "badge " + BADGE_COLORS[i % BADGE_COLORS.length];
    badge.textContent = fav.routeno;

    const mid = document.createElement("div");
    mid.className = "fav-mid";
    const dest = document.createElement("span");
    dest.className = "fav-dest";
    dest.textContent = fav.routeno + "번";
    const status = document.createElement("span");
    status.className = "fav-status";
    status.textContent =
      (CITY_NAMES[fav.city] || fav.city) + " · 탭하여 노선도 보기";
    mid.appendChild(dest);
    mid.appendChild(status);

    const star = document.createElement("span");
    star.className = "material-symbols-outlined icon-fill fav-star-btn";
    star.textContent = FAV_ICON;
    star.title = "즐겨찾기 해제";
    star.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite(fav.city, fav.routeno);
    });

    li.appendChild(badge);
    li.appendChild(mid);
    li.appendChild(star);
    li.addEventListener("click", () => openRouteDiagram(fav.city, fav.routeno));
    list.appendChild(li);
  });
}

function renderRouteResults(items) {
  const box = document.getElementById("routeSearchResults");
  if (!box) return;
  box.innerHTML = "";
  const seen = new Set();
  const unique = [];
  items.forEach((it) => {
    const r = String(it.routeno || "").trim();
    const key = it.city + ":" + r;
    if (!r || seen.has(key)) return;
    seen.add(key);
    unique.push({ city: it.city, routeno: r });
  });
  if (unique.length === 0) {
    const empty = document.createElement("div");
    empty.className = "route-result-empty";
    empty.textContent = "일치하는 노선이 없습니다";
    box.appendChild(empty);
    return;
  }
  unique.slice(0, 24).forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "route-result-item";

    const badge = document.createElement("span");
    badge.className = "badge " + BADGE_COLORS[i % BADGE_COLORS.length];
    badge.textContent = r.routeno;

    const mid = document.createElement("span");
    mid.className = "route-result-mid";
    const name = document.createElement("span");
    name.className = "route-result-name";
    name.textContent = r.routeno + "번";
    const cityTag = document.createElement("span");
    cityTag.className = "route-result-city";
    cityTag.textContent = CITY_NAMES[r.city] || r.city;
    mid.appendChild(name);
    mid.appendChild(cityTag);

    const star = document.createElement("span");
    const fav = isFavorite(r.city, r.routeno);
    star.className =
      "material-symbols-outlined route-result-star" +
      (fav ? " icon-fill is-fav" : "");
    star.textContent = FAV_ICON;
    star.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite(r.city, r.routeno);
      const nowFav = isFavorite(r.city, r.routeno);
      star.classList.toggle("icon-fill", nowFav);
      star.classList.toggle("is-fav", nowFav);
    });

    row.appendChild(badge);
    row.appendChild(mid);
    row.appendChild(star);
    row.addEventListener("click", () => openRouteDiagram(r.city, r.routeno));
    box.appendChild(row);
  });
}

async function searchRoutes(query) {
  const box = document.getElementById("routeSearchResults");
  if (!query || query.trim().length === 0) {
    if (box) box.innerHTML = "";
    return;
  }
  if (box) {
    box.innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "route-result-loading";
    loading.textContent = "검색 중…";
    box.appendChild(loading);
  }
  try {
    const results = await Promise.all(
      CITY_CODES.map(async (city) => {
        const qs = new URLSearchParams({
          serviceKey: YOUR_API_KEY,
          cityCode: city,
          routeNo: query.trim(),
          numOfRows: "30",
          pageNo: "1",
          _type: "json",
        });
        const json = await fetchJson(`${ROUTE_API_BASE}?${qs.toString()}`);
        const items = asArray(json?.response?.body?.items?.item);
        return items.map((it) => ({ routeno: it.routeno, city: city }));
      }),
    );
    renderRouteResults(results.flat());
  } catch (e) {
    console.error("[노선검색] 실패:", e);
    if (box) {
      box.innerHTML = "";
      const err = document.createElement("div");
      err.className = "route-result-empty";
      err.textContent = "검색 중 오류가 발생했습니다";
      box.appendChild(err);
    }
  }
}

const debouncedSearchRoutes = debounce(searchRoutes, 250);

function showPopupMessage(msg) {
  const list = document.getElementById("popupList");
  if (!list) return;
  list.innerHTML = "";
  const row = document.createElement("div");
  row.className = "popup-row";
  const text = document.createElement("span");
  text.className = "popup-row-text is-error";
  text.textContent = msg;
  row.appendChild(text);
  list.appendChild(row);
}

function buildPopupList(entries) {
  const list = document.getElementById("popupList");
  if (!list) return;
  list.innerHTML = "";
  if (entries.length === 0) {
    const row = document.createElement("div");
    row.className = "popup-row";
    const text = document.createElement("span");
    text.className = "popup-row-text is-none";
    text.textContent = "이 정류장에 공지된 운행 버스가 없습니다";
    row.appendChild(text);
    list.appendChild(row);
    return;
  }
  const cityAtPopup = currentCityCode;
  entries.forEach((it, i) => {
    const row = document.createElement("div");
    row.className = "popup-row";
    row.dataset.route = it.routeno;

    const badge = document.createElement("span");
    badge.className =
      "badge clickable " + BADGE_COLORS[i % BADGE_COLORS.length];
    badge.textContent = it.routeno;
    badge.addEventListener("click", () =>
      openRouteDiagram(cityAtPopup, it.routeno),
    );

    const text = document.createElement("span");
    text.className = "popup-row-text";
    text.textContent = formatArrival(it.arrtime, it.prevCnt);
    if (it.arrtime === null) text.classList.add("is-none");
    else if (it.arrtime < 60) text.classList.add("is-soon");

    const star = document.createElement("span");
    const fav = isFavorite(cityAtPopup, it.routeno);
    star.className =
      "material-symbols-outlined popup-star" + (fav ? " icon-fill is-fav" : "");
    star.textContent = FAV_ICON;
    star.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFavorite(cityAtPopup, it.routeno);
      const nowFav = isFavorite(cityAtPopup, it.routeno);
      star.classList.toggle("icon-fill", nowFav);
      star.classList.toggle("is-fav", nowFav);
    });

    row.appendChild(badge);
    row.appendChild(text);
    row.appendChild(star);
    list.appendChild(row);
  });
}

function renderStopResults(items) {
  const box = document.getElementById("stopSearchResults");
  if (!box) return;
  box.innerHTML = "";
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "stop-result-empty";
    empty.textContent = "일치하는 정류소가 없습니다";
    box.appendChild(empty);
    return;
  }
  items.slice(0, 30).forEach((it) => {
    const row = document.createElement("div");
    row.className = "stop-result-item";

    const name = document.createElement("span");
    name.textContent = it.nodenm;
    const cityTag = document.createElement("span");
    cityTag.className = "stop-result-city";
    cityTag.textContent = CITY_NAMES[String(it.citycode)] || it.citycode;

    row.appendChild(name);
    row.appendChild(cityTag);
    row.addEventListener("click", () => selectStop(it));
    box.appendChild(row);
  });
}

function selectStop(stop) {
  currentNodeId = stop.nodeid;
  currentCityCode = String(stop.citycode);
  const nameEl = document.getElementById("popupStopName");
  if (nameEl) nameEl.textContent = stop.nodenm;
  const cityEl = document.getElementById("popupStopCity");
  if (cityEl)
    cityEl.textContent = CITY_NAMES[currentCityCode] || currentCityCode;
  const input = document.getElementById("stopSearchInput");
  if (input) input.value = "";
  const box = document.getElementById("stopSearchResults");
  if (box) box.innerHTML = "";
  liveBusMarkers.forEach((entry) => {
    clearBusAnim(entry);
    entry.overlay.setMap(null);
  });
  liveBusMarkers.clear();
  if (stop.gpslati && stop.gpslong) {
    const lat = Number(stop.gpslati),
      lng = Number(stop.gpslong);
    if (window.__map) {
      window.__map.setCenter(new kakao.maps.LatLng(lat, lng));
    } else {
      initialCenterOverride = { lat: lat, lng: lng };
    }
  }
  loadBusArrivals();
}

async function setInitialStop() {
  try {
    const qs = new URLSearchParams({
      serviceKey: YOUR_API_KEY,
      cityCode: DEFAULT_STOP_CITY,
      nodeNm: DEFAULT_STOP_NAME,
      numOfRows: "5",
      pageNo: "1",
      _type: "json",
    });
    const json = await fetchJson(`${STOP_API_BASE}?${qs.toString()}`);
    const items = asArray(json?.response?.body?.items?.item);
    if (items.length > 0) {
      const stop = Object.assign({}, items[0], {
        citycode: items[0].citycode || DEFAULT_STOP_CITY,
      });
      selectStop(stop);
      return true;
    }
  } catch (e) {
    console.error("[초기정류장] 구미역 조회 실패:", e);
  }
  return false;
}

async function searchStops(query) {
  const box = document.getElementById("stopSearchResults");
  if (!query || query.trim().length === 0) {
    if (box) box.innerHTML = "";
    return;
  }
  if (box) {
    box.innerHTML = "";
    const loading = document.createElement("div");
    loading.className = "stop-result-loading";
    loading.textContent = "검색 중…";
    box.appendChild(loading);
  }
  try {
    const results = await Promise.all(
      CITY_CODES.map(async (city) => {
        const qs = new URLSearchParams({
          serviceKey: YOUR_API_KEY,
          cityCode: city,
          nodeNm: query.trim(),
          numOfRows: "20",
          pageNo: "1",
          _type: "json",
        });
        const json = await fetchJson(`${STOP_API_BASE}?${qs.toString()}`);
        const items = asArray(json?.response?.body?.items?.item);
        return items.map((it) =>
          Object.assign({}, it, { citycode: it.citycode || city }),
        );
      }),
    );
    renderStopResults(results.flat());
  } catch (e) {
    console.error("[정류소검색] 실패:", e);
    if (box) {
      box.innerHTML = "";
      const err = document.createElement("div");
      err.className = "stop-result-empty";
      err.textContent = "검색 중 오류가 발생했습니다";
      box.appendChild(err);
    }
  }
}

const debouncedSearchStops = debounce(searchStops, 250);

let gumiBisAvailable = null;
let gumiBisPromise = null;
let gumiPlateMap = null;
let gumiRouteMap = null;

function ensureGumiBisData() {
  if (gumiBisAvailable !== null) return Promise.resolve(gumiBisAvailable);
  if (gumiBisPromise) return gumiBisPromise;
  gumiBisPromise = (async () => {
    try {
      const [colorRes, routeRes] = await Promise.all([
        fetch(GUMI_BIS_BASE + "/selectBusColorList", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "",
        }),
        fetch(GUMI_BIS_BASE + "/selectRealtimeRouteList", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "",
        }),
      ]);
      if (!colorRes.ok || !routeRes.ok) throw new Error("bad status");
      const colorJson = await colorRes.json();
      const routeJson = await routeRes.json();
      gumiPlateMap = new Map();
      (colorJson.rows || []).forEach((r) => {
        if (r.busStandardid) gumiPlateMap.set(String(r.busStandardid), r.busNo);
      });
      gumiRouteMap = new Map();
      (routeJson.rows || []).forEach((r) => {
        const key = String(r.brtId);
        if (!gumiRouteMap.has(key)) gumiRouteMap.set(key, []);
        gumiRouteMap.get(key).push(r.routeId);
      });
      gumiBisAvailable = true;
    } catch (e) {
      gumiBisAvailable = false;
    }
    return gumiBisAvailable;
  })();
  return gumiBisPromise;
}

async function fetchGumiUnofficial(routeno) {
  let ok = false;
  try {
    ok = await ensureGumiBisData();
  } catch (e) {
    ok = false;
  }
  if (!ok) return [];
  const routeIds = gumiRouteMap.get(String(routeno)) || [];
  if (routeIds.length === 0) return [];
  try {
    const results = await Promise.all(
      routeIds.map(async (rid) => {
        const params = new URLSearchParams({ routeId: rid });
        const res = await fetch(GUMI_BIS_BASE + "/getRealtimeBusLoc", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: params.toString(),
        });
        if (!res.ok) return [];
        const json = await res.json();
        return json.rows || [];
      }),
    );
    return results
      .flat()
      .map((r) => ({
        plate: gumiPlateMap.get(String(r.busStandardid)) || null,
        targetStopName: r.stopKname,
        remainTimeSec: Number(r.remainTimeSec) || 0,
      }))
      .filter((r) => r.plate);
  } catch (e) {
    return [];
  }
}

const routeMetaCache = new Map();
const routeStopsCache = new Map();

async function getRouteMeta(city, routeno) {
  const key = city + ":" + routeno;
  if (routeMetaCache.has(key)) return routeMetaCache.get(key);
  try {
    const qs = new URLSearchParams({
      serviceKey: YOUR_API_KEY,
      cityCode: city,
      routeNo: routeno,
      numOfRows: "10",
      pageNo: "1",
      _type: "json",
    });
    const json = await fetchJson(`${ROUTE_API_BASE}?${qs.toString()}`);
    const items = asArray(json?.response?.body?.items?.item);
    const match =
      items.find((it) => String(it.routeno) === String(routeno)) || items[0];
    const meta = {
      routeId: match ? match.routeid : null,
      routetp: match
        ? match.routetp || match.routetCd || match.routeType || ""
        : "",
    };
    routeMetaCache.set(key, meta);
    return meta;
  } catch (e) {
    console.error("[routeMeta] 조회 실패:", routeno, e);
    const meta = { routeId: null, routetp: "" };
    routeMetaCache.set(key, meta);
    return meta;
  }
}

async function getRouteId(city, routeno) {
  const meta = await getRouteMeta(city, routeno);
  return meta.routeId;
}

function getRouteColor(city, routeno) {
  const meta = routeMetaCache.get(city + ":" + routeno);
  const tp = meta ? meta.routetp : "";
  return ROUTE_TYPE_COLORS[tp] || ROUTE_TYPE_COLORS.default;
}

async function getRouteStopsList(city, routeno, routeId) {
  const cacheKey = city + ":" + routeno;
  const cached = routeStopsCache.get(cacheKey);
  if (cached) return cached;
  try {
    const qs = new URLSearchParams({
      serviceKey: YOUR_API_KEY,
      cityCode: city,
      routeId: routeId,
      numOfRows: "100",
      pageNo: "1",
      _type: "json",
    });
    const json = await fetchJson(`${ROUTE_STOPS_API_BASE}?${qs.toString()}`);
    let items = asArray(json?.response?.body?.items?.item);
    items.sort(function (a, b) {
      return Number(a.nodeord) - Number(b.nodeord);
    });
    routeStopsCache.set(cacheKey, items);
    return items;
  } catch (e) {
    console.error("[노선정류소] 조회 실패:", routeno, e);
    return [];
  }
}

function nearestStopIndex(stops, lat, lng) {
  let best = -1;
  let bestDist = Infinity;
  stops.forEach((s, idx) => {
    const sLat = Number(s.gpslati);
    const sLng = Number(s.gpslong);
    if (Number.isNaN(sLat) || Number.isNaN(sLng)) return;
    const d = (sLat - lat) * (sLat - lat) + (sLng - lng) * (sLng - lng);
    if (d < bestDist) {
      bestDist = d;
      best = idx;
    }
  });
  return best;
}

function closeRouteDiagram() {
  const el = document.getElementById("routeDiagramOverlay");
  if (el) el.remove();
}

function showRouteDiagramModal(city, routeno, opts) {
  opts = opts || {};
  let overlay = document.getElementById("routeDiagramOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "routeDiagramOverlay";
    overlay.className = "route-diagram-overlay";
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeRouteDiagram();
    });
    var shell = document.querySelector(".app-shell");
    (shell || document.body).appendChild(overlay);
  }
  const fav = isFavorite(city, routeno);
  const cityName = CITY_NAMES[city] || city;
  overlay.innerHTML =
    '<section class="win route-diagram-window">' +
    '<div class="win-titlebar">' +
    '<span class="material-symbols-outlined modal-close-btn" id="rdClose">close</span>' +
    '<span class="win-title">' +
    cityName +
    " " +
    routeno +
    " 노선도</span>" +
    "</div>" +
    '<div class="route-diagram-body">' +
    '<div class="route-diagram-head">' +
    '<span class="badge b-blue" style="font-size:14px;min-width:44px;height:32px;">' +
    routeno +
    "</span>" +
    '<span class="rd-live">' +
    (opts.liveText || "") +
    "</span>" +
    '<span class="material-symbols-outlined rd-fav-btn ' +
    (fav ? "icon-fill is-fav" : "") +
    '" id="rdFavBtn">' +
    FAV_ICON +
    "</span>" +
    "</div>" +
    '<div class="route-diagram-list" id="rdList"></div>' +
    "</div>" +
    "</section>";

  document
    .getElementById("rdClose")
    .addEventListener("click", closeRouteDiagram);
  document.getElementById("rdFavBtn").addEventListener("click", function () {
    toggleFavorite(city, routeno);
    const nowFav = isFavorite(city, routeno);
    const btn = document.getElementById("rdFavBtn");
    btn.classList.toggle("icon-fill", nowFav);
    btn.classList.toggle("is-fav", nowFav);
  });

  const listEl = document.getElementById("rdList");
  if (opts.loading) {
    listEl.innerHTML = '<div class="rd-loading">불러오는 중…</div>';
    return;
  }
  if (opts.errorMsg) {
    listEl.innerHTML = '<div class="rd-loading">' + opts.errorMsg + "</div>";
    return;
  }
  const stops = opts.stops || [];
  if (stops.length === 0) {
    listEl.innerHTML = '<div class="rd-loading">정류소 정보가 없습니다</div>';
    return;
  }
  const busStopMap = opts.busStopMap || new Map();
  listEl.innerHTML = "";
  stops.forEach(function (s, idx) {
    const row = document.createElement("div");
    const isActive = busStopMap.has(idx);
    row.className = "rd-stop" + (isActive ? " rd-stop-active" : "");
    row.innerHTML =
      '<div class="rd-stop-line"><span class="rd-stop-dot"></span></div>' +
      '<div class="rd-stop-info">' +
      '<span class="rd-stop-name">' +
      (s.nodenm || "") +
      "</span>" +
      '<span class="rd-stop-id">' +
      (s.nodeno || s.nodeid || "") +
      "</span>" +
      "</div>" +
      (isActive
        ? '<span class="material-symbols-outlined icon-fill rd-stop-bus-icon" title="현재 버스 위치">directions_bus</span>'
        : "");
    listEl.appendChild(row);
  });
  if (busStopMap.size > 0) {
    const activeRow = listEl.querySelector(".rd-stop-active");
    if (activeRow) activeRow.scrollIntoView({ block: "center" });
  }
}

async function openRouteDiagram(city, routeno) {
  showRouteDiagramModal(city, routeno, { loading: true });
  const routeId = await getRouteId(city, routeno);
  if (!routeId) {
    showRouteDiagramModal(city, routeno, {
      errorMsg: "노선 정보를 찾을 수 없습니다",
    });
    return;
  }

  const stops = await getRouteStopsList(city, routeno, routeId);
  if (!stops || stops.length === 0) {
    showRouteDiagramModal(city, routeno, {
      errorMsg: "노선도를 불러오지 못했습니다",
    });
    return;
  }

  let positions = [];
  try {
    positions = await fetchBusPositions(city, routeno);
  } catch (e) {}

  const busStopMap = new Map();
  positions.forEach((p) => {
    let idx = -1;
    if (p.nodeid) idx = stops.findIndex((s) => s.nodeid === p.nodeid);
    if (idx === -1) idx = nearestStopIndex(stops, p.lat, p.lng);
    if (idx >= 0) {
      if (!busStopMap.has(idx)) busStopMap.set(idx, []);
      busStopMap.get(idx).push(p.vehicleno);
    }
  });

  const liveText =
    positions.length > 0
      ? "현재 " + positions.length + "대 운행중"
      : "운행 정보 없음";
  showRouteDiagramModal(city, routeno, {
    stops: stops,
    liveText: liveText,
    busStopMap: busStopMap,
  });
}

let kakaoPlacesSvc = null;
let dirStart = null;
let dirEnd = null;
let selectedDirCard = null;
let dirPathOverlays = [];

function getPlacesService() {
  if (
    !kakaoPlacesSvc &&
    window.kakao &&
    window.kakao.maps &&
    window.kakao.maps.services
  ) {
    kakaoPlacesSvc = new kakao.maps.services.Places();
  }
  return kakaoPlacesSvc;
}

function searchPlacesKakao(query, cb) {
  const svc = getPlacesService();
  if (!svc) {
    cb([]);
    return;
  }
  svc.keywordSearch(query, function (data, status) {
    if (status === kakao.maps.services.Status.OK) {
      cb(
        data
          .slice(0, 8)
          .map((d) => ({
            name: d.place_name,
            addr: d.road_address_name || d.address_name,
            lng: Number(d.x),
            lat: Number(d.y),
          })),
      );
    } else {
      cb([]);
    }
  });
}

function renderDirSuggestions(boxId, items, onSelect) {
  const box = document.getElementById(boxId);
  if (!box) return;
  box.innerHTML = "";
  if (items.length === 0) return;
  items.forEach((it) => {
    const row = document.createElement("div");
    row.className = "dir-suggestion-item";
    row.innerHTML =
      it.name + '<span class="dir-sugg-addr">' + (it.addr || "") + "</span>";
    row.addEventListener("click", () => onSelect(it));
    box.appendChild(row);
  });
}

function updateDirSearchBtn() {
  const btn = document.getElementById("dirSearchBtn");
  if (!btn) return;
  const ready = !!(dirStart && dirEnd);
  btn.classList.toggle("disabled", !ready);
}

function selectDirPlace(which, place) {
  if (which === "start") dirStart = place;
  else dirEnd = place;
  const input = document.getElementById(
    which === "start" ? "dirStartInput" : "dirEndInput",
  );
  if (input) input.value = place.name;
  const box = document.getElementById(
    which === "start" ? "dirStartSuggest" : "dirEndSuggest",
  );
  if (box) box.innerHTML = "";
  updateDirSearchBtn();
}

function dirTrafficLabel(sub) {
  if (sub.trafficType === 3)
    return {
      type: "walk",
      text: "도보 " + Math.round(sub.distance || 0) + "m",
    };
  if (sub.trafficType === 2) {
    const bus = (sub.lane && sub.lane[0] && sub.lane[0].busNo) || "버스";
    return {
      type: "bus",
      text: bus,
      sub: sub.stationCount ? sub.stationCount + "정거장 이동" : "",
    };
  }
  if (sub.trafficType === 1) {
    const line = (sub.lane && sub.lane[0] && sub.lane[0].name) || "지하철";
    return {
      type: "subway",
      text: line,
      sub: sub.stationCount ? sub.stationCount + "정거장 이동" : "",
    };
  }
  return { type: "walk", text: "이동" };
}

function clearDirRoutePath() {
  dirPathOverlays.forEach(function (o) {
    o.setMap(null);
  });
  dirPathOverlays = [];
}

function cancelSelectedRoute() {
  if (selectedDirCard) selectedDirCard.classList.remove("is-selected");
  selectedDirCard = null;
  clearDirRoutePath();
}

function createSimplePin(map, position, hexColor, iconName) {
  const el = document.createElement("div");
  el.style.cssText =
    "width:26px;height:26px;border-radius:50% 50% 50% 4px;transform:rotate(45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 3px 8px rgba(0,0,0,0.35);background:" +
    hexColor +
    ";";
  el.innerHTML =
    '<span class="material-symbols-outlined icon-fill" style="transform:rotate(-45deg);color:#fff;width:15px;height:15px;font-size:15px;">' +
    iconName +
    "</span>";
  return new kakao.maps.CustomOverlay({
    map: map,
    position: position,
    content: el,
    yAnchor: 1,
    xAnchor: 0.5,
    clickable: false,
  });
}

function drawStartEndMarkers(map, bounds) {
  if (dirStart) {
    const startPos = new kakao.maps.LatLng(dirStart.lat, dirStart.lng);
    bounds.extend(startPos);
    dirPathOverlays.push(
      createSimplePin(map, startPos, "#0a6cff", "trip_origin"),
    );
  }
  if (dirEnd) {
    const endPos = new kakao.maps.LatLng(dirEnd.lat, dirEnd.lng);
    bounds.extend(endPos);
    dirPathOverlays.push(createSimplePin(map, endPos, "#e0392f", "flag"));
  }
}

function drawFallbackStraightPath(map, bounds, subPaths) {
  subPaths.forEach(function (sub) {
    if (!(sub.startX && sub.startY && sub.endX && sub.endY)) return;
    const points = [
      new kakao.maps.LatLng(Number(sub.startY), Number(sub.startX)),
      new kakao.maps.LatLng(Number(sub.endY), Number(sub.endX)),
    ];
    points.forEach(function (p) {
      bounds.extend(p);
    });
    const isWalk = sub.trafficType === 3;
    const color = isWalk
      ? "#9aa3ad"
      : sub.trafficType === 1
        ? "#16a34a"
        : "#0a6cff";
    const line = new kakao.maps.Polyline({
      path: points,
      strokeWeight: isWalk ? 4 : 6,
      strokeColor: color,
      strokeOpacity: 0.9,
      strokeStyle: isWalk ? "shortdash" : "solid",
    });
    line.setMap(map);
    dirPathOverlays.push(line);
  });
}

async function drawDirRoutePath(path) {
  if (!window.__map || !window.kakao) return;
  clearDirRoutePath();
  const map = window.__map;
  const bounds = new kakao.maps.LatLngBounds();
  const subPaths = path.subPath || [];
  const mapObj = path.info && path.info.mapObj;

  let laneData = null;
  if (mapObj) {
    try {
      const qs = new URLSearchParams({
        apiKey: ODSAY_API_KEY,
        mapObject: "0:0@" + mapObj,
      });
      const json = await fetchJson(`${ODSAY_LANE_BASE}?${qs.toString()}`);
      laneData = json && json.result;
    } catch (e) {
      console.error("[길찾기] 노선그래픽 조회 실패:", e);
    }
  }

  if (laneData && Array.isArray(laneData.lane) && laneData.lane.length > 0) {
    laneData.lane.forEach(function (lane, idx) {
      const sub = subPaths[idx];
      const isWalk = sub ? sub.trafficType === 3 : false;
      const color = isWalk
        ? "#9aa3ad"
        : sub && sub.trafficType === 1
          ? "#16a34a"
          : "#0a6cff";
      (lane.section || []).forEach(function (section) {
        const points = (section.graphPos || []).map(function (p) {
          return new kakao.maps.LatLng(Number(p.y), Number(p.x));
        });
        if (points.length < 2) return;
        points.forEach(function (p) {
          bounds.extend(p);
        });
        const line = new kakao.maps.Polyline({
          path: points,
          strokeWeight: isWalk ? 4 : 6,
          strokeColor: color,
          strokeOpacity: 0.9,
          strokeStyle: isWalk ? "shortdash" : "solid",
        });
        line.setMap(map);
        dirPathOverlays.push(line);
      });
    });
  } else {
    drawFallbackStraightPath(map, bounds, subPaths);
  }

  drawStartEndMarkers(map, bounds);
  if (!bounds.isEmpty()) map.setBounds(bounds);
}

function selectDirRoute(card, path) {
  if (selectedDirCard) selectedDirCard.classList.remove("is-selected");
  if (selectedDirCard === card) {
    selectedDirCard = null;
    clearDirRoutePath();
    return;
  }
  card.classList.add("is-selected");
  selectedDirCard = card;
  drawDirRoutePath(path);
}

function renderDirResults(paths) {
  const box = document.getElementById("dirResults");
  if (!box) return;
  box.innerHTML = "";
  selectedDirCard = null;
  clearDirRoutePath();
  if (!paths || paths.length === 0) {
    box.innerHTML = '<div class="rd-loading">경로를 찾지 못했습니다</div>';
    return;
  }
  paths.slice(0, 5).forEach((p) => {
    const info = p.info || {};
    const card = document.createElement("div");
    card.className = "dir-route-card";

    const summary = document.createElement("div");
    summary.className = "dir-route-summary";
    const time = document.createElement("span");
    time.className = "dir-route-time";
    time.textContent = (info.totalTime || "?") + "분";
    const meta = document.createElement("span");
    meta.className = "dir-route-meta";
    const transfers =
      (info.busTransitCount || 0) + (info.subwayTransitCount || 0);
    meta.textContent =
      "환승 " +
      transfers +
      "회 · 도보 " +
      Math.round(info.totalWalk || 0) +
      "m";
    const selectedBadge = document.createElement("span");
    selectedBadge.className = "dir-route-selected-badge";
    selectedBadge.innerHTML =
      '<span class="material-symbols-outlined icon-fill">cancel</span>취소';
    selectedBadge.addEventListener("click", function (e) {
      e.stopPropagation();
      cancelSelectedRoute();
    });
    summary.appendChild(time);
    summary.appendChild(meta);
    summary.appendChild(selectedBadge);

    const legs = document.createElement("div");
    legs.className = "dir-route-legs";
    (p.subPath || []).forEach((sub, idx) => {
      const label = dirTrafficLabel(sub);
      if (label.type === "walk" && (sub.distance || 0) < 30) return;
      if (idx > 0) {
        const arrow = document.createElement("span");
        arrow.className = "dir-leg-arrow";
        arrow.textContent = "→";
        legs.appendChild(arrow);
      }
      if (label.type === "walk") {
        const el = document.createElement("span");
        el.className = "dir-leg-walk";
        el.textContent = label.text;
        legs.appendChild(el);
      } else {
        const el = document.createElement("span");
        el.className =
          "dir-leg-badge " +
          (label.type === "subway" ? "dir-leg-subway" : "dir-leg-bus");
        el.textContent = label.text;
        el.title = label.text;
        legs.appendChild(el);
      }
    });

    card.appendChild(summary);
    card.appendChild(legs);
    card.addEventListener("click", () => selectDirRoute(card, p));
    box.appendChild(card);
  });
}

async function searchTransitRoute() {
  if (!dirStart || !dirEnd) return;
  const box = document.getElementById("dirResults");
  clearDirRoutePath();
  if (box) box.innerHTML = '<div class="rd-loading">경로 검색 중…</div>';
  try {
    const qs = new URLSearchParams({
      apiKey: ODSAY_API_KEY,
      SX: String(dirStart.lng),
      SY: String(dirStart.lat),
      EX: String(dirEnd.lng),
      EY: String(dirEnd.lat),
    });
    const json = await fetchJson(`${ODSAY_BASE}?${qs.toString()}`);
    if (json.error) {
      if (box)
        box.innerHTML =
          '<div class="rd-loading">' +
          (json.error[0]?.message || "경로를 찾을 수 없습니다") +
          "</div>";
      return;
    }
    const paths = json?.result?.path || [];
    renderDirResults(paths);
  } catch (e) {
    console.error("[길찾기] 실패:", e);
    if (box)
      box.innerHTML = '<div class="rd-loading">경로 검색에 실패했습니다</div>';
  }
}

function closeDirections() {
  const el = document.getElementById("directionsOverlay");
  if (el) el.remove();
}

function openDirections() {
  let overlay = document.getElementById("directionsOverlay");
  if (overlay) return;
  overlay = document.createElement("div");
  overlay.id = "directionsOverlay";
  overlay.className = "directions-overlay";
  overlay.addEventListener("click", function (e) {
    if (e.target === overlay) closeDirections();
  });
  var shell = document.querySelector(".app-shell");
  (shell || document.body).appendChild(overlay);

  overlay.innerHTML =
    '<section class="win directions-window">' +
    '<div class="win-titlebar">' +
    '<span class="material-symbols-outlined modal-close-btn" id="dirClose">close</span>' +
    '<span class="win-title">길찾기</span>' +
    "</div>" +
    '<div class="directions-body">' +
    '<div class="dir-field">' +
    "<label>출발지</label>" +
    '<div class="dir-input-row"><span class="material-symbols-outlined">trip_origin</span><input type="text" id="dirStartInput" placeholder="장소 검색" autocomplete="off"></div>' +
    '<div class="dir-suggestions" id="dirStartSuggest"></div>' +
    "</div>" +
    '<div class="dir-field">' +
    "<label>도착지</label>" +
    '<div class="dir-input-row"><span class="material-symbols-outlined">flag</span><input type="text" id="dirEndInput" placeholder="장소 검색" autocomplete="off"></div>' +
    '<div class="dir-suggestions" id="dirEndSuggest"></div>' +
    "</div>" +
    '<div class="dir-search-btn disabled" id="dirSearchBtn">경로 검색</div>' +
    '<div class="dir-results" id="dirResults"></div>' +
    "</div>" +
    "</section>";

  document
    .getElementById("dirClose")
    .addEventListener("click", closeDirections);
  document
    .getElementById("dirSearchBtn")
    .addEventListener("click", searchTransitRoute);

  const startInput = document.getElementById("dirStartInput");
  const endInput = document.getElementById("dirEndInput");
  const debouncedStart = debounce((q) => {
    if (!q) {
      document.getElementById("dirStartSuggest").innerHTML = "";
      return;
    }
    searchPlacesKakao(q, (items) =>
      renderDirSuggestions("dirStartSuggest", items, (p) =>
        selectDirPlace("start", p),
      ),
    );
  }, 300);
  const debouncedEnd = debounce((q) => {
    if (!q) {
      document.getElementById("dirEndSuggest").innerHTML = "";
      return;
    }
    searchPlacesKakao(q, (items) =>
      renderDirSuggestions("dirEndSuggest", items, (p) =>
        selectDirPlace("end", p),
      ),
    );
  }, 300);
  startInput.addEventListener("input", (e) => debouncedStart(e.target.value));
  endInput.addEventListener("input", (e) => debouncedEnd(e.target.value));
}

async function fetchBusPositions(city, routeno) {
  const routeId = await getRouteId(city, routeno);
  if (!routeId) return [];
  try {
    const qs = new URLSearchParams({
      serviceKey: YOUR_API_KEY,
      cityCode: city,
      routeId: routeId,
      numOfRows: "50",
      pageNo: "1",
      _type: "json",
    });
    const json = await fetchJson(`${LOC_API_BASE}?${qs.toString()}`);
    const items = asArray(json?.response?.body?.items?.item);
    if (items.length === 0) return [];

    const direct = items
      .map((it) => ({
        lat: Number(it.gpslati),
        lng: Number(it.gpslong),
        vehicleno: it.vehicleno,
      }))
      .filter((p) => !Number.isNaN(p.lat) && !Number.isNaN(p.lng));
    if (direct.length > 0) return direct;

    const stops = await getRouteStopsList(city, routeno, routeId);
    const nodeMap = new Map();
    const nameMap = new Map();
    stops.forEach((s) => {
      if (s.nodeid)
        nodeMap.set(s.nodeid, {
          lat: Number(s.gpslati),
          lng: Number(s.gpslong),
        });
      if (s.nodenm)
        nameMap.set(String(s.nodenm).trim(), {
          lat: Number(s.gpslati),
          lng: Number(s.gpslong),
        });
    });

    let unofficial = [];
    if (CITY_STOP_BASED[city]) {
      try {
        unofficial = await fetchGumiUnofficial(routeno);
      } catch (e) {
        unofficial = [];
      }
    }

    return items
      .map((it) => {
        const node = nodeMap.get(it.nodeid);
        if (!node || Number.isNaN(node.lat) || Number.isNaN(node.lng))
          return null;
        const pos = {
          lat: node.lat,
          lng: node.lng,
          vehicleno: it.vehicleno,
          nodeid: it.nodeid,
        };
        if (unofficial.length > 0) {
          const match = unofficial.find((u) => u.plate === it.vehicleno);
          if (match && match.remainTimeSec > 0) {
            const target = nameMap.get(
              String(match.targetStopName || "").trim(),
            );
            if (
              target &&
              !Number.isNaN(target.lat) &&
              !Number.isNaN(target.lng)
            ) {
              pos.animTo = target;
              pos.animMs = match.remainTimeSec * 1000;
            }
          }
        }
        return pos;
      })
      .filter((p) => p !== null);
  } catch (e) {
    console.error("[busPos] 조회 실패:", routeno, e);
    return [];
  }
}

function computeBearing(lat1, lng1, lat2, lng2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  const brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

function createBusOverlay(map, position, hexColor, routeno, city, headingDeg) {
  var label = String(routeno);
  var fontSize = label.length >= 4 ? 8 : label.length === 3 ? 9.5 : 12;
  const el = document.createElement("div");
  el.style.cssText =
    "position:relative;width:28px;height:42px;cursor:pointer;pointer-events:auto;";
  el.innerHTML =
    '<div class="bus-rot" style="width:28px;height:42px;transform:rotate(' +
    (headingDeg || 0) +
    'deg);transition:transform 0.5s ease;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.35));">' +
    '<svg width="28" height="42" viewBox="0 0 28 42">' +
    '<rect x="2" y="2" width="24" height="38" rx="12" fill="' +
    hexColor +
    '" stroke="#fff" stroke-width="1.6"/>' +
    '<line x1="6" y1="11" x2="22" y2="11" stroke="#fff" stroke-width="1.6"/>' +
    '<text x="14" y="27" text-anchor="middle" fill="#fff" font-weight="800" font-size="' +
    fontSize +
    '" font-family="Pretendard Variable, Pretendard, sans-serif">' +
    label +
    "</text>" +
    "</svg>" +
    "</div>";
  el.addEventListener("click", function (e) {
    e.stopPropagation();
    openRouteDiagram(city, routeno);
  });
  const overlay = new kakao.maps.CustomOverlay({
    map: map,
    position: position,
    content: el,
    yAnchor: 0.5,
    xAnchor: 0.5,
    clickable: true,
  });
  return { overlay: overlay, rotEl: el.querySelector(".bus-rot") };
}

const liveBusMarkers = new Map();
const STALE_MS = 90000;

function clearBusAnim(entry) {
  if (entry && entry.animTimer) {
    cancelAnimationFrame(entry.animTimer);
    entry.animTimer = null;
  }
}

function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function animateBusTo(entry, fromLat, fromLng, toLat, toLng, durationMs) {
  clearBusAnim(entry);
  if (!durationMs || durationMs <= 0) return;
  if (fromLat === toLat && fromLng === toLng) return;
  const dur = Math.min(Math.max(durationMs, 400), 120000);
  const start = performance.now();
  function step(nowTs) {
    const t = Math.min(1, (nowTs - start) / dur);
    const eased = easeInOutQuad(t);
    const lat = fromLat + (toLat - fromLat) * eased;
    const lng = fromLng + (toLng - fromLng) * eased;
    entry.overlay.setPosition(new kakao.maps.LatLng(lat, lng));
    if (t < 1) {
      entry.animTimer = requestAnimationFrame(step);
    } else {
      entry.animTimer = null;
    }
  }
  entry.animTimer = requestAnimationFrame(step);
}

async function updateBusMarkers(entries) {
  if (!window.__map || !window.kakao) return;
  const map = window.__map;
  const cityAtUpdate = currentCityCode;
  const now = Date.now();
  const seenKeys = new Set();

  for (let i = 0; i < entries.length; i++) {
    const it = entries[i];
    let positions = [];
    try {
      positions = await fetchBusPositions(cityAtUpdate, it.routeno);
    } catch (e) {
      console.error("[busPos] 오류:", it.routeno, e);
    }
    const hexColor = getRouteColor(cityAtUpdate, it.routeno);
    positions.forEach((p, idx) => {
      const key = p.vehicleno
        ? "v:" + p.vehicleno
        : "r:" + it.routeno + ":" + idx;
      seenKeys.add(key);
      const existing = liveBusMarkers.get(key);
      if (existing) {
        const targetLat = p.animTo ? p.animTo.lat : p.lat;
        const targetLng = p.animTo ? p.animTo.lng : p.lng;
        if (
          Math.abs(existing.lastLat - targetLat) > 1e-7 ||
          Math.abs(existing.lastLng - targetLng) > 1e-7
        ) {
          const brng = computeBearing(
            existing.lastLat,
            existing.lastLng,
            targetLat,
            targetLng,
          );
          if (existing.rotEl)
            existing.rotEl.style.transform =
              "rotate(" + brng.toFixed(1) + "deg)";
        }
        if (p.animTo) {
          animateBusTo(
            existing,
            p.lat,
            p.lng,
            p.animTo.lat,
            p.animTo.lng,
            p.animMs,
          );
          existing.lastLat = p.animTo.lat;
          existing.lastLng = p.animTo.lng;
        } else {
          const curPos = existing.overlay.getPosition();
          const curLat = curPos.getLat();
          const curLng = curPos.getLng();
          if (
            Math.abs(curLat - p.lat) > 1e-7 ||
            Math.abs(curLng - p.lng) > 1e-7
          ) {
            animateBusTo(
              existing,
              curLat,
              curLng,
              p.lat,
              p.lng,
              DEFAULT_GLIDE_MS,
            );
          } else {
            clearBusAnim(existing);
          }
          existing.lastLat = p.lat;
          existing.lastLng = p.lng;
        }
        existing.lastSeen = now;
      } else {
        const pos = new kakao.maps.LatLng(p.lat, p.lng);
        const created = createBusOverlay(
          map,
          pos,
          hexColor,
          it.routeno,
          cityAtUpdate,
          0,
        );
        const entry = {
          overlay: created.overlay,
          rotEl: created.rotEl,
          lastSeen: now,
          animTimer: null,
          lastLat: p.animTo ? p.animTo.lat : p.lat,
          lastLng: p.animTo ? p.animTo.lng : p.lng,
        };
        liveBusMarkers.set(key, entry);
        if (p.animTo) {
          animateBusTo(
            entry,
            p.lat,
            p.lng,
            p.animTo.lat,
            p.animTo.lng,
            p.animMs,
          );
        }
      }
    });
    if (i < entries.length - 1) await sleep(POS_REQUEST_GAP_MS);
  }

  liveBusMarkers.forEach((entry, key) => {
    if (!seenKeys.has(key) && now - entry.lastSeen > STALE_MS) {
      clearBusAnim(entry);
      entry.overlay.setMap(null);
      liveBusMarkers.delete(key);
    }
  });
}

async function loadBusArrivals() {
  if (!YOUR_API_KEY) {
    showPopupMessage("API 키 미설정");
    return;
  }
  try {
    const res = await fetch(buildUrl(), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { code, items = [], msg } = parseResponse(await res.text());
    if (code === "ERROR") {
      showPopupMessage("조회 오류");
      return;
    }
    if (code === "NO_DATA" || items.length === 0) {
      showPopupMessage("운행 차량 없음");
      return;
    }

    const fastest = new Map();
    items.forEach((it) => {
      if (!it.routeno) return;
      const prev = fastest.get(it.routeno);
      if (!prev || (it.arrtime ?? 1e9) < (prev.arrtime ?? 1e9))
        fastest.set(it.routeno, it);
    });

    const entries = [...fastest.values()].sort((a, b) => {
      const av = a.arrtime === null ? Infinity : a.arrtime;
      const bv = b.arrtime === null ? Infinity : b.arrtime;
      return av - bv;
    });

    buildPopupList(entries);
    updateBusMarkers(entries);
  } catch (err) {
    showPopupMessage(
      err.message.includes("fetch")
        ? "네트워크/CORS 오류"
        : "정보를 불러올 수 없음",
    );
  }
}

function initKakaoMapWhenReady() {
  var container = document.getElementById("kakaoMap");
  var tries = 0;
  (function poll() {
    if (window.kakao && window.kakao.maps) {
      startKakaoMap(container);
      return;
    }
    tries++;
    if (window.__kakaoSdkFailed || tries > 100) {
      console.error("[kakao] SDK 미로드");
      if (container) {
        var fb = document.createElement("div");
        fb.className = "map-fallback";
        fb.innerHTML =
          "지도를 불러오지 못했습니다.<br />API 키와 사이트 도메인 등록을 확인하세요.";
        container.appendChild(fb);
      }
      return;
    }
    setTimeout(poll, 50);
  })();
}

function startKakaoMap(container) {
  kakao.maps.load(function () {
    if (!container) return console.error("[kakao] #kakaoMap 없음");
    if (container.offsetHeight === 0) container.style.height = "400px";
    var initLat = initialCenterOverride ? initialCenterOverride.lat : 36.1195;
    var initLng = initialCenterOverride ? initialCenterOverride.lng : 128.3446;
    var center = new kakao.maps.LatLng(initLat, initLng);
    var map = new kakao.maps.Map(container, { center: center, level: 3 });
    map.setZoomable(true);
    map.setDraggable(true);
    var pinchAccum = 0,
      pinchLock = false;
    container.addEventListener(
      "wheel",
      function (e) {
        if (!e.ctrlKey) return;
        e.preventDefault();
        pinchAccum += e.deltaY;
        if (pinchLock || Math.abs(pinchAccum) < 12) return;
        var mousePos = map.getCenter();
        if (pinchAccum > 0)
          map.setLevel(map.getLevel() + 1, { anchor: mousePos });
        else map.setLevel(map.getLevel() - 1, { anchor: mousePos });
        pinchAccum = 0;
        pinchLock = true;
        setTimeout(function () {
          pinchLock = false;
        }, 90);
      },
      { passive: false },
    );
    map.addControl(
      new kakao.maps.ZoomControl(),
      kakao.maps.ControlPosition.RIGHT,
    );
    var clusterEl = document.querySelector(".cluster");
    function settleMap() {
      map.relayout();
      var lat = initialCenterOverride ? initialCenterOverride.lat : initLat;
      var lng = initialCenterOverride ? initialCenterOverride.lng : initLng;
      map.setCenter(new kakao.maps.LatLng(lat, lng));
    }
    if (clusterEl) {
      var settleFallback = setTimeout(settleMap, 900);
      clusterEl.addEventListener(
        "animationend",
        function () {
          clearTimeout(settleFallback);
          settleMap();
        },
        { once: true },
      );
    } else {
      setTimeout(settleMap, 700);
    }
    window.addEventListener("resize", function () {
      map.relayout();
    });
    window.__map = map;
    console.log("[kakao] 지도 초기화 완료");
  });
}

document.addEventListener("DOMContentLoaded", function () {
  updateClock();
  setInterval(updateClock, 15000);
  initKakaoMapWhenReady();
  renderFavoritesSidebar();
  setInitialStop().then(function (ok) {
    if (!ok) loadBusArrivals();
  });
  setInterval(loadBusArrivals, 5000);

  var stopInput = document.getElementById("stopSearchInput");
  if (stopInput) {
    stopInput.addEventListener("input", function (e) {
      debouncedSearchStops(e.target.value);
    });
  }

  var routeInput = document.getElementById("routeSearchInput");
  if (routeInput) {
    routeInput.addEventListener("input", function (e) {
      debouncedSearchRoutes(e.target.value);
    });
  }

  var dockDir = document.getElementById("dockDirections");
  if (dockDir) dockDir.addEventListener("click", openDirections);

  var mobileFab = document.getElementById("mobileDirectionsFab");
  if (mobileFab) mobileFab.addEventListener("click", openDirections);

  var mtabButtons = document.querySelectorAll(".mtab-btn");
  document.body.dataset.mtab = "map";
  mtabButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var tab = btn.dataset.mtab;
      document.body.dataset.mtab = tab;
      mtabButtons.forEach(function (b) {
        b.classList.toggle("active", b === btn);
      });
      if (tab === "map" && window.__map) {
        setTimeout(function () {
          window.__map.relayout();
        }, 60);
      }
    });
  });
});
