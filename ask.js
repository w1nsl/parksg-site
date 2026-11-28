// ParkSG website: Ask. Sends one question to the `ask-web` Edge Function and shows the answer, up to three
// carpark cards and a small map. If the function is not deployed (or can't be reached) the page says
// "Ask isn't switched on yet" instead of showing an error.
(function () {
  "use strict";
  var P = window.PARKSG, esc = P.esc;
  var $ = function (id) { return document.getElementById(id); };
  var url = P.askUrl, map = null, layer = null, busy = false, on = false;

  // For testing on your own machine only: ask.html?fn=http://localhost:8000 (ignored anywhere else).
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    var fn = new URLSearchParams(location.search).get("fn");
    if (fn && /^http:\/\/(localhost|127\.0\.0\.1):\d+(\/[\w\-/]*)?$/.test(fn)) url = fn;
  }

  function setOn(v) {
    on = v;
    $("off").hidden = v;
    $("ask").disabled = !v; $("ask-btn").disabled = !v;
    var chips = $("chips").querySelectorAll("button");
    for (var i = 0; i < chips.length; i++) chips[i].disabled = !v;
    $("chips").style.opacity = v ? "" : ".5";
  }

  function timed(ms) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var t = setTimeout(function () { if (ctrl) ctrl.abort(); }, ms);
    return { signal: ctrl ? ctrl.signal : undefined, done: function () { clearTimeout(t); } };
  }

  // Is the function there? A missing function answers 404 without CORS headers, which fetch reports as a failure.
  function probe() {
    var t = timed(8000);
    fetch(url, { method: "GET", cache: "no-store", signal: t.signal })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { setOn(!!(j && j.ok)); })
      .catch(function () { setOn(false); })
      .then(t.done);
  }

  function add(cls, html) {
    var d = document.createElement("div");
    d.className = cls; d.innerHTML = html;
    $("thread").appendChild(d);
    d.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return d;
  }

  function card(c, i) {
    var lines = [];
    lines.push("<div>about " + esc(c.walk_min) + " min walk · " + esc(c.est_cost_text || "rate not known") + "</div>");
    if (c.access === "public") lines.push('<div class="good">Open to public</div>');
    else lines.push('<div class="warn">Public access not confirmed</div>');
    if (typeof c.typical_free === "number") lines.push("<div" + (c.typical_free < 15 ? ' class="warn"' : "") + ">Usually about " + esc(c.typical_free) + " free at this hour</div>");
    var extra = [];
    if (c.sheltered === true) extra.push("Sheltered");
    if (c.ev_points > 0) extra.push(esc(c.ev_points) + " EV point" + (c.ev_points === 1 ? "" : "s"));
    if (c.rates_confirmed === false && c.est_cost != null) extra.push("rate not confirmed");
    if (extra.length) lines.push("<div>" + extra.join(" · ") + "</div>");
    var href = /^carpark\/[a-z0-9-]+\.html$/.test(c.page || "") ? c.page : "find.html";
    return '<a class="a-card' + (i === 0 ? " first" : "") + '" href="' + href + '"><b>' + (i + 1) + " · " + esc(c.name) + "</b>" + lines.join("") + "</a>";
  }

  function show(res) {
    var cps = Array.isArray(res.carparks) ? res.carparks.slice(0, 3) : [];
    var html = "<div>" + esc(res.answer || "") + "</div>";
    if (cps.length) html += '<div class="a-cards">' + cps.map(card).join("") + "</div>";
    var src = Array.isArray(res.sources) ? res.sources.slice(0, 6) : [];
    if (src.length) html += '<div class="muted small">' + src.map(esc).join(" · ") + (res.stub ? " · Test answer: written by a fixed pattern, not a language model." : "") + "</div>";
    else if (res.stub) html += '<div class="muted small">Test answer: written by a fixed pattern, not a language model.</div>';
    add("a", html);
    if (cps.length) draw(res, cps);      // an answer with no carparks leaves the last map in place
  }

  function draw(res, cps) {
    if (!window.L) return;
    if (!map) { map = P.makeMap($("map"), P.center[0], P.center[1], 12); layer = L.layerGroup().addTo(map); }
    layer.clearLayers();
    var pts = [];
    cps.forEach(function (c, i) {
      if (typeof c.lat !== "number" || typeof c.lon !== "number") return;
      L.marker([c.lat, c.lon], { icon: P.pin("num" + (i === 0 ? " first" : ""), String(i + 1)), title: c.name, zIndexOffset: 300 - i }).addTo(layer);
      pts.push([c.lat, c.lon]);
    });
    if (typeof res.place_lat === "number" && typeof res.place_lon === "number" && res.place) {
      L.marker([res.place_lat, res.place_lon], { icon: P.pin("place", res.place), interactive: false }).addTo(layer);
      pts.push([res.place_lat, res.place_lon]);
    }
    if (pts.length) map.fitBounds(pts, { padding: [50, 50], maxZoom: 17 });
  }

  function ask(q) {
    q = String(q || "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!q || busy || !on) return;
    busy = true; $("ask-btn").disabled = true;
    add("q", esc(q));
    var wait = add("a", '<span class="muted">Looking at the carparks…</span>');
    var t = timed(30000);
    fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }), cache: "no-store", signal: t.signal })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; });
      })
      .then(function (r) {
        wait.remove();
        if (r.status === 200 && typeof r.body.answer === "string") show(r.body);
        else if (r.status === 404) { setOn(false); add("a", '<span class="muted">Ask isn\'t switched on yet.</span>'); }
        else add("a", '<span class="muted">' + esc(typeof r.body.error === "string" ? r.body.error : "Ask isn't available right now. Please try again later.") + "</span>");
      })
      .catch(function () {
        wait.remove();
        add("a", '<span class="muted">Ask couldn\'t be reached. Please try again in a moment, or use Find parking.</span>');
      })
      .then(function () { t.done(); busy = false; $("ask-btn").disabled = !on; });
  }

  $("ask-form").addEventListener("submit", function (e) { e.preventDefault(); var v = $("ask").value; $("ask").value = ""; ask(v); });
  $("chips").addEventListener("click", function (e) { if (e.target && e.target.tagName === "BUTTON") ask(e.target.textContent); });
  setOn(false); $("off").hidden = true;      // quiet until we know
  try { if (window.L) { map = P.makeMap($("map"), P.center[0], P.center[1], 12); layer = L.layerGroup().addTo(map); } } catch (e) { /* page works without the map */ }
  probe();
})();
