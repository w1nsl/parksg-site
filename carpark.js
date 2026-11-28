// ParkSG website: live parts of a carpark page (free lots, typical lots chart, small map, report form).
(function () {
  "use strict";
  var P = window.PARKSG, cp;
  try { cp = JSON.parse(document.getElementById("cp").textContent); } catch (e) { return; }
  var $ = function (id) { return document.getElementById(id); };

  // --- Free lots now -------------------------------------------------------------------------------------
  var pins = {};
  function showLots(data) {
    var box = $("live-box"), src = $("live-src");
    if (!data) {
      box.innerHTML = '<span class="muted">Live lots can\'t be loaded right now.</span>';
      src.textContent = "";
    } else {
      var lot = data.lots[cp.id];
      if (lot && typeof lot.available === "number") {
        box.innerHTML = '<span class="num">' + lot.available + "</span><span>" +
          (lot.total ? "of " + lot.total + " car lots free" : "car lots free") + "</span>";
        src.textContent = "Source: " + P.lotSource(lot.source) + " · checked " + P.clock(data.updated_at) + " today";
      } else {
        box.innerHTML = '<span class="muted">Not known. This carpark does not report live lots.</span>';
        src.textContent = "";
      }
    }
    var spots = document.querySelectorAll("[data-lots]");
    for (var i = 0; i < spots.length; i++) {
      var l = data && data.lots[spots[i].getAttribute("data-lots")];
      if (l && typeof l.available === "number") { spots[i].textContent = l.available + " free"; spots[i].className = "lots has"; }
      else { spots[i].textContent = data ? "No live lots" : ""; spots[i].className = "lots"; }
    }
    if (data && window.L) {
      cp.near.forEach(function (n) {
        var l = data.lots[n.id];
        if (pins[n.id] && l && typeof l.available === "number") pins[n.id].setIcon(P.pin("ok", String(l.available)));
      });
      var own = data.lots[cp.id];
      if (pins[cp.id] && cp.access === "public" && own && typeof own.available === "number") pins[cp.id].setIcon(P.pin("ok sel", String(own.available)));
    }
  }
  function refresh() { P.fetchLots([cp.id].concat(cp.near.map(function (n) { return n.id; }))).then(showLots); }

  // --- Typical lots by hour ------------------------------------------------------------------------------
  function typical() {
    var t = cp.typical, card = $("typical");
    if (!t || !t.days || !card) return;
    var any = t.days.some(function (d) { return d.some(function (v) { return v != null; }); });
    if (!any) return;
    card.hidden = false;
    var names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], now = P.sgNow(), day = now.dow;
    var tabs = $("daytabs"), chart = $("chart"), note = $("chart-note");
    var axis = document.createElement("div");
    axis.className = "chart-axis"; axis.setAttribute("aria-hidden", "true");
    for (var h = 0; h < 24; h++) { var s = document.createElement("span"); s.textContent = h % 6 === 0 ? P.hourLabel(h) : ""; axis.appendChild(s); }
    chart.parentNode.insertBefore(axis, note);
    function draw() {
      var vals = t.days[day], max = 1;
      t.days.forEach(function (d) { d.forEach(function (v) { if (v != null && v > max) max = v; }); });
      chart.innerHTML = "";
      for (var h = 0; h < 24; h++) {
        var b = document.createElement("div"), v = vals[h];
        b.className = "bar" + (v == null ? " none" : "") + (day === now.dow && h === now.hour ? " now" : "");
        if (v != null) { b.style.height = Math.max(2, Math.round(v / max * 100)) + "%"; b.title = P.hourLabel(h) + ": about " + v + " free on average"; }
        else b.title = P.hourLabel(h) + ": no reading yet";
        chart.appendChild(b);
      }
      var known = vals.filter(function (v) { return v != null; }).length;
      if (day === now.dow && vals[now.hour] != null) note.textContent = "About " + vals[now.hour] + " free on average at " + P.hourLabel(now.hour) + " on a " + names[day] + ".";
      else if (!known) note.textContent = "No readings for " + names[day] + " yet.";
      else note.textContent = known + " of 24 hours have a reading for " + names[day] + ". Hover or tap a bar for the figure.";
      if (known && (t.samples || 0) < 300) note.textContent += " Early figures: we have only just started recording this carpark.";
      var btns = tabs.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) btns[i].setAttribute("aria-pressed", String(i === day));
    }
    names.forEach(function (n, i) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = n + (i === now.dow ? " (today)" : "");
      b.addEventListener("click", function () { day = i; draw(); });
      tabs.appendChild(b);
    });
    draw();
  }

  // --- Small map -----------------------------------------------------------------------------------------
  function map() {
    if (!window.L) return;
    var m = P.makeMap($("map"), cp.lat, cp.lon, 17);
    var cls = cp.access === "public" ? "ok" : cp.access === "season_only" ? "no" : "unk";
    var text = cp.access === "public" ? "P" : cp.access === "season_only" ? "Season only" : "?";
    pins[cp.id] = L.marker([cp.lat, cp.lon], { icon: P.pin(cls + " sel", text), title: cp.name, zIndexOffset: 500 }).addTo(m);
    var pts = [[cp.lat, cp.lon]];
    cp.near.forEach(function (n) {
      pins[n.id] = L.marker([n.lat, n.lon], { icon: P.pin("ok", "P"), title: n.name }).addTo(m)
        .on("click", function () { location.href = n.slug + ".html"; });
      pts.push([n.lat, n.lon]);
    });
    if (pts.length > 1) m.fitBounds(pts, { padding: [36, 36], maxZoom: 17 });
  }

  // --- Report a problem ----------------------------------------------------------------------------------
  // Same row the iPhone app files (CorrectionsAPI.submit in SupabaseService.swift): insert-only, pending,
  // reviewed by the owner before anything changes.
  function report() {
    var form = $("report-form"), msg = $("report-msg");
    if (!form) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var rate = form.rate.value.trim().slice(0, 500), note = form.note.value.trim().slice(0, 500);
      msg.className = "form-msg";
      if (!rate && !note) { msg.textContent = "Please tell us what is wrong first."; msg.className = "form-msg bad"; return; }
      var btn = form.querySelector("button");
      btn.disabled = true; msg.textContent = "Sending…";
      fetch(P.supabaseUrl + "/rest/v1/rate_corrections", {
        method: "POST",
        headers: {
          apikey: P.publishableKey, Authorization: "Bearer " + P.publishableKey,
          "Content-Type": "application/json", Prefer: "return=minimal"
        },
        body: JSON.stringify({
          carpark_id: cp.id,
          submitted_by_device: "web",
          payload: { rules: [], reported_rate_text: rate, note: note, app_version: "web" }
        })
      }).then(function (res) {
        if (!res.ok) throw new Error("status " + res.status);
        form.reset(); msg.textContent = "Thank you. We'll check it against the official source."; msg.className = "form-msg good";
      }).catch(function () {
        msg.textContent = "Couldn't send right now. Please try again later."; msg.className = "form-msg bad";
      }).then(function () { btn.disabled = false; });
    });
  }

  typical(); report();
  try { map(); } catch (e) { /* the page still works without the map */ }
  refresh();
  setInterval(function () { if (!document.hidden) refresh(); }, 60000);
})();
