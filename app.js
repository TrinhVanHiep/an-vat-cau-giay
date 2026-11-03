(function () {
  'use strict';

  var DATA = window.SNACK_DATA;
  var SHOPS = DATA.shops;
  var TZ = 'Asia/Ho_Chi_Minh';

  // Loại món suy ra từ tên quán (ShopeeFood không có danh mục ăn vặt chi tiết).
  var TAGS = [
    { id: 'han', name: 'Tokbokki & đồ Hàn', kw: ['tokbokki', 'topokki', 'tteokbokki', 'kimbap', 'mì cay', 'mỳ cay', 'hàn quốc', 'gà sốt hàn'] },
    { id: 'mi', name: 'Mì trộn', kw: ['mì trộn', 'mỳ trộn', 'indomie'] },
    { id: 'banhtrang', name: 'Bánh tráng', kw: ['bánh tráng'] },
    { id: 'xien', name: 'Xiên, nem chua rán', kw: ['xiên', 'xiên que', 'viên chiên', 'cá viên', 'xúc xích', 'nem chua', 'bột chiên', 'khoai tây chiên', 'hotdog', 'viên thả lẩu'] },
    { id: 'nemnuong', name: 'Nem nướng', kw: ['nem nướng'] },
    { id: 'ga', name: 'Chân gà, gà rán', kw: ['chân gà', 'cánh gà', 'gà rán', 'chân cánh gà', 'gà ủ muối'] },
    { id: 'che', name: 'Chè, kem, sữa chua', kw: ['chè', 'kem', 'sữa chua', 'hoa quả dầm', 'bánh flan', 'caramen', 'sữa dừa', 'taro'] },
    { id: 'oc', name: 'Ốc', kw: ['ốc'] },
    { id: 'banh', name: 'Bánh mì & các loại bánh', kw: ['bánh mì', 'bánh bao', 'bánh rán', 'bánh gối', 'takoyaki', 'há cảo', 'dimsum', 'pizza mini', 'bánh bột lọc'] },
    { id: 'nom', name: 'Nộm, hoa quả', kw: ['nộm', 'cóc', 'xoài', 'gỏi cuốn', 'hoa quả'] },
    { id: 'nuoc', name: 'Kèm trà sữa, nước', kw: ['trà sữa', 'trà', 'nước ép', 'sinh tố', 'nước mía'] }
  ];

  var DEFAULTS = { q: '', maxKm: 3, maxPrice: 0, rating4: false, hideClosed: false, tags: [], sort: 'near' };
  var state = copy(DEFAULTS);
  var lastPickId = null;
  var spinTimer = null;
  var highlightId = null;

  function $(id) { return document.getElementById(id); }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Chuẩn hoá để so từ khoá: chữ thường, bỏ dấu câu, giữ dấu tiếng Việt.
  function norm(s) {
    return ' ' + String(s).normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() + ' ';
  }

  // Bỏ dấu để ô tìm kiếm khớp cả khi gõ không dấu ("banh trang").
  function fold(s) {
    return norm(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  }

  SHOPS.forEach(function (s) {
    var n = norm(s.n);
    s.tags = TAGS.filter(function (t) {
      return t.kw.some(function (k) { return n.indexOf(' ' + k + ' ') !== -1; });
    }).map(function (t) { return t.id; });
    s.search = fold(s.n + ' ' + s.a);
  });

  /* ---------- Định dạng ---------- */
  var kmFmt = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  var ratingFmt = new Intl.NumberFormat('vi-VN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  function priceK(v) { return Math.round(v / 1000) + 'k'; }

  function priceText(s) {
    if (!s.min && !s.max) return null;
    if (s.min && s.max && s.min !== s.max) return priceK(s.min) + '–' + priceK(s.max);
    return priceK(s.min || s.max);
  }

  function dateText(iso) {
    var p = iso.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }

  /* ---------- Giờ mở cửa (giờ Việt Nam) ---------- */
  var DAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

  // Trả về { day: 1 (thứ Hai) … 7 (Chủ nhật), min: phút trong ngày } theo giờ Việt Nam.
  function nowVN() {
    var parts = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
    var out = { day: 0, min: 0 };
    parts.forEach(function (p) {
      if (p.type === 'weekday') out.day = DAY[p.value];
      if (p.type === 'hour') out.min += Number(p.value) * 60;
      if (p.type === 'minute') out.min += Number(p.value);
    });
    return out;
  }

  function toMin(t) {
    var p = t.split(':');
    return Number(p[0]) * 60 + Number(p[1]);
  }

  function inRange(now, start, end) {
    var o = toMin(start), c = toMin(end);
    return o <= c ? (now >= o && now <= c) : (now >= o || now <= c);
  }

  function isAllDay(r) { return toMin(r[0]) === 0 && toMin(r[1]) >= 23 * 60 + 59; }

  // s.h: giờ theo từng ngày [[ngày, mở, đóng], …] từ trang quán; s.o / s.c: giờ ngày lấy dữ liệu, dùng khi không có s.h.
  function status(s, now) {
    var ranges;
    if (s.h && s.h.length) {
      ranges = s.h.filter(function (r) { return r[0] === now.day; }).map(function (r) { return [r[1], r[2]]; });
      if (!ranges.length) return { key: 'closed', text: 'Hôm nay nghỉ' };
    } else if (s.o && s.c) {
      ranges = [[s.o, s.c]];
    } else {
      return { key: 'unknown', text: 'Không rõ giờ' };
    }
    if (ranges.some(isAllDay)) return { key: 'open', text: 'Mở cả ngày' };
    var open = ranges.filter(function (r) { return inRange(now.min, r[0], r[1]); })[0];
    if (open) return { key: 'open', text: 'Đang mở · đến ' + open[1] };
    var later = ranges.filter(function (r) { return toMin(r[0]) > now.min; })
      .sort(function (a, b) { return toMin(a[0]) - toMin(b[0]); })[0];
    return later
      ? { key: 'closed', text: 'Đang đóng · mở lúc ' + later[0] }
      : { key: 'closed', text: 'Đã đóng cửa hôm nay' };
  }

  /* ---------- Lọc và sắp xếp ---------- */
  function trusted(s) { return (s.rv || 0) >= 10 ? 1 : 0; }

  function filtered() {
    var now = nowVN();
    var q = state.q ? fold(state.q).trim() : '';
    var list = SHOPS.filter(function (s) {
      if (s.km > state.maxKm) return false;
      if (state.maxPrice && !(s.min && s.min <= state.maxPrice)) return false;
      if (state.rating4 && !(s.r >= 4)) return false;
      if (state.hideClosed && status(s, now).key === 'closed') return false;
      if (state.tags.length && !state.tags.some(function (t) { return s.tags.indexOf(t) !== -1; })) return false;
      if (q && s.search.indexOf(q) === -1) return false;
      return true;
    });
    var by = {
      near: function (a, b) { return a.km - b.km; },
      // Quán có từ 10 lượt đánh giá xếp trước, để vài lượt 5★ không đứng đầu.
      rating: function (a, b) { return trusted(b) - trusted(a) || (b.r || 0) - (a.r || 0) || (b.rv || 0) - (a.rv || 0) || a.km - b.km; },
      reviews: function (a, b) { return (b.rv || 0) - (a.rv || 0) || a.km - b.km; },
      cheap: function (a, b) { return (a.min || Infinity) - (b.min || Infinity) || a.km - b.km; }
    };
    return list.sort(by[state.sort]);
  }

  /* ---------- Hiển thị ---------- */
  function metaHtml(s, now) {
    var st = status(s, now);
    var price = priceText(s);
    return '<div class="meta">' +
      (s.r ? '<span class="rating"><span class="star" aria-hidden="true">★</span> <b>' + ratingFmt.format(s.r) + '</b>' +
        (s.drv ? ' · ' + esc(s.drv) + ' đánh giá' : '') + '</span>' : '<span class="status-unknown">Chưa có đánh giá</span>') +
      (price ? '<span>Giá ' + price + '</span>' : '<span class="status-unknown">Chưa rõ giá</span>') +
      '<span class="status-' + st.key + '">' + st.text + '</span>' +
    '</div>';
  }

  function tagsHtml(s) {
    if (!s.tags.length) return '';
    return '<div class="tags">' + s.tags.map(function (id) {
      var t = TAGS.filter(function (x) { return x.id === id; })[0];
      return '<span class="tag">' + esc(t.name) + '</span>';
    }).join('') + '</div>';
  }

  function orderLink(s) {
    return '<a class="btn-order" href="' + esc(s.u) + '" target="_blank" rel="noopener">Mở trên ShopeeFood <span aria-hidden="true">↗</span></a>';
  }

  function renderList() {
    var now = nowVN();
    var list = filtered();
    $('count').textContent = 'Đang hiện ' + list.length + ' / ' + SHOPS.length + ' quán';
    $('empty').hidden = list.length > 0;
    $('list').innerHTML = list.map(function (s) {
      return '<li class="shop" id="shop-' + s.id + '">' +
        '<div class="shop-top"><h3 class="shop-name">' + esc(s.n) + '</h3>' +
          '<span class="km">' + kmFmt.format(s.km) + ' km</span></div>' +
        '<p class="addr">' + esc(s.a) + '</p>' +
        metaHtml(s, now) +
        tagsHtml(s) +
        '<div class="shop-foot">' + orderLink(s) + '</div>' +
      '</li>';
    }).join('');
    if (highlightId && $('shop-' + highlightId)) $('shop-' + highlightId).classList.add('highlight');

    var spin = $('btn-spin');
    spin.disabled = list.length === 0;
    spin.textContent = list.length === 0 ? 'Không có quán để quay' : 'Quay một quán';
    renderChipCounts();
  }

  function renderChips() {
    $('chips').innerHTML = TAGS.map(function (t) {
      return '<button type="button" class="chip" data-tag="' + t.id + '" aria-pressed="false">' + esc(t.name) + '<span class="n"></span></button>';
    }).join('');
  }

  function renderChipCounts() {
    var buttons = $('chips').querySelectorAll('.chip');
    for (var i = 0; i < buttons.length; i++) {
      var id = buttons[i].getAttribute('data-tag');
      var n = SHOPS.filter(function (s) { return s.km <= state.maxKm && s.tags.indexOf(id) !== -1; }).length;
      buttons[i].querySelector('.n').textContent = n;
      buttons[i].setAttribute('aria-pressed', state.tags.indexOf(id) !== -1 ? 'true' : 'false');
    }
  }

  function syncControls() {
    $('q').value = state.q;
    $('km-' + state.maxKm).checked = true;
    $('price-' + (state.maxPrice ? state.maxPrice / 1000 : 'all')).checked = true;
    $('rating4').checked = state.rating4;
    $('hide-closed').checked = state.hideClosed;
    $('sort').value = state.sort;
  }

  /* ---------- Quay ngẫu nhiên ---------- */
  function showPick(s, spinning) {
    var box = $('pick');
    box.classList.toggle('spinning', !!spinning);
    if (spinning) {
      box.innerHTML = '<p class="pick-label">Đang quay…</p><p class="pick-name">' + esc(s.n) + '</p>';
      return;
    }
    box.innerHTML =
      '<p class="pick-label">Hôm nay ăn ở</p>' +
      '<p class="pick-name">' + esc(s.n) + '</p>' +
      '<p class="addr">' + esc(s.a) + ' · ' + kmFmt.format(s.km) + ' km</p>' +
      metaHtml(s, nowVN()) +
      '<div class="pick-actions">' + orderLink(s) +
        '<button type="button" class="btn-ghost" id="btn-goto" data-id="' + s.id + '">Xem trong danh sách</button>' +
        '<button type="button" class="btn-ghost" id="btn-again">Quay lại</button>' +
      '</div>';
  }

  function spin() {
    var pool = filtered();
    if (!pool.length) return;
    var pick = pool[Math.floor(Math.random() * pool.length)];
    if (pool.length > 1) {
      while (pick.id === lastPickId) pick = pool[Math.floor(Math.random() * pool.length)];
    }
    lastPickId = pick.id;

    clearInterval(spinTimer);
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce || pool.length === 1) {
      showPick(pick, false);
      return;
    }
    var btn = $('btn-spin');
    btn.disabled = true;
    var ticks = 0;
    spinTimer = setInterval(function () {
      ticks++;
      if (ticks >= 14) {
        clearInterval(spinTimer);
        showPick(pick, false);
        btn.disabled = filtered().length === 0;
        return;
      }
      showPick(pool[Math.floor(Math.random() * pool.length)], true);
    }, 70);
  }

  function gotoShop(id) {
    var el = $('shop-' + id);
    if (!el) {
      // Quán không còn trong danh sách đang lọc: xoá ô tìm để hiện lại.
      state.q = '';
      syncControls();
      renderList();
      el = $('shop-' + id);
    }
    if (!el) return;
    var old = document.querySelector('.shop.highlight');
    if (old) old.classList.remove('highlight');
    highlightId = id;
    el.classList.add('highlight');
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  /* ---------- Sự kiện ---------- */
  function bind() {
    var qTimer = null;
    $('q').addEventListener('input', function (e) {
      clearTimeout(qTimer);
      qTimer = setTimeout(function () { state.q = e.target.value; renderList(); }, 150);
    });
    document.querySelectorAll('input[name=km]').forEach(function (r) {
      r.addEventListener('change', function () { state.maxKm = Number(r.value); renderList(); });
    });
    document.querySelectorAll('input[name=price]').forEach(function (r) {
      r.addEventListener('change', function () { state.maxPrice = Number(r.value); renderList(); });
    });
    $('rating4').addEventListener('change', function (e) { state.rating4 = e.target.checked; renderList(); });
    $('hide-closed').addEventListener('change', function (e) { state.hideClosed = e.target.checked; renderList(); });
    $('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderList(); });

    $('chips').addEventListener('click', function (e) {
      var chip = e.target.closest('.chip');
      if (!chip) return;
      var id = chip.getAttribute('data-tag');
      var i = state.tags.indexOf(id);
      if (i === -1) state.tags.push(id); else state.tags.splice(i, 1);
      renderList();
    });

    function clearAll() { state = copy(DEFAULTS); syncControls(); renderList(); }
    $('btn-clear').addEventListener('click', clearAll);
    $('btn-clear-2').addEventListener('click', clearAll);

    $('btn-spin').addEventListener('click', spin);
    $('pick').addEventListener('click', function (e) {
      if (e.target.id === 'btn-again') spin();
      if (e.target.id === 'btn-goto') gotoShop(e.target.getAttribute('data-id'));
    });
  }

  /* ---------- Khởi động ---------- */
  function init() {
    var near1 = SHOPS.filter(function (s) { return s.km <= 1; }).length;
    $('sub').textContent = SHOPS.length + ' quán ăn vặt trên ShopeeFood trong bán kính ' + DATA.radiusKm +
      ' km quanh ' + DATA.center.name + ' (' + near1 + ' quán trong 1 km). Dữ liệu lấy ngày ' + dateText(DATA.collectedAt) + '.';
    $('note').innerHTML =
      '<p>Nguồn: ShopeeFood (shopeefood.vn), lấy ngày ' + dateText(DATA.collectedAt) + '. Trang này không đặt món được; bấm "Mở trên ShopeeFood" rồi đặt trong app Shopee.</p>' +
      '<p>Khoảng cách là đường chim bay từ ' + esc(DATA.center.name) + ' tới tọa độ quán trên ShopeeFood. Giá là khoảng giá quán ghi trên ShopeeFood; giá món, giờ mở cửa và khuyến mãi có thể đã thay đổi. Loại món được đoán từ tên quán.</p>';
    renderChips();
    bind();
    syncControls();
    renderList();
    // Cập nhật trạng thái mở/đóng theo phút; bỏ qua khi đang dùng bàn phím trong danh sách để không mất focus.
    setInterval(function () { if (!$('list').contains(document.activeElement)) renderList(); }, 60 * 1000);
  }

  init();
})();
