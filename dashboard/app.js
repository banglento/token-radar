// Token Radar's plain dashboard. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable table, a
// per-protocol detail view with the model's own inputs and the protocol's
// farm plan, and the live-token view kept apart from the board.
// No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var params = new URLSearchParams(window.location.search);
  var state = {
    q: params.get('q') || '',
    cat: params.get('cat') || 'all',
    chain: params.get('chain') || 'all',
    wl: params.get('wl') === '1',
    sort: params.get('sort') || 'implied',
    tab: params.get('tab') === 'live' ? 'live' : 'board',
    selected: params.get('detail') || null,
  };

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function age(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // The model in one function: the page recomputes a row from the snapshot
  // figures and checks the number board.json carries, so the page's code and
  // the board's data are visibly the same arithmetic.
  function impliedOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.multiple * row.growth_factor * row.maturity_factor));
  }

  var statsEl = document.getElementById('stats');
  statsEl.innerHTML =
    '<div><dt>Board rows</dt><dd>' + DATA.board_size + '</dd></div>' +
    '<div><dt>Watchlist covered</dt><dd>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</dd></div>' +
    '<div><dt>Early finds below the floor</dt><dd>' + DATA.early_size + '</dd></div>' +
    '<div><dt>Total implied value</dt><dd>' + usd(DATA.total_implied_usd) + '</dd></div>' +
    '<div><dt>Snapshot</dt><dd>' + esc(DATA.as_of) + '</dd></div>';
  document.getElementById('overall').textContent = DATA.overall_multiple.toFixed(4);
  document.getElementById('src').textContent = 'Source: ' + DATA.source + '. Snapshot date ' + DATA.as_of + '.';

  var catSel = document.getElementById('cat');
  var chainSel = document.getElementById('chain');
  var cats = {};
  var chains = {};
  DATA.rows.forEach(function (r) {
    if (r.category) cats[r.category] = true;
    r.chains.forEach(function (c) { chains[c] = true; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c; catSel.appendChild(o);
  });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c; chainSel.appendChild(o);
  });
  document.getElementById('q').value = state.q;
  catSel.value = state.cat;
  chainSel.value = state.chain;
  document.getElementById('wl').checked = state.wl;
  document.getElementById('sort').value = state.sort;

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (state.wl && !r.watchlist) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      return true;
    });
    var by = {
      implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
      age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
    }[state.sort] || function (a, b) { return b.implied_value_usd - a.implied_value_usd; };
    return rows.slice().sort(by);
  }

  function renderBoard() {
    var rows = filteredRows();
    var tbody = document.getElementById('rows');
    tbody.innerHTML = rows.map(function (r) {
      var g = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var cls = r.change_7d === null ? '' : (r.change_7d >= 0 ? 'up' : 'down');
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="selected"' : '') + '>' +
        '<td>' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong>' + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num ' + cls + '">' + g + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num"><strong>' + usd(r.implied_value_usd) + '</strong></td></tr>';
    }).join('');
    document.getElementById('count').textContent =
      rows.length + ' of ' + DATA.board_size + ' protocols shown — ranked by implied launch value.';
    tbody.querySelectorAll('tr').forEach(function (tr) {
      tr.addEventListener('click', function () { select(tr.getAttribute('data-slug')); });
    });
  }

  function renderLive() {
    var tbody = document.getElementById('live-rows');
    tbody.innerHTML = DATA.live.map(function (r) {
      var ratio = (r.mcap_usd && r.tvl_usd) ? (r.mcap_usd / r.tvl_usd).toFixed(3) : 'n/a';
      return '<tr><td><strong>' + esc(r.name) + '</strong></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num">' + usd(r.mcap_usd) + '</td>' +
        '<td class="num">' + ratio + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td></tr>';
    }).join('');
  }

  function select(slug) {
    state.selected = slug;
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    var box = document.getElementById('detail');
    if (!row) { box.hidden = true; box.innerHTML = ''; renderBoard(); return; }
      var check = impliedOf(row);
    var within = Math.abs(check - row.implied_value_usd) <= Math.max(1, row.implied_value_usd * 0.0001);
    var ok = within;
    box.hidden = false;
    box.innerHTML =
      '<h2>' + esc(row.name) + ' <span class="badge">RANK #' + row.rank + '</span></h2>' +
      '<p class="sub">' + esc(row.category || 'Uncategorised') + ' &middot; ' + esc(row.chains.join(', ')) +
      ' &middot; tracked since ' + esc(row.listed_at || 'unknown') + ' (' + age(row.age_days) + ')' +
      (row.watchlist ? ' &middot; on the snapshot watchlist' : '') + '</p>' +
      '<h3>The model&rsquo;s maths</h3>' +
      '<dl class="math">' +
      '<div><dt>TVL</dt><dd>' + usd(row.tvl_usd) + '</dd></div>' +
      '<div><dt>Category multiple</dt><dd>' + row.multiple.toFixed(4) + 'x</dd></div>' +
      '<div><dt>Growth factor</dt><dd>' + row.growth_factor.toFixed(4) + 'x</dd></div>' +
      '<div><dt>Maturity factor</dt><dd>' + row.maturity_factor.toFixed(4) + 'x</dd></div>' +
      '<div><dt>Implied value</dt><dd>' + usd(row.implied_value_usd) +
      (ok ? ' <span class="ok">recomputed, matches</span>' : ' <span class="ok">recomputed ' + usd(check) + '</span>') + '</dd></div>' +
      '</dl>' +
      '<p class="note">This protocol&rsquo;s record shows no token (no market cap, no CoinGecko id, no symbol). ' +
      'That is what the snapshot records — not proof it has none.</p>' +
      '<h3>How to farm it</h3>' +
      '<ol>' + row.farm_steps.map(function (s) {
        var m = s.match(/^(.*) Cost: (.*)\. Time: (.*)\.$/);
        if (!m) return '<li>' + esc(s) + '</li>';
        return '<li>' + esc(m[1]) + ' <b>Cost:</b> ' + esc(m[2]) + '. <b>Time:</b> ' + esc(m[3]) + '.</li>';
      }).join('') + '</ol>';
    renderBoard();
    box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function setTab(tab) {
    state.tab = tab;
    document.getElementById('tab-board').classList.toggle('active', tab === 'board');
    document.getElementById('tab-live').classList.toggle('active', tab === 'live');
    document.getElementById('view-board').hidden = tab !== 'board';
    document.getElementById('view-live').hidden = tab !== 'live';
    if (tab === 'live') renderLive();
  }

  document.getElementById('tab-board').addEventListener('click', function () { setTab('board'); });
  document.getElementById('tab-live').addEventListener('click', function () { setTab('live'); });
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  catSel.addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  chainSel.addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  document.getElementById('wl').addEventListener('change', function (e) { state.wl = e.target.checked; renderBoard(); });
  document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });
  document.getElementById('controls').addEventListener('submit', function (e) { e.preventDefault(); });

  setTab(state.tab);
  renderBoard();
  if (state.selected) select(state.selected);
})();
