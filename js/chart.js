/* chart.js - dibujo en canvas: mapa de la red, perfil del enlace y vista radar.
   Sin librerias externas ni imagenes: funciona 100% offline. */
(function (global) {
  'use strict';

  function color(nombre) {
    return getComputedStyle(document.documentElement).getPropertyValue('--' + nombre).trim() || '#888';
  }

  /* Ajusta el canvas al ancho real y a la densidad de pantalla. */
  function preparar(cv, alto) {
    var dpr = global.devicePixelRatio || 1;
    var w = cv.clientWidth || cv.parentNode.clientWidth || 600;
    var h = alto || cv.getAttribute('height') || 300;
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.height = h + 'px';
    var ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, w: w, h: h };
  }

  function txt(ctx, s, x, y, col, tam, align, peso) {
    ctx.fillStyle = col; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = (peso || 400) + ' ' + (tam || 11) + 'px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(s, x, y);
  }

  /* ===================== mapa ===================== */
  var RAD = Math.PI / 180;
  function proyY(lat) { return Math.log(Math.tan(Math.PI / 4 + lat * RAD / 2)) / RAD; }
  function invY(y) { return (2 * Math.atan(Math.exp(y * RAD)) - Math.PI / 2) / RAD; }

  function Mapa(cv) {
    this.cv = cv;
    this.sitios = [];
    this.items = [];
    this.vista = { cx: -70.6, cy: proyY(-33.45), esc: 40 };   // px por grado proyectado
    this.alto = parseInt(cv.getAttribute('height'), 10) || 420;
    this.onClick = null;
    this._eventos();
  }

  Mapa.prototype.datos = function (sitios, items) {
    this.sitios = sitios || [];
    this.items = items || [];
  };

  Mapa.prototype.encuadrar = function (puntos) {
    var pts = (puntos && puntos.length) ? puntos : this.items.length ? puntosDeItems(this.items) : null;
    if (!pts || !pts.length) return;
    var laMin = 1e9, laMax = -1e9, loMin = 1e9, loMax = -1e9;
    pts.forEach(function (p) {
      laMin = Math.min(laMin, p.lat); laMax = Math.max(laMax, p.lat);
      loMin = Math.min(loMin, p.lon); loMax = Math.max(loMax, p.lon);
    });
    var w = this.cv.clientWidth || 600, h = this.alto;
    var yMin = proyY(laMin), yMax = proyY(laMax);
    var dx = Math.max(0.02, loMax - loMin), dy = Math.max(0.02, yMax - yMin);
    this.vista.esc = Math.min(w * 0.82 / dx, h * 0.82 / dy);
    this.vista.cx = (loMin + loMax) / 2;
    this.vista.cy = (yMin + yMax) / 2;
    this.dibujar();
  };

  function puntosDeItems(items) {
    var p = [];
    items.forEach(function (it) {
      p.push({ lat: it.lat, lon: it.lon });
      if (it.fo && it.fo.sitio) p.push({ lat: it.fo.sitio.lat, lon: it.fo.sitio.lon });
      if (it.mw && it.mw.sitio) p.push({ lat: it.mw.sitio.lat, lon: it.mw.sitio.lon });
      if (it.tipo === 'enlace' && it.b) p.push({ lat: it.b.lat, lon: it.b.lon });
    });
    return p;
  }

  Mapa.prototype.aPantalla = function (lat, lon, w, h) {
    var v = this.vista;
    return {
      x: w / 2 + (lon - v.cx) * v.esc,
      y: h / 2 - (proyY(lat) - v.cy) * v.esc
    };
  };
  Mapa.prototype.aGeo = function (x, y, w, h) {
    var v = this.vista;
    return { lon: v.cx + (x - w / 2) / v.esc, lat: invY(v.cy - (y - h / 2) / v.esc) };
  };

  Mapa.prototype.dibujar = function () {
    var p = preparar(this.cv, this.alto), ctx = p.ctx, w = p.w, h = p.h, self = this;
    var cLinea = color('linea'), cTxt3 = color('txt-3'), cAcento = color('acento');
    var cFo = color('fo'), cMw = color('mw');

    // retícula de grados
    ctx.strokeStyle = cLinea; ctx.lineWidth = 1;
    var g0 = this.aGeo(0, h, w, h), g1 = this.aGeo(w, 0, w, h);
    var paso = escalaGrados(this.vista.esc);
    ctx.globalAlpha = .55;
    for (var lo = Math.ceil(g0.lon / paso) * paso; lo <= g1.lon; lo += paso) {
      var x = this.aPantalla(0, lo, w, h).x;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      txt(ctx, lo.toFixed(paso < 1 ? 2 : 0) + '°', x + 3, h - 4, cTxt3, 9);
    }
    for (var la = Math.ceil(g0.lat / paso) * paso; la <= g1.lat; la += paso) {
      var y = this.aPantalla(la, 0, w, h).y;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      txt(ctx, la.toFixed(paso < 1 ? 2 : 0) + '°', 3, y - 3, cTxt3, 9);
    }
    ctx.globalAlpha = 1;

    // sitios de la red base
    var r = this.vista.esc > 400 ? 2.5 : this.vista.esc > 80 ? 1.8 : 1.2;
    ctx.fillStyle = cTxt3; ctx.globalAlpha = this.vista.esc > 80 ? .85 : .5;
    for (var i = 0; i < this.sitios.length; i++) {
      var s = this.sitios[i], q = this.aPantalla(s.lat, s.lon, w, h);
      if (q.x < -5 || q.x > w + 5 || q.y < -5 || q.y > h + 5) continue;
      ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, 6.2832); ctx.fill();
    }
    ctx.globalAlpha = 1;

    // enlaces evaluados
    this._pos = [];
    this.items.forEach(function (it) {
      var a = self.aPantalla(it.lat, it.lon, w, h);
      if (it.fo && it.fo.sitio) linea(ctx, a, self.aPantalla(it.fo.sitio.lat, it.fo.sitio.lon, w, h), cFo, 1.6, [5, 4]);
      var destino = (it.tipo === 'enlace' && it.b) ? it.b : (it.mw && it.mw.sitio);
      if (destino) linea(ctx, a, self.aPantalla(destino.lat, destino.lon, w, h), cMw, 1.6, null);
      self._pos.push({ it: it, x: a.x, y: a.y });
    });

    // marcadores de los candidatos
    this._pos.forEach(function (m) {
      ctx.beginPath(); ctx.arc(m.x, m.y, 5.5, 0, 6.2832);
      ctx.fillStyle = cAcento; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = color('bg'); ctx.stroke();
      if (self.vista.esc > 150 || self.items.length <= 14) {
        txt(ctx, m.it.nombre.length > 22 ? m.it.nombre.slice(0, 21) + '…' : m.it.nombre,
            m.x + 9, m.y + 3.5, color('txt'), 10.5, 'left', 500);
      }
    });

    // escala gráfica
    var kmPx = 111.32 * Math.cos(this.aGeo(w / 2, h / 2, w, h).lat * RAD) * 1 / this.vista.esc; // km por px
    var objetivo = 90, km = kmPx * objetivo, mag = Math.pow(10, Math.floor(Math.log10(km)));
    km = Math.round(km / mag) * mag || mag;
    var px = km / kmPx;
    var bx = w - px - 14, by = h - 16;
    ctx.strokeStyle = color('txt-2'); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + px, by);
    ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by + 4);
    ctx.moveTo(bx + px, by - 4); ctx.lineTo(bx + px, by + 4); ctx.stroke();
    txt(ctx, (km >= 1 ? km : km.toFixed(1)) + ' km', bx + px / 2, by - 6, color('txt-2'), 10, 'center');
  };

  function escalaGrados(esc) {
    var opciones = [10, 5, 2, 1, .5, .2, .1, .05, .02, .01];
    for (var i = 0; i < opciones.length; i++) if (opciones[i] * esc >= 55) return opciones[i];
    return .005;
  }

  function linea(ctx, a, b, col, ancho, guion) {
    ctx.save();
    ctx.strokeStyle = col; ctx.lineWidth = ancho || 1.5;
    if (guion) ctx.setLineDash(guion);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.restore();
  }

  Mapa.prototype._eventos = function () {
    var self = this, cv = this.cv, arrastre = null;
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var rect = cv.getBoundingClientRect(), w = rect.width, h = self.alto;
      var antes = self.aGeo(e.clientX - rect.left, e.clientY - rect.top, w, h);
      var f = Math.exp(-e.deltaY * 0.0015);
      self.vista.esc = Math.max(3, Math.min(200000, self.vista.esc * f));
      var despues = self.aGeo(e.clientX - rect.left, e.clientY - rect.top, w, h);
      self.vista.cx += antes.lon - despues.lon;
      self.vista.cy += proyY(antes.lat) - proyY(despues.lat);
      self.dibujar();
    }, { passive: false });

    cv.addEventListener('pointerdown', function (e) {
      arrastre = { x: e.clientX, y: e.clientY, movio: false };
      cv.classList.add('arrastrando');
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', function (e) {
      if (!arrastre) return;
      var dx = e.clientX - arrastre.x, dy = e.clientY - arrastre.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) arrastre.movio = true;
      self.vista.cx -= dx / self.vista.esc;
      self.vista.cy += dy / self.vista.esc;
      arrastre.x = e.clientX; arrastre.y = e.clientY;
      self.dibujar();
    });
    cv.addEventListener('pointerup', function (e) {
      cv.classList.remove('arrastrando');
      if (arrastre && !arrastre.movio && self.onClick) {
        var rect = cv.getBoundingClientRect();
        var mx = e.clientX - rect.left, my = e.clientY - rect.top, mejor = null;
        (self._pos || []).forEach(function (m) {
          var d = Math.hypot(m.x - mx, m.y - my);
          if (d < 14 && (!mejor || d < mejor.d)) mejor = { d: d, it: m.it };
        });
        if (mejor) self.onClick(mejor.it);
      }
      arrastre = null;
    });
  };

  /* ===================== perfil del enlace ===================== */
  /* Vista lateral: bulbo terrestre, visual entre antenas y envolvente 0.6·F1.
     ev = resultado de Radio.evalMMOO; o = { dKm, hA, hB, k, f, obstaculoM, obstaculoKm } */
  function perfil(cv, o, ev) {
    var p = preparar(cv, o.alto || 210), ctx = p.ctx, w = p.w, h = p.h;
    var mI = 42, mD = 12, mS = 16, mB = 26;
    var W = w - mI - mD, H = h - mS - mB;
    var d = o.dKm, k = o.k || 1.33, f = o.f || ev.banda;
    var frac = (o.fracFresnel == null ? 0.6 : o.fracFresnel);

    // curva del bulbo terrestre + obstaculo declarado
    var N = 120, suelo = [], i, x, b;
    for (i = 0; i <= N; i++) {
      x = d * i / N;
      b = Radio.bulboTierra(x, d - x, k);
      if (o.obstaculoM) {
        var oc = (o.obstaculoKm == null ? d / 2 : o.obstaculoKm);
        var ancho = Math.max(d * 0.04, 0.25);
        if (Math.abs(x - oc) < ancho) b += o.obstaculoM * (1 - Math.abs(x - oc) / ancho);
      }
      suelo.push({ x: x, y: b });
    }
    var yMax = Math.max(o.hA || 0, o.hB || 0, ev.despejeReq * 1.25, 12) * 1.12;
    var yMin = 0;
    var X = function (km) { return mI + km / d * W; };
    var Y = function (m) { return mS + H - (m - yMin) / (yMax - yMin) * H; };

    // ejes
    ctx.strokeStyle = color('linea'); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mI, mS); ctx.lineTo(mI, mS + H); ctx.lineTo(mI + W, mS + H); ctx.stroke();
    var pasoY = Math.max(5, Math.round(yMax / 4 / 5) * 5);
    ctx.globalAlpha = .5;
    for (var yy = 0; yy <= yMax; yy += pasoY) {
      ctx.beginPath(); ctx.moveTo(mI, Y(yy)); ctx.lineTo(mI + W, Y(yy)); ctx.stroke();
      txt(ctx, yy + '', mI - 5, Y(yy) + 3.5, color('txt-3'), 9.5, 'right');
    }
    ctx.globalAlpha = 1;
    txt(ctx, 'm', mI - 5, mS - 4, color('txt-3'), 9.5, 'right');
    // en saltos cortos el eje se rotula en metros para que las marcas no se repitan
    var enM = d < 1, dec = enM ? 0 : d < 4 ? 2 : d < 40 ? 1 : 0;
    for (var kk = 0; kk <= 4; kk++) {
      var km = d * kk / 4;
      txt(ctx, (enM ? km * 1000 : km).toFixed(dec), X(km), mS + H + 13, color('txt-3'), 9.5, 'center');
    }
    txt(ctx, enM ? 'm' : 'km', mI + W, mS + H + 22, color('txt-3'), 9.5, 'right');

    // envolvente de Fresnel bajo la visual
    var hA = o.hA || 0, hB = o.hB || 0;
    var los = function (km) { return hA + (hB - hA) * km / d; };
    var env = suelo.map(function (s) {
      return { x: s.x, y: los(s.x) - frac * Radio.fresnel1(s.x, d - s.x, f) };
    });

    // suelo aparente (se pinta antes que la zona de violacion, si no la tapa)
    ctx.beginPath();
    suelo.forEach(function (s, j) { j ? ctx.lineTo(X(s.x), Y(s.y)) : ctx.moveTo(X(s.x), Y(s.y)); });
    ctx.lineTo(X(d), Y(0)); ctx.lineTo(X(0), Y(0)); ctx.closePath();
    ctx.fillStyle = color('bg-3'); ctx.fill();

    // zona de violacion: solo los tramos donde la envolvente queda BAJO el terreno
    ctx.save();
    ctx.fillStyle = color('noviable'); ctx.globalAlpha = .32;
    var tramo = null;
    for (i = 0; i < env.length; i++) {
      var viola = env[i].y < suelo[i].y;
      if (viola && tramo === null) tramo = i;
      if (tramo !== null && (!viola || i === env.length - 1)) {
        var fin = viola ? i : i - 1;
        if (fin > tramo) {
          ctx.beginPath();
          for (var a = tramo; a <= fin; a++) ctx.lineTo(X(env[a].x), Y(env[a].y));
          for (var c2 = fin; c2 >= tramo; c2--) ctx.lineTo(X(suelo[c2].x), Y(suelo[c2].y));
          ctx.closePath(); ctx.fill();
        }
        tramo = null;
      }
    }
    ctx.restore();

    ctx.strokeStyle = color('txt-2'); ctx.lineWidth = 1.4;
    ctx.beginPath();
    suelo.forEach(function (s, j) { j ? ctx.lineTo(X(s.x), Y(s.y)) : ctx.moveTo(X(s.x), Y(s.y)); });
    ctx.stroke();

    // envolvente 0.6 F1
    ctx.save(); ctx.setLineDash([4, 3]);
    ctx.strokeStyle = color('media'); ctx.lineWidth = 1.2;
    ctx.beginPath();
    env.forEach(function (e, j) { j ? ctx.lineTo(X(e.x), Y(e.y)) : ctx.moveTo(X(e.x), Y(e.y)); });
    ctx.stroke(); ctx.restore();

    // visual entre antenas
    ctx.strokeStyle = ev.cumpleDespeje ? color('alta') : color('noviable');
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(X(0), Y(hA)); ctx.lineTo(X(d), Y(hB)); ctx.stroke();

    // torres: la etiqueta va bajo el punto si la antena queda arriba, para no
    // chocar con el borde superior ni con la leyenda
    [[0, hA, 'A'], [d, hB, 'B']].forEach(function (t) {
      ctx.strokeStyle = color('acento'); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(X(t[0]), Y(0)); ctx.lineTo(X(t[0]), Y(t[1])); ctx.stroke();
      ctx.beginPath(); ctx.arc(X(t[0]), Y(t[1]), 3, 0, 6.2832); ctx.fillStyle = color('acento'); ctx.fill();
      var arriba = (t[1] > yMax * 0.72);
      txt(ctx, t[2] + ' ' + Math.round(t[1]) + ' m', X(t[0]) + (t[0] ? -5 : 5),
          Y(t[1]) + (arriba ? 13 : -7), color('txt-2'), 10, t[0] ? 'right' : 'left', 500);
    });

    // cota en el punto medio
    var xm = d / 2, ym = los(xm), yr = ev.despejeReq;
    ctx.save(); ctx.setLineDash([2, 2]); ctx.strokeStyle = color('txt-3');
    ctx.beginPath(); ctx.moveTo(X(xm), Y(ym)); ctx.lineTo(X(xm), Y(yr)); ctx.stroke(); ctx.restore();
    var etiqueta = (ev.holgura >= 0 ? '+' : '') + ev.holgura.toFixed(1) + ' m';
    txt(ctx, etiqueta, X(xm) + 5, (Y(ym) + Y(yr)) / 2,
        ev.holgura >= 0 ? color('alta') : color('noviable'), 10.5, 'left', 600);
    txt(ctx, 'despeje req. ' + yr.toFixed(1) + ' m = bulbo ' + ev.bulbo.toFixed(1) +
        ' + ' + frac + '·F1 ' + (frac * ev.fresnel).toFixed(1) +
        (o.obstaculoM ? ' + obst. ' + o.obstaculoM : ''), mI + W, mS + 10, color('txt-3'), 9.5, 'right');
  }

  /* ===================== radar de sitios cercanos ===================== */
  function radar(cv, centro, vecinos, marcados, radioKm) {
    var p = preparar(cv, 260), ctx = p.ctx, w = p.w, h = p.h;
    var cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 22;
    var rMax = radioKm || Math.max(1, (vecinos[vecinos.length - 1] || { distKm: 1 }).distKm) * 1.05;

    // anillos
    ctx.strokeStyle = color('linea');
    for (var i = 1; i <= 4; i++) {
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, R * i / 4, 0, 6.2832); ctx.stroke();
      txt(ctx, (rMax * i / 4).toFixed(rMax < 4 ? 1 : 0) + ' km', cx + 3, cy - R * i / 4 - 2, color('txt-3'), 9);
    }
    // radiales N/E/S/W
    ['N', 'E', 'S', 'W'].forEach(function (d, j) {
      var a = j * Math.PI / 2;
      ctx.globalAlpha = .5; ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R); ctx.stroke(); ctx.globalAlpha = 1;
      txt(ctx, d, cx + Math.sin(a) * (R + 12), cy - Math.cos(a) * (R + 12) + 3.5, color('txt-3'), 10, 'center');
    });

    var marcadosId = {};
    (marcados || []).forEach(function (m) { if (m && m.sitio) marcadosId[m.sitio.id] = m.tipo; });

    vecinos.forEach(function (v) {
      if (v.distKm > rMax) return;
      var a = v.az * RAD, rr = v.distKm / rMax * R;
      var x = cx + Math.sin(a) * rr, y = cy - Math.cos(a) * rr;
      var tipo = marcadosId[v.sitio.id];
      var col = tipo === 'fo' ? color('fo') : tipo === 'mw' ? color('mw') : color('txt-3');
      if (tipo) { linea(ctx, { x: cx, y: cy }, { x: x, y: y }, col, 1.5, tipo === 'fo' ? [5, 4] : null); }
      ctx.beginPath(); ctx.arc(x, y, tipo ? 4.5 : 2.6, 0, 6.2832); ctx.fillStyle = col; ctx.fill();
      if (tipo) txt(ctx, v.sitio.id, x + 7, y + 3.5, color('txt'), 10, 'left', 600);
    });

    ctx.beginPath(); ctx.arc(cx, cy, 5, 0, 6.2832); ctx.fillStyle = color('acento'); ctx.fill();
    ctx.strokeStyle = color('bg'); ctx.lineWidth = 1.5; ctx.stroke();
    txt(ctx, centro.nombre.length > 20 ? centro.nombre.slice(0, 19) + '…' : centro.nombre,
        cx, cy + 19, color('txt-2'), 10, 'center', 500);
  }

  global.Chart = { Mapa: Mapa, perfil: perfil, radar: radar, color: color, preparar: preparar };
})(window);
