// ParkSG website: Find parking. Searches our own carpark names and addresses (data/carparks.json, built by
// tools/site/build.py), shows the nearest carparks as a list and on the map, and adds live free lots.
(function () {
  "use strict";
  var P = window.PARKSG, esc = P.esc;
  var $ = function (id) { return document.getElementById(id); };
  var LIST_MAX = 30;
  var idx = null, all = [], map = null, dots = null, pinLayer = null, pins = {}, lots = {}, lotsOk = null, canvas = null;
  var state = { q: "", center: null, label: "", matched: {}, pub: false, free: false, ev: false, vehicle: "car", list: [] };

  // --- Rates right now -----------------------------------------------------------------------------------
  function dayIndex(now) {
    if (now.dow === 0 || (idx.holidays || []).indexOf(now.date) >= 0) return 2;
    return now.dow === 6 ? 1 : 0;
  }
  function rateNow(c) {
    var s = idx.schedules[state.vehicle === "car" ? c.car : c.moto];
    if (!s) return null;
    var now = P.sgNow(), d = dayIndex(now);
    for (var i = 0; i < s.length; i++) if (s[i][0] === d && now.minute >= s[i][1] && now.minute < s[i][2]) return { text: s[i][3], free: !!s[i][4], verified: !!s[i][5] };
    return null;
  }

  // --- Search over our own names and addresses -----------------------------------------------------------
  var ALIAS = { st: "street", ave: "avenue", rd: "road", dr: "drive", block: "blk", blk: "blk", jln: "jalan", lor: "lorong", ctrl: "central", cres: "crescent", pl: "place" };
  function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(); }
  function tokens(q) { return norm(q).split(" ").filter(Boolean).map(function (t) { return ALIAS[t] || t; }); }
  function search(q) {
    var ts = tokens(q), hits = [];
    if (!ts.length) return hits;
    for (var i = 0; i < all.length; i++) {
      var hay = all[i].hay, ok = true, score = 0;
      for (var j = 0; j < ts.length; j++) {
        var at = hay.indexOf(" " + ts[j]);
        if (at < 0) { ok = false; break; }
        if (hay.charAt(at + 1 + ts[j].length) === " ") score += 2;      // whole word
      }
      if (ok) { if (hay.indexOf(" " + ts.join(" ")) >= 0) score += 3; hits.push({ c: all[i], score: score }); }
    }
    hits.sort(function (a, b) { return b.score - a.score; });
    return hits;
  }
  function median(v) { v = v.slice().sort(function (a, b) { return a - b; }); return v[Math.floor(v.length / 2)]; }

  // --- Filters and list ----------------------------------------------------------------------------------
  function passes(c) {
    if (state.pub && c.access !== 1) return false;
    if (state.ev && !(c.ev > 0)) return false;
    if (state.free) { var r = rateNow(c); if (!r || !r.free) return false; }
    return true;
  }
  function compute() {
    if (!state.center) { state.list = []; return; }
    var lat = state.center[0], lon = state.center[1], rank = { 1: 0, 0: 1, 2: 2 }, near = [];
    for (var i = 0; i < all.length; i++) {
      var c = all[i];
      if (Math.abs(c.lat - lat) > 0.03 || Math.abs(c.lon - lon) > 0.03) continue;
      if (!passes(c)) continue;
      c.dist = P.metres(lat, lon, c.lat, c.lon);
      if (c.dist <= 1500 || state.matched[c.id]) near.push(c);
    }
    near.sort(function (a, b) {
      var ma = state.matched[a.id] ? 0 : 1, mb = state.matched[b.id] ? 0 : 1;
      // Matches first, then the carparks you can use, then the nearest.
      return (ma - mb) || (rank[a.access] - rank[b.access]) || (a.dist - b.dist);
    });
    state.list = near.slice(0, LIST_MAX);
  }

  function accessTag(c) {
    if (c.access === 1) return '<span class="tag ok">Open to public</span><span>' + (c.checked ? "Checked " + esc(c.checked) : "Check date not known") + (c.source ? " · " + esc(c.source) : "") + "</span>";
    if (c.access === 2) return '<span class="tag no">Season parking only</span><span>Visitors can\'t park here</span>';
    return '<span class="tag unk">Not confirmed</span><span>Not confirmed whether visitors can park here</span>';
  }
  function lotsBadge(c) {
    var l = lots[c.id];
    if (l && typeof l.available === "number") return '<span class="lots has">' + l.available + " free</span>";
    return '<span class="lots">' + (lotsOk === false ? "Live lots unavailable" : lotsOk === null ? "" : "No live lots") + "</span>";
  }
  function render() {
    var box = $("results");
    if (!idx) return;
    if (!state.center) {
      box.innerHTML = '<div class="empty">' + (state.q ? "No carpark name or address matches <b>" + esc(state.q) + "</b>. Try a street name, a block number or a building name, or move the map and choose “Show carparks in this area”."
        : "Search for a street, block or building, or choose “Near me”. You can also zoom into the map.") + "</div>";
      drawPins(); return;
    }
    var html = '<div class="count">' + state.list.length + (state.list.length === LIST_MAX ? "+" : "") + " carpark" + (state.list.length === 1 ? "" : "s") +
      " near " + esc(state.label) + " · best first</div>";
    if (!state.list.length) {
      html += '<div class="empty">No carparks within 1.5 km match these filters.' +
        (state.pub ? " Turn off “Open to public” to also see carparks we have not confirmed." : "") +
        (state.ev && !idx.ev_known ? " EV charging data is not loaded yet." : "") + "</div>";
    }
    state.list.forEach(function (c) {
      var r = rateNow(c), bits = [esc(c.kind)];
      bits.push(c.dist < 60 ? "at your destination" : "about " + P.walkMinutes(c.dist) + " min walk");
      bits.push(r ? esc(r.text) + (r.free ? " now" : "") + (r.verified ? "" : " (rate not confirmed)")
        : state.vehicle === "moto" ? "Motorcycle rate not known" : "Rate not known");
      if (c.ev > 0) bits.push(c.ev + " EV point" + (c.ev === 1 ? "" : "s"));
      html += '<a class="result" id="r-' + P.slugFor(c.id) + '" href="carpark/' + P.slugFor(c.id) + '.html"><div class="top"><b>' + esc(c.name) + "</b>" + lotsBadge(c) +
        '</div><div class="line">' + bits.join(" · ") + '</div><div class="tags">' + accessTag(c) + "</div></a>";
    });
    box.innerHTML = html;
    drawPins();
  }

  // --- Map -----------------------------------------------------------------------------------------------
  function pinFor(c) {
    if (c.access === 2) return P.pin("no", "Season only");
    if (c.access !== 1) return P.pin("unk", "?");
    var l = lots[c.id];
    return P.pin("ok", l && typeof l.available === "number" ? String(l.available) : "P");
  }
  function popup(c) {
    return "<b>" + esc(c.name) + "</b><br>" + esc(c.kind) + "<br>" +
      (c.access === 1 ? "Open to public" : c.access === 2 ? "Season parking only" : "Not confirmed") +
      '<br><a href="carpark/' + P.slugFor(c.id) + '.html">Rates and details</a>';
  }
  function drawDots() {
    if (!map) return;
    dots.clearLayers();
    var colour = { 1: "#0B6B45", 2: "#A32222", 0: "#B26A00" };
    all.forEach(function (c) {
      if (!passes(c)) return;
      L.circleMarker([c.lat, c.lon], { renderer: canvas, radius: 4, weight: 1, color: "#fff", fillColor: colour[c.access], fillOpacity: 0.9 })
        .bindPopup(function () { return popup(c); }).addTo(dots);
    });
  }
  function drawPins() {
    if (!map) return;
    pinLayer.clearLayers(); pins = {};
    state.list.forEach(function (c) {
      pins[c.id] = L.marker([c.lat, c.lon], { icon: pinFor(c), title: c.name, zIndexOffset: c.access === 1 ? 300 : 100 })
        .bindPopup(function () { return popup(c); })
        .on("click", function () {
          var card = $("r-" + P.slugFor(c.id)), old = document.querySelector(".result.sel");
          if (old) old.classList.remove("sel");
          if (card) { card.classList.add("sel"); if (window.innerWidth > 860) card.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
        }).addTo(pinLayer);
    });
  }
  function frame() {
    if (!map || !state.center) return;
    var pts = state.list.slice(0, 12).map(function (c) { return [c.lat, c.lon]; });
    pts.push(state.center);
    moving = Date.now();
    map.fitBounds(pts, { padding: [40, 40], maxZoom: 17 });
  }
  var moving = 0;      // time of our own last map move, so it isn't mistaken for the visitor's

  // --- Live lots -----------------------------------------------------------------------------------------
  function loadLots() {
    var ids = state.list.map(function (c) { return c.id; });
    if (!ids.length) return;
    P.fetchLots(ids).then(function (data) {
      lotsOk = !!data;
      if (data) for (var k in data.lots) lots[k] = data.lots[k];
      render();
    });
  }

  function update(reframe) { compute(); render(); if (reframe) frame(); loadLots(); }

  function doSearch(q) {
    state.q = q.trim(); state.matched = {};
    try { history.replaceState(null, "", state.q ? "?q=" + encodeURIComponent(state.q) : location.pathname); } catch (e) { /* file:// */ }
    if (!state.q) { state.center = null; render(); return; }
    var hits = search(state.q);
    if (!hits.length) { state.center = null; state.list = []; render(); return; }
    var top = hits.filter(function (h) { return h.score === hits[0].score; }).slice(0, 40);
    state.center = [median(top.map(function (h) { return h.c.lat; })), median(top.map(function (h) { return h.c.lon; }))];
    // Only matches close to that middle point are pinned to the top of the list.
    top.forEach(function (h) { if (P.metres(state.center[0], state.center[1], h.c.lat, h.c.lon) < 1500) state.matched[h.c.id] = true; });
    state.label = state.q;
    update(true);
  }

  function toggle(id, key) {
    $(id).addEventListener("click", function () {
      state[key] = !state[key]; this.setAttribute("aria-pressed", String(state[key]));
      drawDots(); update(false);
    });
  }

  function start(data) {
    idx = data;
    all = data.carparks.map(function (r) {
      return { id: r[0], name: r[1], address: r[2], lat: r[3], lon: r[4], kind: r[5], access: r[6], checked: r[7], source: r[8], car: r[9], moto: r[10], ev: r[11],
        hay: " " + norm(r[1] + " " + r[2] + " " + r[0].split(":")[1]).split(" ").map(function (t) { return ALIAS[t] || t; }).join(" ") + " " };
    });
    state.pub = !!data.access_known;
    $("f-public").setAttribute("aria-pressed", String(state.pub));
    if (!data.ev_known) { $("f-ev").disabled = true; $("f-ev").title = "EV charging data is not loaded yet"; $("f-ev").style.opacity = ".5"; }

    if (window.L) {
      map = P.makeMap($("map"), P.center[0], P.center[1], 12);
      dots = L.layerGroup().addTo(map); pinLayer = L.layerGroup().addTo(map);
      canvas = L.canvas({ padding: 0.3 });
      drawDots();
      map.on("moveend", function () {
        if (Date.now() - moving < 1200) { $("area").hidden = true; return; }
        $("area").hidden = map.getZoom() < 14;
      });
      $("area").addEventListener("click", function () {
        var c = map.getCenter();
        state.center = [c.lat, c.lng]; state.label = "the middle of the map"; state.matched = {};
        this.hidden = true; update(false);
      });
    }
    toggle("f-public", "pub"); toggle("f-free", "free"); toggle("f-ev", "ev");
    $("f-vehicle").addEventListener("change", function () { state.vehicle = this.value; update(false); });
    $("search").addEventListener("submit", function (e) { e.preventDefault(); doSearch($("q").value); });
    $("near-me").addEventListener("click", function () {
      if (!navigator.geolocation) { $("results").innerHTML = '<div class="empty">This browser can\'t share a location.</div>'; return; }
      navigator.geolocation.getCurrentPosition(function (pos) {
        state.center = [pos.coords.latitude, pos.coords.longitude]; state.label = "you"; state.matched = {}; state.q = "";
        update(true);
      }, function () { $("results").innerHTML = '<div class="empty">Couldn\'t get your location. Search for a street or building instead.</div>'; },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
    });
    var q = new URLSearchParams(location.search).get("q");
    if (q) { $("q").value = q.slice(0, 80); doSearch(q.slice(0, 80)); } else render();
    setInterval(function () { if (!document.hidden) loadLots(); }, 60000);
  }

  fetch("data/carparks.json").then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(start)
    .catch(function () { $("results").innerHTML = '<div class="empty">The carpark list couldn\'t be loaded. Please try again in a moment.</div>'; });
})();
