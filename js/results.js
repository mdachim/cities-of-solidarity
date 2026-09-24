/* ==========================================================================
   results.js (v2) — loads data/results_showcase.csv and renders the Results
   Showcase in two modes:
     · OVERVIEW — Moldova map + filterable photo-led project tiles
     · PROJECT PAGE — one project at a time (#project=ID), photographs up
       front, a uniform field record, and the map docked in the sidebar.
   The single Leaflet map element is moved between the two layouts.
   Map tiles: free CARTO/OpenStreetMap — no API key required.
   Requires: data-loader.js, main.js, Leaflet. See SETUP_RESULTS_SHOWCASE.md.
   ========================================================================== */

(function () {
  "use strict";

  var statusEl = document.getElementById("data-status");
  var grid = document.getElementById("rs-grid");
  var countEl = document.getElementById("result-count");
  var mapEl = document.getElementById("rs-map");
  var overviewEl = document.getElementById("rs-overview");
  var detailEl = document.getElementById("rs-detail");
  var detailMain = document.getElementById("detail-main");
  var detailLoc = document.getElementById("detail-loc");
  if (!grid || !mapEl || !detailEl) return;

  /* Project-type accent colours: [bar/tint colour, AAA-contrast ink colour]
     Taken from the UNHCR Data Visualization Guidelines' 5-category palette
     (Blue / Yellow / Green / Cyan / Red) with the matching AAA text colours. */
  var TYPE_COLORS = {
    "PCP": ["var(--blue)",   "#05568B"],
    "CSI": ["var(--yellow)", "#684D0B"],
    "CSC": ["var(--green)",  "#1F5741"],
    "RAC": ["var(--cyan)",   "#0B5269"],
    "REF": ["var(--red)",    "#683229"]
  };
  var TYPE_FALLBACK = ["var(--grey)", "#4D4D4D"];
  function typeColor(t) { return TYPE_COLORS[t] || TYPE_FALLBACK; }

  function statusClass(st) {
    return "st-" + (st || "planned").toLowerCase().replace(/[^a-z]+/g, "-");
  }
  function money(v) {
    var n = parseFloat(v);
    if (isNaN(n) || n <= 0) return "";
    return "USD " + Math.round(n).toLocaleString("en-US");
  }
  function isImageLink(url) {
    if (!url) return false;
    if (/\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i.test(url)) return true;
    return url.indexOf("assets/") === 0; // repo-hosted photos
  }
  function orDash(v) { return v ? esc(v) : "—"; }

  /* ---------------- state ---------------- */
  var projects = [];
  var byId = {};
  var shownList = [];        // current filtered+sorted list (drives prev/next)
  var map, markerLayer;
  var markers = {};          // coordKey -> Leaflet marker
  var selectedKey = null;
  var openId = null;         // project currently open on its own page

  var controls = {
    q:        document.getElementById("f-search"),
    type:     document.getElementById("f-type"),
    district: document.getElementById("f-district"),
    muni:     document.getElementById("f-municipality"),
    facility: document.getElementById("f-facility"),
    status:   document.getElementById("f-status"),
    reset:    document.getElementById("f-reset")
  };

  function fillSelect(select, values, allLabel, keep) {
    if (!select) return;
    var current = keep ? select.value : "";
    select.innerHTML = '<option value="">' + allLabel + "</option>" +
      values.map(function (v) { return '<option value="' + esc(v) + '">' + esc(v) + "</option>"; }).join("");
    if (current && values.indexOf(current) !== -1) select.value = current;
  }

  function currentFilters() {
    return {
      q:        controls.q        ? controls.q.value.trim() : "",
      type:     controls.type     ? controls.type.value : "",
      district: controls.district ? controls.district.value : "",
      muni:     controls.muni     ? controls.muni.value : "",
      facility: controls.facility ? controls.facility.value : "",
      status:   controls.status   ? controls.status.value : ""
    };
  }

  function matches(p, f) {
    if (f.type && p.project_type !== f.type) return false;
    if (f.district && p.district !== f.district) return false;
    if (f.muni && p.municipality !== f.muni) return false;
    if (f.facility && p.facility_type !== f.facility) return false;
    if (f.status && p.status !== f.status) return false;
    if (f.q) {
      var hay = (p.project_name + " " + p.project_id + " " + p.project_type + " " + p.district + " " + p.municipality + " " +
                 p.address + " " + p.facility_type + " " + p.ownership + " " + p.scope_of_works + " " +
                 p.impact + " " + p.funding_source + " " + p.implementation_modality).toLowerCase();
      var terms = f.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < terms.length; i++) {
        if (hay.indexOf(terms[i]) === -1) return false;
      }
    }
    return true;
  }

  /* ---------------- photos ---------------- */
  /* Every project shows the same photo module: Before + After, each slot
     being an embedded image, a link-out tile, or a placeholder. When both
     sides are direct images, the module upgrades to a comparison slider.
     A project can have several before/after shots (before_photo/after_photo
     are "|"-joined lists) — photoState tracks which pair is on screen so
     the viewer can step through them without leaving the slider. */
  function photoList(field) { return field ? field.split("|").filter(Boolean) : []; }

  var photoState = { before: [], after: [], idx: 0 };

  function photoSlot(url, label, big) {
    if (isImageLink(url)) {
      return '<a class="ph-slot img" href="' + esc(url) + '" target="_blank" rel="noopener">' +
        '<img src="' + esc(url) + '" alt="' + esc(label) + ' photo" loading="lazy">' +
        '<span class="ph-cap">' + esc(label) + "</span></a>";
    }
    if (url) {
      return '<a class="ph-slot linkout" href="' + esc(url) + '" target="_blank" rel="noopener">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 15l-4.5-4.5L9 18"/></svg>' +
        '<span class="ph-cap">' + esc(label) + " photos ↗</span>" +
        (big ? '<span class="ph-note">Opens the photo folder (login may be required)</span>' : "") +
      "</a>";
    }
    return '<div class="ph-slot pending">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 15l-4.5-4.5L9 18"/></svg>' +
      '<span class="ph-cap">' + esc(label) + "</span>" +
      (big ? '<span class="ph-note">Photo pending</span>' : "") +
    "</div>";
  }

  function photoModule(p, big) {
    var b = p.before_photo, a = p.after_photo;
    if (isImageLink(b) && isImageLink(a)) {
      return '<div class="ba' + (big ? " big" : "") + '" data-ba>' +
        '<div class="ba-frame">' +
          '<img class="ba-after" src="' + esc(a) + '" alt="After works" loading="lazy">' +
          '<div class="ba-before-clip"><img class="ba-before" src="' + esc(b) + '" alt="Before works" loading="lazy"></div>' +
          '<div class="ba-handle" aria-hidden="true"></div>' +
          '<span class="ba-tag l">Before</span><span class="ba-tag r">After</span>' +
        "</div>" +
        '<input type="range" class="ba-range" min="0" max="100" value="50" aria-label="Compare before and after photos">' +
      "</div>";
    }
    return '<div class="ph-pair' + (big ? " big" : "") + '">' +
      photoSlot(b, "Before", big) + photoSlot(a, "After", big) + "</div>";
  }

  /* Plain documentation photos (an event, a finished site — no before/after
     comparison). Shown instead of the before/after module when a project
     has no before/after photos but does have a folder gallery. */
  function photoGallery(p) {
    var urls = p.photos ? p.photos.split("|").filter(Boolean) : [];
    if (!urls.length) return "";
    return '<div class="rs-gallery">' +
      urls.map(function (u) {
        return '<a class="rs-gallery-item" href="' + esc(u) + '" target="_blank" rel="noopener">' +
          '<img src="' + esc(u) + '" alt="Project photo" loading="lazy"></a>';
      }).join("") +
    "</div>";
  }

  var PH_PREV_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
  var PH_NEXT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

  /* Renders the before/after pair currently selected in photoState, plus
     prev/next controls when there's more than one pair to step through. */
  function renderPhotoPane() {
    var total = Math.max(photoState.before.length, photoState.after.length, 1);
    if (photoState.idx >= total) photoState.idx = 0;
    var pair = { before_photo: photoState.before[photoState.idx] || "",
                 after_photo: photoState.after[photoState.idx] || "" };
    var nav = total > 1 ?
      '<div class="ph-nav">' +
        '<button type="button" class="step-btn" id="ph-prev" aria-label="Previous photo pair">' + PH_PREV_ICON + "</button>" +
        '<span class="step-count">' + (photoState.idx + 1) + " / " + total + "</span>" +
        '<button type="button" class="step-btn" id="ph-next" aria-label="Next photo pair">' + PH_NEXT_ICON + "</button>" +
      "</div>" : "";
    return photoModule(pair, true) + nav;
  }

  function wirePhotoNav(container) {
    var total = Math.max(photoState.before.length, photoState.after.length, 1);
    if (total <= 1) return;
    var prev = container.querySelector("#ph-prev"), next = container.querySelector("#ph-next");
    if (prev) prev.addEventListener("click", function () {
      photoState.idx = (photoState.idx - 1 + total) % total;
      container.innerHTML = renderPhotoPane();
      wirePhotoNav(container);
    });
    if (next) next.addEventListener("click", function () {
      photoState.idx = (photoState.idx + 1) % total;
      container.innerHTML = renderPhotoPane();
      wirePhotoNav(container);
    });
  }

  /* Returns the markup to embed in detailMain.innerHTML. When there's a
     before/after pair, it's just an empty slot — renderDetail fills it via
     renderPhotoPane() once the element actually exists in the DOM (needed
     for the prev/next pair buttons to attach their click handlers). */
  function photoSection(p) {
    photoState = { before: photoList(p.before_photo), after: photoList(p.after_photo), idx: 0 };
    if (photoState.before.length || photoState.after.length) return '<div id="detail-photo"></div>';
    if (p.photos) return photoGallery(p);
    return photoModule(p, true); // neither — shows the familiar "pending" placeholders
  }

  /* ---------------- overview table, grouped by district ---------------- */
  var CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>';

  function renderRow(p) {
    var col = typeColor(p.project_type);
    return "<tr>" +
      '<td class="rc-type">' +
        (p.project_type ? '<span class="type-chip" style="background:' + col[0] + '">' + esc(p.project_type) + "</span>" : "") +
      "</td>" +
      '<td class="rc-name"><a href="#project=' + encodeURIComponent(p.project_id) + '">' + esc(p.project_name) + "</a></td>" +
      "<td>" + orDash(p.facility_type) + "</td>" +
      "<td>" + orDash(p.municipality) + "</td>" +
      '<td><span class="mchip status ' + statusClass(p.status) + '">' + orDash(p.status) + "</span></td>" +
      '<td class="rc-inv">' + (money(p.total_investment_usd) || "—") + "</td>" +
    "</tr>";
  }

  function renderGroup(district, list) {
    var total = list.reduce(function (s, p) { return s + p._inv; }, 0);
    return '<details class="rs-dgroup" open>' +
      "<summary>" + CHEV +
        '<span class="dg-name">' + esc(district || "District not recorded") + "</span>" +
        '<span class="dg-meta">' + list.length + (list.length === 1 ? " project" : " projects") +
          (total ? " · " + money(total) : "") + "</span>" +
      "</summary>" +
      '<div class="rs-table-scroll"><table class="rs-table">' +
        "<thead><tr><th></th><th>Project</th><th>Facility type</th><th>Municipality</th><th>Status</th><th>Investment</th></tr></thead>" +
        "<tbody>" + list.map(renderRow).join("") + "</tbody>" +
      "</table></div>" +
    "</details>";
  }

  function renderTable(list) {
    var groups = {};
    list.forEach(function (p) {
      var d = p.district || "";
      (groups[d] = groups[d] || []).push(p);
    });
    var names = Object.keys(groups).sort(function (a, b) {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b);
    });
    return names.map(function (d) { return renderGroup(d, groups[d]); }).join("");
  }

  /* ---------------- project page ---------------- */
  /* Every project renders the exact same record, in the same order —
     empty values show as an em-dash so the structure never changes. */
  function renderDetail(p) {
    var col = typeColor(p.project_type);
    var facts = [
      ["Project ID", p.project_id],
      ["Type of project", p.project_type],
      ["Facility type", p.facility_type],
      ["Status", p.status],
      ["Ownership", p.ownership],
      ["Implementation modality", p.implementation_modality],
      ["Total investment", money(p.total_investment_usd)],
      ["Funding source", p.funding_source],
      ["Project start", p.start_date],
      ["Project completion", p.completion_date]
    ];
    detailMain.innerHTML =
      '<div class="detail-head" style="--sc:' + col[0] + ";--sci:" + col[1] + '">' +
        '<div class="meta-chips">' +
          (p.project_type ? '<span class="mchip type">' + esc(p.project_type) + "</span>" : "") +
          '<span class="mchip sector">' + esc(p.facility_type) + "</span>" +
          '<span class="mchip status ' + statusClass(p.status) + '">' + esc(p.status) + "</span>" +
        "</div>" +
        "<h1>" + esc(p.project_name) + "</h1>" +
        '<p class="detail-sub">' + esc(p.municipality || p.district) + " · " + esc(p.district) +
          (p.address ? " · " + esc(p.address) : "") + "</p>" +
      "</div>" +
      photoSection(p) +
      '<div class="detail-facts">' +
        facts.map(function (f) {
          return '<div class="dfact"><span class="k">' + esc(f[0]) + '</span><span class="v">' + orDash(f[1]) + "</span></div>";
        }).join("") +
      "</div>" +
      '<div class="detail-prose">' +
        "<h2>Scope of works</h2>" +
        "<p>" + (p.scope_of_works ? esc(p.scope_of_works) : "Not yet documented — add it in the master Excel file.") + "</p>" +
        "<h2>Impact</h2>" +
        "<p>" + (p.impact ? esc(p.impact) : "Not yet documented — add it in the master Excel file.") + "</p>" +
        (p.remarks ? "<h2>Remarks</h2><p>" + esc(p.remarks) + "</p>" : "") +
      "</div>";

    var photoEl = document.getElementById("detail-photo");
    if (photoEl) {
      photoEl.innerHTML = renderPhotoPane();
      wirePhotoNav(photoEl);
    }

    detailLoc.innerHTML =
      '<span class="k">Location</span>' +
      '<b>' + esc(p.municipality || p.district) + "</b>" +
      '<span class="v">' + orDash(p.address) + "</span>" +
      (p._lat != null ?
        '<a class="gmaps" href="https://www.openstreetmap.org/?mlat=' + p._lat + "&mlon=" + p._lon + "#map=16/" + p._lat + "/" + p._lon + '" target="_blank" rel="noopener">Open in OpenStreetMap ↗</a>' :
        '<span class="v">Coordinates not yet recorded</span>');
  }

  /* ---------------- map ---------------- */
  function coordKey(p) { return p._lat.toFixed(5) + "," + p._lon.toFixed(5); }

  function markerHtml(group, selected) {
    var col = typeColor(group[0].project_type)[0];
    var badge = group.length > 1 ? '<span class="n">' + group.length + "</span>" : "";
    return '<div class="rs-pin' + (selected ? " sel" : "") + '" style="--pin-c:' + col + '">' + badge + "</div>";
  }

  function popupHtml(group) {
    return '<div class="rs-pop">' + group.map(function (p) {
      return '<div class="pp">' +
        "<b>" + esc(p.project_name) + "</b>" +
        '<span class="pm">' + esc(p.project_type) + " · " + esc(p.facility_type) + " · " + esc(p.status) +
          (money(p.total_investment_usd) ? " · " + money(p.total_investment_usd) : "") + "</span>" +
        '<a href="#project=' + encodeURIComponent(p.project_id) + '" class="pl">Open project →</a>' +
      "</div>";
    }).join("") + "</div>";
  }

  function drawMarkers(list) {
    markerLayer.clearLayers();
    markers = {};
    var groups = {};
    list.forEach(function (p) {
      if (p._lat == null) return;
      var k = coordKey(p);
      (groups[k] = groups[k] || []).push(p);
    });
    var bounds = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      var icon = L.divIcon({ className: "rs-di", html: markerHtml(g, k === selectedKey),
                             iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -12] });
      var m = L.marker([g[0]._lat, g[0]._lon], { icon: icon, title: g[0].project_name });
      m.on("click", function () {
        if (g.length === 1) { location.hash = "project=" + encodeURIComponent(g[0].project_id); }
        else { m.bindPopup(popupHtml(g), { maxWidth: 300 }).openPopup(); }
      });
      m.addTo(markerLayer);
      markers[k] = m;
      bounds.push([g[0]._lat, g[0]._lon]);
    });
    return bounds;
  }

  function setSelectedPin(k) {
    if (selectedKey && markers[selectedKey]) {
      var prev = markers[selectedKey].getElement();
      if (prev) { var d = prev.querySelector(".rs-pin"); if (d) d.classList.remove("sel"); }
    }
    selectedKey = k;
    if (k && markers[k]) {
      var el = markers[k].getElement();
      if (el) { var pin = el.querySelector(".rs-pin"); if (pin) pin.classList.add("sel"); }
    }
  }

  function dockMap(slotId, height) {
    var slot = document.getElementById(slotId);
    if (slot && mapEl.parentElement !== slot) slot.appendChild(mapEl);
    mapEl.style.height = height + "px";
    if (map) map.invalidateSize();
  }

  /* ---------------- overview render ---------------- */
  function render() {
    var f = currentFilters();
    shownList = projects.filter(function (p) { return matches(p, f); });

    if (countEl) countEl.textContent = shownList.length + " of " + projects.length + " projects shown";
    grid.innerHTML = shownList.length ? renderTable(shownList) :
      '<div class="empty-state"><b>No projects match the current filters.</b><br>Try clearing a filter or using a broader search term.</div>';

    var bounds = drawMarkers(shownList);
    if (!openId && bounds.length) {
      map.fitBounds(bounds, { padding: [34, 34], maxZoom: bounds.length === 1 ? 13 : 9 });
    }

    // municipality options follow the selected district
    var pool = f.district ? projects.filter(function (p) { return p.district === f.district; }) : projects;
    var munis = {};
    pool.forEach(function (p) { if (p.municipality) munis[p.municipality] = true; });
    fillSelect(controls.muni, Object.keys(munis).sort(), "All municipalities", true);
  }

  /* ---------------- routing (overview <-> project page) ---------------- */
  function idFromHash() {
    var m = location.hash.match(/^#project=(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function openProject(id) {
    var p = byId[id];
    if (!p) { closeProject(); return; }
    openId = id;
    overviewEl.hidden = true;
    detailEl.hidden = false;
    renderDetail(p);

    // prev/next within the current filtered list (fall back to all projects)
    var list = shownList.length ? shownList : projects;
    var idx = -1;
    for (var i = 0; i < list.length; i++) if (list[i].project_id === id) { idx = i; break; }
    var countLbl = document.getElementById("detail-count");
    if (countLbl) countLbl.textContent = idx >= 0 ? (idx + 1) + " / " + list.length : "";
    detailEl.dataset.prev = idx > 0 ? list[idx - 1].project_id : "";
    detailEl.dataset.next = (idx >= 0 && idx < list.length - 1) ? list[idx + 1].project_id : "";
    var pb = document.getElementById("detail-prev"), nb = document.getElementById("detail-next");
    if (pb) pb.disabled = !detailEl.dataset.prev;
    if (nb) nb.disabled = !detailEl.dataset.next;

    dockMap("map-slot-detail", 340);
    if (p._lat != null) {
      if (!markers[p._key]) drawMarkers(shownList.length ? shownList : projects);
      setSelectedPin(p._key);
      map.setView([p._lat, p._lon], 13, { animate: !window.CoS.reducedMotion });
    }
    window.scrollTo({ top: 0, behavior: "auto" });
    if (window.CoS && window.CoS.refreshMotion) window.CoS.refreshMotion();
  }

  function closeProject() {
    if (location.hash) {
      // keep the URL clean without re-triggering hashchange loops
      history.replaceState(null, "", location.pathname + location.search);
    }
    openId = null;
    detailEl.hidden = true;
    overviewEl.hidden = false;
    setSelectedPin(null);
    dockMap("map-slot-overview", 520);
    render();
  }

  function route() {
    var id = idFromHash();
    if (id) openProject(id);
    else if (openId) closeProject();
  }

  window.addEventListener("hashchange", route);
  document.getElementById("detail-back").addEventListener("click", function () { closeProject(); });
  document.getElementById("detail-prev").addEventListener("click", function () {
    if (detailEl.dataset.prev) location.hash = "project=" + encodeURIComponent(detailEl.dataset.prev);
  });
  document.getElementById("detail-next").addEventListener("click", function () {
    if (detailEl.dataset.next) location.hash = "project=" + encodeURIComponent(detailEl.dataset.next);
  });
  document.addEventListener("keydown", function (e) {
    if (detailEl.hidden) return;
    if (e.key === "Escape") closeProject();
    if (e.key === "ArrowLeft" && detailEl.dataset.prev) location.hash = "project=" + encodeURIComponent(detailEl.dataset.prev);
    if (e.key === "ArrowRight" && detailEl.dataset.next) location.hash = "project=" + encodeURIComponent(detailEl.dataset.next);
  });

  /* before/after slider (works in both layouts) */
  document.addEventListener("input", function (e) {
    var range = e.target.closest ? e.target.closest(".ba-range") : null;
    if (!range) return;
    var frame = range.closest(".ba").querySelector(".ba-frame");
    frame.style.setProperty("--ba", range.value + "%");
  });

  /* ---------------- boot ---------------- */
  loadCSV("data/results_showcase.csv").then(function (rows) {
    projects = rows.filter(function (r) { return r.project_name; });
    projects.forEach(function (p) {
      var la = parseFloat(p.latitude), lo = parseFloat(p.longitude);
      var ok = !isNaN(la) && !isNaN(lo) && la > 44 && la < 50 && lo > 26 && lo < 31;
      p._lat = ok ? la : null;
      p._lon = ok ? lo : null;
      p._key = ok ? coordKey(p) : "";
      p._inv = parseFloat(p.total_investment_usd) || 0;
      byId[p.project_id] = p;
    });
    projects.sort(function (a, b) { return b._inv - a._inv || a.project_name.localeCompare(b.project_name); });

    /* headline stats */
    var stats = document.getElementById("rs-stats");
    if (stats) {
      var districts = {};
      var inv = 0, done = 0;
      projects.forEach(function (p) {
        if (p.district) districts[p.district] = true;
        inv += p._inv;
        if (p.status === "Completed") done++;
      });
      document.getElementById("st-projects").setAttribute("data-target", projects.length);
      document.getElementById("st-districts").setAttribute("data-target", Object.keys(districts).length);
      document.getElementById("st-investment").setAttribute("data-target", Math.round(inv));
      document.getElementById("st-completed").setAttribute("data-target", done);
      stats.hidden = false;
    }

    /* map */
    map = L.map(mapEl, { scrollWheelZoom: false, center: [47.1, 28.6], zoom: 7 });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: "abcd", maxZoom: 18
    }).addTo(map);
    markerLayer = L.layerGroup().addTo(map);

    /* filters */
    function uniq(key) {
      var set = {};
      projects.forEach(function (p) { if (p[key]) set[p[key]] = true; });
      return Object.keys(set).sort();
    }
    var types = uniq("project_type");
    fillSelect(controls.type, types, "All types");
    fillSelect(controls.district, uniq("district"), "All districts");
    fillSelect(controls.muni, uniq("municipality"), "All municipalities");
    fillSelect(controls.facility, uniq("facility_type"), "All facility types");
    fillSelect(controls.status, uniq("status"), "All statuses");
    if (controls.type && types.indexOf("PCP") !== -1) controls.type.value = "PCP";

    /* map/tile pins and accents are coloured by project type — one dot per
       type actually present in the data, plus the multi-project pin hint */
    var typeLegend = document.getElementById("rs-type-legend");
    if (typeLegend) {
      typeLegend.innerHTML = types.map(function (t) {
        return '<span><i class="dot" style="background:' + typeColor(t)[0] + '"></i>' + esc(t) + "</span>";
      }).join("") +
      '<span class="hint">Pins with a number group several projects at one site — click a pin to open a project</span>';
    }

    ["type", "district", "muni", "facility", "status"].forEach(function (k) {
      if (controls[k]) controls[k].addEventListener("change", function () {
        if (k === "district" && controls.muni) controls.muni.value = "";
        render();
      });
    });
    if (controls.q) controls.q.addEventListener("input", render);
    if (controls.reset) controls.reset.addEventListener("click", function () {
      if (controls.q) controls.q.value = "";
      ["type", "district", "muni", "facility", "status"].forEach(function (k) { if (controls[k]) controls[k].value = ""; });
      render();
    });

    if (statusEl) statusEl.hidden = true;
    render();
    route(); // honour a #project=… link on first load
    if (window.CoS && window.CoS.refreshMotion) window.CoS.refreshMotion();
  }).catch(function (err) {
    showDataError(statusEl, err);
  });
})();
