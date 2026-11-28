// ParkSG website: shared settings and helpers. No build step; plain script.
// The key below is the Supabase *publishable* key (the same one the iPhone app ships). It can only read the
// public tables and file a pending report.
(function () {
  "use strict";
  var SUPABASE_URL = "https://dlhvpbazwsnqqxjwksgk.supabase.co";
  var P = {
    supabaseUrl: SUPABASE_URL,
    publishableKey: "sb_publishable_o0CmhNCFhdjtP9D1SeAoFA_c-UXil1o",
    availabilityUrl: SUPABASE_URL + "/functions/v1/availability",
    askUrl: SUPABASE_URL + "/functions/v1/ask-web",
    center: [1.3521, 103.8198]
  };

  P.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // Must stay identical to slug_for() in tools/site/build.py.
  P.slugFor = function (id) {
    return String(id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  };

  P.metres = function (aLat, aLon, bLat, bLon) {
    var r = 6371000, p1 = aLat * Math.PI / 180, p2 = bLat * Math.PI / 180;
    var d1 = p2 - p1, d2 = (bLon - aLon) * Math.PI / 180;
    var h = Math.sin(d1 / 2) * Math.sin(d1 / 2) + Math.cos(p1) * Math.cos(p2) * Math.sin(d2 / 2) * Math.sin(d2 / 2);
    return 2 * r * Math.asin(Math.sqrt(h));
  };
  P.walkMinutes = function (m) { return Math.max(1, Math.floor(m / 80)); };

  // Singapore clock, whatever the visitor's own time zone is.
  P.sgNow = function () {
    var d = new Date(Date.now() + 8 * 3600 * 1000);
    return {
      dow: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCHours() * 60 + d.getUTCMinutes(),
      date: d.toISOString().slice(0, 10)
    };
  };
  P.clock = function (iso) {
    var d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
    if (isNaN(d)) return "";
    var h = d.getUTCHours(), m = d.getUTCMinutes();
    return (h % 12 === 0 ? 12 : h % 12) + ":" + (m < 10 ? "0" : "") + m + (h >= 12 ? " pm" : " am");
  };
  P.hourLabel = function (h) { return (h % 12 === 0 ? 12 : h % 12) + (h >= 12 ? " pm" : " am"); };

  // Live free lots from the `availability` Edge Function. A plain GET with no extra headers, so the browser
  // sends no preflight. Resolves to { lots: {id: {available,total,source}}, updated_at } or null when the
  // feed can't be read.
  P.fetchLots = function (ids) {
    if (!ids || !ids.length) return Promise.resolve({ lots: {}, updated_at: null });
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 12000);
    return fetch(P.availabilityUrl + "?ids=" + encodeURIComponent(ids.join(",")), { cache: "no-store", signal: ctrl ? ctrl.signal : undefined })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) { return json && json.lots ? json : null; })
      .catch(function () { return null; })
      .then(function (v) { clearTimeout(timer); return v; });
  };
  P.lotSource = function (s) {
    return s === "data.gov.sg" ? "HDB carpark availability (data.gov.sg)" : s === "lta" ? "LTA DataMall carpark availability" : "Not known";
  };

  // Map: Leaflet with OneMap base tiles from the Singapore Land Authority (no key; attribution required).
  P.makeMap = function (el, lat, lon, zoom) {
    var dark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var map = L.map(el, {
      center: [lat, lon], zoom: zoom, minZoom: 11, maxZoom: 19, scrollWheelZoom: false,
      maxBounds: [[1.144, 103.535], [1.494, 104.502]], maxBoundsViscosity: 0.8
    });
    L.tileLayer("https://www.onemap.gov.sg/maps/tiles/" + (dark ? "Night" : "Default") + "/{z}/{x}/{y}.png", {
      detectRetina: true, maxZoom: 19, minZoom: 11,
      attribution: '<img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo.png" alt="" style="height:16px;width:16px"> ' +
        '<a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener noreferrer">OneMap</a> &copy; contributors | ' +
        '<a href="https://www.sla.gov.sg/" target="_blank" rel="noopener noreferrer">Singapore Land Authority</a>'
    }).addTo(map);
    map.on("click", function () { map.scrollWheelZoom.enable(); });
    return map;
  };
  P.pin = function (cls, text) {
    return L.divIcon({ className: "", iconSize: [0, 0], html: '<span class="pin ' + cls + '">' + P.esc(text) + "</span>" });
  };

  window.PARKSG = P;
})();
