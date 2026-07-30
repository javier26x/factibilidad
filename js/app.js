/* app.js - interfaz de la herramienta de factibilidad FO / MMOO. */
(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var inv, mapa, resultados = [], orden = { k: 'i', dir: 1 }, seleccion = null;
  var CLAVE_LS = 'factibilidad.v1';

  /* ---------------- helpers DOM ---------------- */
  function el(tag, attrs, hijos) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'text') n.textContent = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (attrs[k] != null && attrs[k] !== false) n.setAttribute(k, attrs[k]);
    });
    (hijos || []).forEach(function (h) { if (h) n.appendChild(typeof h === 'string' ? document.createTextNode(h) : h); });
    return n;
  }
  function num(v, dec) {
    if (v == null || !isFinite(v)) return '–';
    return v.toLocaleString('es-CL', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec == null ? 0 : dec });
  }
  function moneda(v) { return v > 0 ? '$ ' + num(Math.round(v)) : '–'; }
  function clasVeredicto(cat) {
    return 'v-' + cat.toLowerCase().replace(/\s+/g, '');
  }

  /* ---------------- especificación de parámetros ---------------- */
  var PARAMS = [
    // ---- red base
    { id: 'soloEnServicio', g: 'Red', tipo: 'check', et: 'Solo sitios EN SERVICIO / EN O&M', def: true },
    { id: 'excluirIndoor', g: 'Red', tipo: 'check', et: 'Excluir sitios INDOOR (sin torre propia)', def: true },
    { id: 'radioKm', g: 'Red', tipo: 'num', et: 'Radio de búsqueda', u: 'km', def: 35, min: 1, max: 120, paso: 1 },
    { id: 'alturaMinPar', g: 'Red', tipo: 'num', et: 'Altura mínima del sitio par', u: 'm', def: 0, min: 0, max: 120, paso: 1 },
    { id: 'tecFO', g: 'Red', tipo: 'select', et: 'Tecnología exigida al nodo FO', def: '4G',
      op: [['', 'cualquiera'], ['4G', '4G (implica transporte)'], ['5G', '5G'], ['3G', '3G']],
      ayuda: 'Un sitio con 4G/5G casi siempre tiene fibra o transporte de alta capacidad.' },
    { id: 'tecMW', g: 'Red', tipo: 'select', et: 'Tecnología exigida al sitio par MMOO', def: '',
      op: [['', 'cualquiera'], ['4G', '4G'], ['5G', '5G'], ['3G', '3G']] },
    // ---- fibra óptica
    { id: 'foFactorU', g: 'FO', tipo: 'num', et: 'Factor de ruta urbano', def: 1.45, min: 1, max: 3, paso: 0.05 },
    { id: 'foFactorR', g: 'FO', tipo: 'num', et: 'Factor de ruta rural', def: 1.25, min: 1, max: 3, paso: 0.05 },
    { id: 'foU1', g: 'FO', tipo: 'num', et: 'Umbral ALTA', u: 'km ruta', def: 0.8, min: 0.1, paso: 0.1 },
    { id: 'foU2', g: 'FO', tipo: 'num', et: 'Umbral ALTA (2º tramo)', u: 'km ruta', def: 2.5, min: 0.2, paso: 0.1 },
    { id: 'foU3', g: 'FO', tipo: 'num', et: 'Umbral MEDIA', u: 'km ruta', def: 6, min: 0.5, paso: 0.5 },
    { id: 'foU4', g: 'FO', tipo: 'num', et: 'Umbral BAJA', u: 'km ruta', def: 15, min: 1, paso: 1 },
    { id: 'foVano', g: 'FO', tipo: 'num', et: 'Vano entre postes', u: 'm', def: 45, min: 20, max: 120, paso: 5 },
    { id: 'foCostoAereo', g: 'FO', tipo: 'num', et: 'Costo tendido aéreo', u: '$/km', def: 6000000, min: 0, paso: 100000, ancho: true,
      ayuda: 'Valor unitario propio: la herramienta solo multiplica por los km de ruta.' },
    { id: 'foCostoCanal', g: 'FO', tipo: 'num', et: 'Costo canalizado', u: '$/km', def: 25000000, min: 0, paso: 1000000, ancho: true },
    // ---- microondas
    { id: 'mwAltura', g: 'MW', tipo: 'num', et: 'Altura de torre asumida en el punto nuevo', u: 'm', def: 24, min: 3, max: 120, paso: 1, ancho: true,
      ayuda: 'Se usa cuando la línea no trae h=… Los sitios de la red usan su altura del inventario.' },
    { id: 'mwBanda', g: 'MW', tipo: 'select', et: 'Banda', def: '',
      op: [['', 'elegir automáticamente']].concat(Radio.BANDAS.map(function (b) { return [String(b.f), b.et]; })) },
    { id: 'mwDisp', g: 'MW', tipo: 'num', et: 'Disponibilidad objetivo', u: '%', def: 99.99, min: 99, max: 99.9999, paso: 0.001 },
    { id: 'mwK', g: 'MW', tipo: 'num', et: 'Factor k de refracción', def: 1.33, min: 0.5, max: 2, paso: 0.01 },
    { id: 'mwFresnel', g: 'MW', tipo: 'num', et: 'Fracción de F1 exigida', def: 0.6, min: 0, max: 1.2, paso: 0.05 },
    { id: 'mwObst', g: 'MW', tipo: 'num', et: 'Obstáculo en la trayectoria', u: 'm', def: 0, min: 0, max: 500, paso: 1,
      ayuda: 'Altura del obstáculo sobre el terreno, si se conoce (cerro, edificio).' },
    { id: 'mwR001auto', g: 'MW', tipo: 'check', et: 'R0.01 de lluvia automático según región', def: true },
    { id: 'mwR001', g: 'MW', tipo: 'num', et: 'R0.01 manual', u: 'mm/h', def: 30, min: 1, max: 120, paso: 1 },
    { id: 'mwPol', g: 'MW', tipo: 'select', et: 'Polarización', def: 'V', op: [['V', 'vertical'], ['H', 'horizontal']] },
    { id: 'mwDiam', g: 'MW', tipo: 'num', et: 'Diámetro de antena', u: 'm', def: 0, min: 0, max: 4, paso: 0.1,
      ayuda: '0 = diámetro típico de cada banda (1,8 m en 7-8 GHz … 0,3 m en 23-38 GHz).' },
    { id: 'mwPtx', g: 'MW', tipo: 'num', et: 'Potencia Tx', u: 'dBm', def: 20, min: -10, max: 40, paso: 1 },
    { id: 'mwPerdidas', g: 'MW', tipo: 'num', et: 'Pérdidas de rama', u: 'dB', def: 2, min: 0, max: 20, paso: 0.5 },
    { id: 'mwUmbral', g: 'MW', tipo: 'num', et: 'Umbral Rx (0 = típico)', u: 'dBm', def: 0, min: -95, max: 0, paso: 1 },
    { id: 'mwDN1', g: 'MW', tipo: 'num', et: 'Gradiente dN1', u: 'P.530', def: -300, min: -800, max: 0, paso: 10 },
    { id: 'mwPares', g: 'MW', tipo: 'num', et: 'Sitios par a evaluar', def: 12, min: 1, max: 40, paso: 1 }
  ];

  function pintarParams() {
    var cont = { Red: $('#paramsRed'), FO: $('#paramsFO'), MW: $('#paramsMW') };
    PARAMS.forEach(function (p) {
      var caja = el('div', { class: 'p' + (p.tipo === 'check' ? ' check' : '') + (p.ancho ? ' ancho' : '') });
      var campo;
      if (p.tipo === 'check') {
        campo = el('input', { type: 'checkbox', id: 'p_' + p.id });
        campo.checked = p.def;
        caja.appendChild(el('label', { for: 'p_' + p.id }, [campo, p.et]));
      } else {
        var lab = el('label', { for: 'p_' + p.id }, [p.et]);
        if (p.u) lab.appendChild(el('span', { class: 'u', text: '(' + p.u + ')' }));
        caja.appendChild(lab);
        if (p.tipo === 'select') {
          campo = el('select', { id: 'p_' + p.id });
          p.op.forEach(function (o) { campo.appendChild(el('option', { value: o[0], text: o[1] })); });
          campo.value = p.def;
        } else {
          campo = el('input', { type: 'number', id: 'p_' + p.id, step: p.paso || 1, min: p.min, max: p.max });
          campo.value = p.def;
        }
        caja.appendChild(campo);
      }
      if (p.ayuda) caja.appendChild(el('div', { class: 'ayuda', text: p.ayuda }));
      cont[p.g].appendChild(caja);
    });
  }

  function cfg() {
    var c = {};
    PARAMS.forEach(function (p) {
      var n = document.getElementById('p_' + p.id);
      if (!n) { c[p.id] = p.def; return; }
      if (p.tipo === 'check') c[p.id] = n.checked;
      else if (p.tipo === 'select') c[p.id] = n.value;
      else {
        var v = parseFloat(String(n.value).replace(',', '.'));
        c[p.id] = isFinite(v) ? v : p.def;
      }
    });
    return c;
  }

  function guardar() {
    try {
      localStorage.setItem(CLAVE_LS, JSON.stringify({ params: cfg(), entrada: $('#entrada').value, tema: document.documentElement.getAttribute('data-tema') }));
    } catch (e) { /* modo privado: seguir sin persistencia */ }
  }
  function restaurar() {
    var d;
    try { d = JSON.parse(localStorage.getItem(CLAVE_LS) || 'null'); } catch (e) { d = null; }
    if (!d) return;
    if (d.tema) document.documentElement.setAttribute('data-tema', d.tema);
    if (d.entrada) $('#entrada').value = d.entrada;
    if (d.params) Object.keys(d.params).forEach(function (k) {
      var n = document.getElementById('p_' + k);
      if (!n) return;
      if (n.type === 'checkbox') n.checked = !!d.params[k]; else n.value = d.params[k];
    });
  }
  function resetParams() {
    PARAMS.forEach(function (p) {
      var n = document.getElementById('p_' + p.id);
      if (!n) return;
      if (p.tipo === 'check') n.checked = p.def; else n.value = p.def;
    });
    guardar();
  }

  /* ---------------- evaluación ---------------- */
  function filtroBase(c, tec) {
    return Inv.construirFiltro({
      soloEnServicio: c.soloEnServicio,
      excluirIndoor: c.excluirIndoor,
      alturaMin: c.alturaMinPar,
      tecRequerida: tec ? [tec] : null
    });
  }

  function evaluar() {
    var c = cfg();
    var res = Parse.parseEntrada($('#entrada').value, inv);
    pintarErrores(res.errores);
    resultados = res.entradas.map(function (e, i) { return evaluarEntrada(e, i, c); });
    orden = { k: 'i', dir: 1 };
    pintarKpis(); pintarTabla(); pintarMapa();
    $('#cardVacio').hidden = resultados.length > 0;
    seleccion = null;
    $('#detalle').innerHTML = '';
    if (resultados.length) mostrarDetalle(resultados[0]);
    guardar();
  }

  function evaluarEntrada(e, i, c) {
    var it = {
      i: i + 1, tipo: e.tipo, nombre: e.nombre, lat: e.lat, lon: e.lon,
      formato: e.formato, crudo: e.crudo, deRed: e.deRed, sitio: e.sitio,
      altura: e.altura || (e.sitio && e.sitio.altura) || c.mwAltura,
      avisos: []
    };
    if (e.tipo === 'enlace') {
      it.lat = e.a.lat; it.lon = e.a.lon;
      it.altura = e.a.altura || c.mwAltura;
      it.deRed = e.a.deRed; it.sitio = e.a.sitio;
      it.b = { nombre: e.b.nombre || 'B', lat: e.b.lat, lon: e.b.lon, altura: e.b.altura || c.mwAltura, sitio: e.b.sitio, deRed: e.b.deRed };
    }

    // contexto administrativo: se toma del sitio de la red más cercano
    var ctx = inv.cercanos(it.lat, it.lon, 60, null, 1)[0];
    it.ctx = ctx ? ctx.sitio : null;
    it.region = it.sitio ? it.sitio.region : (it.ctx ? it.ctx.region : '');
    it.comuna = it.sitio ? it.sitio.comuna : (it.ctx ? it.ctx.comuna : '');
    it.entorno = it.sitio ? it.sitio.entorno : (it.ctx ? it.ctx.entorno : 'U');
    it.R001 = c.mwR001auto ? Radio.r001DeRegion(it.region) : c.mwR001;
    if (!ctx) it.avisos.push({ t: 'ojo', m: 'No hay sitios de la red en 60 km: punto muy aislado, contexto de comuna/región no disponible.' });
    else if (ctx.distKm > 25) it.avisos.push({ t: 'ojo', m: 'El sitio de red más cercano está a ' + num(ctx.distKm, 1) + ' km.' });

    it.vecinos = inv.cercanos(it.lat, it.lon, Math.min(c.radioKm, 25), null, 30);

    it.fo = analizarFO(it, c);
    it.mw = analizarMW(it, c);
    it.reco = recomendar(it);
    it.__row = fila(it);
    return it;
  }

  function excluirPropio(it) {
    var idPropio = it.sitio ? it.sitio.id : null;
    return function (s) { return !idPropio || s.id !== idPropio; };
  }

  /* Un tendido largo sale de la trama urbana y sigue caminos: se comporta como
     rural aunque el punto de partida esté en ciudad. */
  function entornoRuta(it, distKm) {
    return distKm > 10 ? 'R' : it.entorno;
  }

  function analizarFO(it, c) {
    var fFO = filtroBase(c, c.tecFO), propio = excluirPropio(it);
    var umbrales = { alta: c.foU1, mediaAlta: c.foU2, media: c.foU3, baja: c.foU4 };

    if (it.tipo === 'enlace') {
      // el enlace ya define la ruta: A -> B
      var d = Geo.haversine(it.lat, it.lon, it.b.lat, it.b.lon);
      var calc = Radio.evalFO({
        distKm: d, entorno: entornoRuta(it, d), factorUrbano: c.foFactorU, factorRural: c.foFactorR,
        costoAereo: c.foCostoAereo, costoCanalizado: c.foCostoCanal, vanoPostes: c.foVano
      });
      return {
        sitio: it.b.sitio || { id: 'B', nombre: it.b.nombre, lat: it.b.lat, lon: it.b.lon },
        distKm: d, az: Geo.azimut(it.lat, it.lon, it.b.lat, it.b.lon),
        calc: calc, cat: Radio.categoriaFO(calc.rutaKm, umbrales), alternativas: [], propio: true
      };
    }

    var cerca = inv.cercanos(it.lat, it.lon, c.radioKm, function (s) { return fFO(s) && propio(s); }, 4);
    if (!cerca.length) {
      return { sitio: null, distKm: null, calc: null,
        cat: { cat: 'NO VIABLE', score: 0, txt: 'sin nodo con ' + (c.tecFO || 'cobertura') + ' en ' + c.radioKm + ' km' },
        alternativas: [] };
    }
    var alternativas = cerca.map(function (v) {
      return {
        v: v, calc: Radio.evalFO({
          distKm: v.distKm, entorno: v.distKm > 10 ? 'R' : v.sitio.entorno,
          factorUrbano: c.foFactorU, factorRural: c.foFactorR,
          costoAereo: c.foCostoAereo, costoCanalizado: c.foCostoCanal, vanoPostes: c.foVano
        })
      };
    });
    alternativas.forEach(function (a) { a.cat = Radio.categoriaFO(a.calc.rutaKm, umbrales); });
    var mejor = alternativas[0];
    return {
      sitio: mejor.v.sitio, distKm: mejor.v.distKm, az: mejor.v.az,
      calc: mejor.calc, cat: mejor.cat, alternativas: alternativas
    };
  }

  function opcionesMW(it, c, hA, hB, dKm) {
    var base = {
      dKm: dKm, hA: hA, hB: hB, k: c.mwK, fracFresnel: c.mwFresnel, obstaculoM: c.mwObst,
      R001: it.R001, pol: c.mwPol, diamA: c.mwDiam || null, diamB: c.mwDiam || null, ptx: c.mwPtx,
      perdidas: c.mwPerdidas, umbral: c.mwUmbral < 0 ? c.mwUmbral : null,
      dN1: c.mwDN1, dispObjetivo: c.mwDisp
    };
    if (c.mwBanda) {
      var ev = Radio.evalMMOO(Object.assign({}, base, { banda: parseFloat(c.mwBanda) }));
      var b = Radio.BANDAS.filter(function (x) { return x.f === parseFloat(c.mwBanda); })[0];
      ev.et = b ? b.et : c.mwBanda + ' GHz';
      ev.dentroRango = b ? dKm <= b.maxKm : true;
      ev.nota = b ? b.nota : '';
      return { opciones: [ev], elegida: ev };
    }
    return Radio.mejorBanda(base);
  }

  function analizarMW(it, c) {
    var hA = it.altura;
    if (it.tipo === 'enlace') {
      var d = Geo.haversine(it.lat, it.lon, it.b.lat, it.b.lon);
      var mb = opcionesMW(it, c, hA, it.b.altura, d);
      return {
        sitio: it.b.sitio || { id: 'B', nombre: it.b.nombre, lat: it.b.lat, lon: it.b.lon, altura: it.b.altura },
        distKm: d, az: Geo.azimut(it.lat, it.lon, it.b.lat, it.b.lon),
        hA: hA, hB: it.b.altura, mb: mb, ev: mb.elegida,
        cat: Radio.categoriaMMOO(mb.elegida), pares: [], propio: true
      };
    }

    var fMW = filtroBase(c, c.tecMW), propio = excluirPropio(it);
    var cerca = inv.cercanos(it.lat, it.lon, c.radioKm, function (s) { return fMW(s) && propio(s); }, c.mwPares);
    if (!cerca.length) {
      return { sitio: null, distKm: null, ev: null, mb: { opciones: [] }, pares: [],
        cat: { cat: 'NO VIABLE', score: 0, txt: 'sin sitio par en ' + c.radioKm + ' km' } };
    }
    var pares = cerca.map(function (v) {
      var hB = v.sitio.altura || c.mwAltura;
      var mb = opcionesMW(it, c, hA, hB, v.distKm);
      return { v: v, hB: hB, mb: mb, ev: mb.elegida, cat: Radio.categoriaMMOO(mb.elegida) };
    });
    // mejor par: mayor puntaje y, a igual puntaje, el más cercano
    pares.sort(function (a, b) { return (b.cat.score - a.cat.score) || (a.v.distKm - b.v.distKm); });
    var m = pares[0];
    return {
      sitio: m.v.sitio, distKm: m.v.distKm, az: m.v.az, hA: hA, hB: m.hB,
      mb: m.mb, ev: m.ev, cat: m.cat, pares: pares
    };
  }

  function recomendar(it) {
    var f = it.fo.cat, m = it.mw.cat;
    if (f.score < 30 && m.score < 30) {
      return { cual: 'NINGUNA', txt: 'Sin solución directa: evaluar nodo intermedio o repetidor.' };
    }
    if (Math.abs(f.score - m.score) <= 12) {
      return { cual: 'AMBAS', txt: 'Ambas viables: decidir por costo y plazo (FO ' + f.cat + ' / MMOO ' + m.cat + ').' };
    }
    if (f.score > m.score) return { cual: 'FO', txt: 'Priorizar FO (' + f.cat + '): ' + f.txt + '.' };
    return { cual: 'MMOO', txt: 'Priorizar MMOO (' + m.cat + '): ' + (it.mw.ev ? it.mw.ev.et : '') + ', ' + m.txt + '.' };
  }

  /* Categoría con la que se colorea el veredicto global del punto. */
  function catDominante(it) {
    if (it.reco.cual === 'FO') return it.fo.cat.cat;
    if (it.reco.cual === 'MMOO') return it.mw.cat.cat;
    return it.fo.cat.score >= it.mw.cat.score ? it.fo.cat.cat : it.mw.cat.cat;
  }

  function fila(it) {
    return {
      i: it.i, nombre: it.nombre, comuna: (it.comuna || '') + (it.region ? ' / ' + it.region : ''),
      foKm: it.fo.calc ? it.fo.calc.rutaKm : Infinity,
      foNodo: it.fo.sitio ? it.fo.sitio.id : '',
      foCat: it.fo.cat.cat, foScore: it.fo.cat.score,
      mwKm: it.mw.distKm == null ? Infinity : it.mw.distKm,
      mwPar: it.mw.sitio ? it.mw.sitio.id : '',
      mwBanda: it.mw.ev ? it.mw.ev.et : '',
      mwDisp: it.mw.ev ? it.mw.ev.disponibilidad : -1,
      mwCat: it.mw.cat.cat, mwScore: it.mw.cat.score,
      reco: it.reco.txt
    };
  }

  /* ---------------- render ---------------- */
  function pintarErrores(errs) {
    var c = $('#errores');
    c.innerHTML = '';
    c.hidden = !errs.length;
    if (!errs.length) return;
    c.appendChild(el('div', {}, [el('b', { text: errs.length + (errs.length === 1 ? ' línea no se pudo leer' : ' líneas no se pudieron leer') })]));
    var ul = el('ul');
    errs.slice(0, 8).forEach(function (e) {
      ul.appendChild(el('li', { text: 'línea ' + e.linea + ': ' + e.texto.slice(0, 60) + ' — ' + e.motivo }));
    });
    c.appendChild(ul);
    if (errs.length > 8) c.appendChild(el('div', { class: 'hint', text: '… y ' + (errs.length - 8) + ' más' }));
  }

  function pintarKpis() {
    var k = $('#kpis');
    k.innerHTML = '';
    k.hidden = !resultados.length;
    if (!resultados.length) return;
    var cuenta = function (campo, cat) {
      return resultados.filter(function (r) { return r[campo].cat.cat === cat; }).length;
    };
    var reco = function (cual) {
      return resultados.filter(function (r) { return r.reco.cual === cual; }).length;
    };
    var datos = [
      { v: resultados.length, l: 'puntos evaluados', c: '' },
      { v: cuenta('fo', 'ALTA'), l: 'FO factibilidad alta', c: 'a' },
      { v: cuenta('mw', 'ALTA'), l: 'MMOO factibilidad alta', c: 'a' },
      { v: reco('FO'), l: 'priorizar FO', c: '' },
      { v: reco('MMOO'), l: 'priorizar MMOO', c: '' },
      { v: reco('AMBAS'), l: 'ambas viables', c: 'a' },
      { v: reco('NINGUNA'), l: 'sin solución directa', c: 'x' }
    ];
    datos.forEach(function (d) {
      k.appendChild(el('div', { class: 'kpi ' + d.c }, [
        el('div', { class: 'v', text: String(d.v) }), el('div', { class: 'l', text: d.l })
      ]));
    });
  }

  function pintarTabla() {
    var tb = $('#tbody');
    tb.innerHTML = '';
    $('#cardTabla').hidden = !resultados.length;
    if (!resultados.length) return;

    var arr = resultados.slice().sort(function (a, b) {
      var x = a.__row[orden.k], y = b.__row[orden.k];
      if (typeof x === 'string') return orden.dir * x.localeCompare(y, 'es');
      return orden.dir * ((x === y) ? 0 : (x < y ? -1 : 1));
    });

    arr.forEach(function (it) {
      var r = it.__row;
      var tr = el('tr', { class: seleccion === it ? 'sel' : '' });
      tr.appendChild(el('td', { class: 'c n', text: String(r.i) }));
      tr.appendChild(el('td', {}, [
        el('span', { text: r.nombre }),
        el('span', { class: 'sub2', text: Geo.fmtCoord(it.lat, it.lon, 5) + (it.tipo === 'enlace' ? '  → ' + it.b.nombre : '') })
      ]));
      tr.appendChild(el('td', { text: r.comuna }));
      tr.appendChild(el('td', { class: 'n', text: it.fo.calc ? num(it.fo.calc.rutaKm, 2) : '–' }));
      tr.appendChild(el('td', { class: 'cod' }, [
        el('span', { text: r.foNodo || '–' }),
        it.fo.sitio ? el('span', { class: 'sub2', text: (it.fo.sitio.nombre || '').slice(0, 24) }) : null
      ]));
      tr.appendChild(el('td', { class: 'c' }, [el('span', { class: clasVeredicto(r.foCat), text: r.foCat })]));
      tr.appendChild(el('td', { class: 'n', text: it.mw.distKm == null ? '–' : num(it.mw.distKm, 2) }));
      tr.appendChild(el('td', { class: 'cod' }, [
        el('span', { text: r.mwPar || '–' }),
        it.mw.sitio ? el('span', { class: 'sub2', text: (it.mw.sitio.nombre || '').slice(0, 24) }) : null
      ]));
      tr.appendChild(el('td', { class: 'c', text: r.mwBanda || '–' }));
      tr.appendChild(el('td', { class: 'n', text: it.mw.ev ? fmtDisp(it.mw.ev) : '–' }));
      tr.appendChild(el('td', { class: 'c' }, [el('span', { class: clasVeredicto(r.mwCat), text: r.mwCat })]));
      tr.appendChild(el('td', { text: r.reco }));
      tr.addEventListener('click', function () { mostrarDetalle(it); });
      tb.appendChild(tr);
    });

    document.querySelectorAll('#tabla thead th').forEach(function (th) {
      th.classList.remove('asc', 'desc');
      if (th.dataset.k === orden.k) th.classList.add(orden.dir > 0 ? 'asc' : 'desc');
    });
  }

  /* El modelo de lluvia P.530 se acota al 0,0001% del tiempo; por debajo de eso
     no hay resolucion, asi que no se muestra "100%" sino el techo del modelo. */
  function fmtDisp(ev) {
    if (ev.indisp <= 1e-4) return '≥99,9999';
    return ev.disponibilidad.toFixed(4).replace('.', ',');
  }
  function fmtMinutos(ev) {
    if (ev.indisp <= 1e-4) return '< 0,6 min/año';
    return num(ev.minutosAnio, 1) + ' min/año';
  }

  function pintarMapa() {
    $('#cardMapa').hidden = !resultados.length;
    if (!resultados.length) return;
    mapa.datos(inv.sitios, resultados);
    mapa.encuadrar();
  }

  /* ---------------- detalle ---------------- */
  function kv(pares) {
    var d = el('dl', { class: 'kv' });
    pares.forEach(function (p) {
      if (!p) return;
      d.appendChild(el('dt', { text: p[0] }));
      d.appendChild(el('dd', { class: p[2] || '', text: p[1] }));
    });
    return d;
  }

  function mostrarDetalle(it) {
    seleccion = it;
    pintarTabla();
    var cont = $('#detalle');
    cont.innerHTML = '';

    var card = el('section', { class: 'card det' });
    // cabecera
    var head = el('div', { class: 'det-head' }, [
      el('div', {}, [
        el('h2', { text: it.nombre }),
        el('div', { class: 'coords', text: Geo.fmtCoord(it.lat, it.lon) + '   ·   ' + Geo.aDMS(it.lat, true) + ' ' + Geo.aDMS(it.lon, false) +
          '   ·   ' + (it.comuna || 's/comuna') + (it.region ? ' (' + it.region + ')' : '') + '   ·   ' + (it.formato || '') })
      ]),
      el('span', { class: clasVeredicto(catDominante(it)), text: 'recomendado: ' + it.reco.cual }),
      el('button', { class: 'ghost sm cerrar', text: 'Cerrar' })
    ]);
    head.querySelector('.cerrar').addEventListener('click', function () { cont.innerHTML = ''; seleccion = null; pintarTabla(); });
    card.appendChild(head);

    var cols = el('div', { class: 'det-cols' });
    cols.appendChild(bloqueFO(it));
    cols.appendChild(bloqueMW(it));
    card.appendChild(cols);

    // perfil del enlace MMOO
    if (it.mw.ev) {
      var bp = el('div', { class: 'bloque' }, [
        el('h3', {}, [document.createTextNode('Perfil de la trayectoria MMOO'),
          el('span', { class: 'der badge', text: it.mw.ev.et + ' · ' + num(it.mw.distKm, 2) + ' km' })])
      ]);
      var cvP = el('canvas', { height: 210 });
      bp.appendChild(cvP);
      bp.appendChild(el('p', { class: 'hint', text: 'Terreno mostrado como plano: la curva es el bulbo terrestre con k=' +
        cfg().mwK + '. La línea punteada es la envolvente de ' + cfg().mwFresnel + '·F1; si entra en el terreno, falta despeje. ' +
        'No incluye topografía real: verificar con perfil DEM.' }));
      card.appendChild(bp);
      setTimeout(function () {
        Chart.perfil(cvP, {
          dKm: it.mw.distKm, hA: it.mw.hA, hB: it.mw.hB, k: cfg().mwK,
          f: it.mw.ev.banda, fracFresnel: cfg().mwFresnel, obstaculoM: cfg().mwObst
        }, it.mw.ev);
      }, 0);
    }

    // tablas de bandas y pares
    var cols2 = el('div', { class: 'det-cols' });
    cols2.appendChild(tablaBandas(it));
    cols2.appendChild(it.tipo === 'enlace' ? bloqueRadar(it) : tablaPares(it));
    card.appendChild(cols2);

    if (it.tipo !== 'enlace') card.appendChild(bloqueRadar(it));

    // avisos
    var avisos = construirAvisos(it);
    if (avisos.length) {
      var box = el('div', { class: 'avisos' });
      avisos.forEach(function (a) { box.appendChild(el('div', { class: a.t, text: a.m })); });
      card.appendChild(box);
    }

    // acciones
    var acc = el('div', { class: 'acciones' });
    acc.appendChild(el('a', { href: 'https://www.google.com/maps/search/?api=1&query=' + it.lat + ',' + it.lon, target: '_blank', rel: 'noopener', text: 'Ver punto en Google Maps' }));
    acc.appendChild(el('a', { href: 'https://www.openstreetmap.org/?mlat=' + it.lat + '&mlon=' + it.lon + '#map=16/' + it.lat + '/' + it.lon, target: '_blank', rel: 'noopener', text: 'OpenStreetMap' }));
    if (it.mw.sitio) {
      acc.appendChild(el('a', {
        href: 'https://www.google.com/maps/dir/?api=1&origin=' + it.lat + ',' + it.lon +
              '&destination=' + it.mw.sitio.lat + ',' + it.mw.sitio.lon, target: '_blank', rel: 'noopener',
        text: 'Trayecto a ' + it.mw.sitio.id
      }));
    }
    var btnCop = el('button', { class: 'ghost sm', text: 'Copiar coordenadas' });
    btnCop.addEventListener('click', function () {
      var t = it.lat.toFixed(6) + ', ' + it.lon.toFixed(6);
      if (navigator.clipboard) navigator.clipboard.writeText(t);
      btnCop.textContent = 'Copiado ✓';
      setTimeout(function () { btnCop.textContent = 'Copiar coordenadas'; }, 1500);
    });
    acc.appendChild(btnCop);
    card.appendChild(acc);

    cont.appendChild(card);
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function bloqueFO(it) {
    var f = it.fo, c = cfg();
    var b = el('div', { class: 'bloque' }, [
      el('h3', {}, [el('span', { class: 'chip fo', text: 'FO' }), document.createTextNode('Fibra óptica'),
        el('span', { class: 'der' }, [el('span', { class: clasVeredicto(f.cat.cat), text: f.cat.cat })])])
    ]);
    if (!f.sitio) {
      b.appendChild(el('p', { class: 'hint', text: f.cat.txt }));
      return b;
    }
    b.appendChild(kv([
      [it.tipo === 'enlace' ? 'Extremo B' : 'Nodo de conexión', f.sitio.id + (f.sitio.nombre ? ' · ' + f.sitio.nombre : '')],
      ['Tecnologías del nodo', f.sitio.tec ? f.sitio.tec.join(' / ') : '–'],
      ['Distancia recta', num(f.distKm, 3) + ' km'],
      ['Azimut', num(f.az, 0) + '° (' + Geo.rumboCardinal(f.az) + ')'],
      ['Factor de ruta', '×' + num(f.calc.factor, 2) + (f.calc.rural ? ' (rural)' : ' (urbano)')],
      ['Ruta estimada', num(f.calc.rutaKm, 2) + ' km', 'bien'],
      ['Postes (vano ' + c.foVano + ' m)', num(f.calc.postes)],
      ['Costo aéreo estimado', moneda(f.calc.costoAereo)],
      ['Costo canalizado', moneda(f.calc.costoCanalizado)],
      ['Criterio', f.cat.txt]
    ]));
    if (f.alternativas && f.alternativas.length > 1) {
      var t = el('table', { class: 'mini' });
      t.appendChild(el('thead', {}, [el('tr', {}, [
        el('th', { text: 'Nodo alternativo' }), el('th', { class: 'n', text: 'recta' }),
        el('th', { class: 'n', text: 'ruta' }), el('th', { class: 'n', text: 'tec' }), el('th', { text: '' })
      ])]));
      var tb = el('tbody');
      f.alternativas.forEach(function (a, i) {
        tb.appendChild(el('tr', { class: i === 0 ? 'elegida' : '' }, [
          el('td', {}, [el('span', { class: 'cod', text: a.v.sitio.id }), el('span', { class: 'sub2', text: (a.v.sitio.nombre || '').slice(0, 22) })]),
          el('td', { class: 'n', text: num(a.v.distKm, 2) }),
          el('td', { class: 'n', text: num(a.calc.rutaKm, 2) }),
          el('td', { class: 'n', text: (a.v.sitio.tec || []).join('/') }),
          el('td', {}, [el('span', { class: clasVeredicto(a.cat.cat), text: a.cat.cat })])
        ]));
      });
      t.appendChild(tb);
      b.appendChild(el('div', { style: 'margin-top:10px' }, [t]));
    }
    return b;
  }

  function bloqueMW(it) {
    var m = it.mw;
    var b = el('div', { class: 'bloque' }, [
      el('h3', {}, [el('span', { class: 'chip mw', text: 'MMOO' }), document.createTextNode('Microondas'),
        el('span', { class: 'der' }, [el('span', { class: clasVeredicto(m.cat.cat), text: m.cat.cat })])])
    ]);
    if (!m.ev) {
      b.appendChild(el('p', { class: 'hint', text: m.cat.txt }));
      return b;
    }
    var ev = m.ev;
    b.appendChild(kv([
      [it.tipo === 'enlace' ? 'Extremo B' : 'Sitio par', m.sitio.id + (m.sitio.nombre ? ' · ' + m.sitio.nombre : '')],
      ['Distancia', num(m.distKm, 3) + ' km'],
      ['Azimut A→B / B→A', num(m.az, 1) + '° / ' + num((m.az + 180) % 360, 1) + '°'],
      ['Banda', ev.et + '  (' + ev.cap + ')'],
      ['Antenas A / B', num(ev.diamA, 2) + ' / ' + num(ev.diamB, 2) + ' m' + (cfg().mwDiam > 0 ? '' : ' (típico banda)')],
      ['Alturas A / B', num(m.hA, 0) + ' / ' + num(m.hB, 0) + ' m'],
      ['Bulbo terrestre (k=' + cfg().mwK + ')', num(ev.bulbo, 1) + ' m'],
      ['F1 en punto medio', num(ev.fresnel, 1) + ' m'],
      ['Despeje requerido', num(ev.despejeReq, 1) + ' m'],
      ['Holgura de despeje', (ev.holgura >= 0 ? '+' : '') + num(ev.holgura, 1) + ' m', ev.holgura >= 0 ? 'bien' : 'mal'],
      ['Altura mínima por lado', num(ev.alturaMinima, 1) + ' m',
        (ev.hFaltanteA > 0 || ev.hFaltanteB > 0) ? 'ojo' : 'bien'],
      (ev.hFaltanteA > 0 || ev.hFaltanteB > 0) ?
        ['Falta altura A / B', num(ev.hFaltanteA, 1) + ' / ' + num(ev.hFaltanteB, 1) + ' m', 'mal'] : null,
      ['Pérdida espacio libre', num(ev.fsl, 1) + ' dB'],
      ['Ganancia antenas', num(ev.gA, 1) + ' + ' + num(ev.gB, 1) + ' dBi'],
      ['Nivel Rx / umbral', num(ev.rsl, 1) + ' / ' + num(ev.umbral, 0) + ' dBm'],
      ['Margen de desvanecimiento', num(ev.margen, 1) + ' dB', ev.margen >= 25 ? 'bien' : ev.margen >= 15 ? 'ojo' : 'mal'],
      ['Lluvia R0.01 usada', num(it.R001, 0) + ' mm/h' + (cfg().mwR001auto ? ' (auto ' + (it.region || '?') + ')' : ' (manual)')],
      ['Atenuación lluvia 0,01%', num(ev.lluvia.A001, 1) + ' dB  (' + num(ev.lluvia.gamma, 2) + ' dB/km)'],
      ['Indisp. lluvia', ev.pLluvia.toFixed(5).replace('.', ',') + ' %'],
      ['Indisp. multitrayecto', ev.pMulti.toFixed(5).replace('.', ',') + ' %'],
      ['Disponibilidad estimada', fmtDisp(ev) + ' %', ev.cumpleDisp ? 'bien' : 'mal'],
      ['Indisponibilidad anual', fmtMinutos(ev)],
      ['Criterio', m.cat.txt]
    ]));
    return b;
  }

  function tablaBandas(it) {
    var b = el('div', { class: 'bloque' }, [el('h3', {}, [document.createTextNode('Bandas evaluadas'),
      el('span', { class: 'der badge', text: it.mw.distKm != null ? num(it.mw.distKm, 2) + ' km' : '' })])]);
    var ops = (it.mw.mb && it.mw.mb.opciones) || [];
    if (!ops.length) { b.appendChild(el('p', { class: 'hint', text: 'Sin banda aplicable a esta distancia.' })); return b; }
    var t = el('table', { class: 'mini' });
    t.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Banda' }), el('th', { class: 'n', text: 'margen' }), el('th', { class: 'n', text: 'holgura' }),
      el('th', { class: 'n', text: 'h mín' }), el('th', { class: 'n', text: 'disp. %' }), el('th', { text: 'nota' })
    ])]));
    var tb = el('tbody');
    ops.slice().reverse().forEach(function (o) {
      var clases = [];
      if (it.mw.ev && o.banda === it.mw.ev.banda) clases.push('elegida');
      if (!o.dentroRango || o.extrapolado) clases.push('fuera');
      tb.appendChild(el('tr', { class: clases.join(' ') }, [
        el('td', { text: o.et }),
        el('td', { class: 'n', text: num(o.margen, 1) }),
        el('td', { class: 'n', text: (o.holgura >= 0 ? '+' : '') + num(o.holgura, 1) }),
        el('td', { class: 'n', text: num(o.alturaMinima, 1) }),
        el('td', { class: 'n', text: fmtDisp(o) }),
        el('td', { text: o.extrapolado ? 'fuera de tabla P.838 (estimado)' : (!o.dentroRango ? 'sobre alcance típico' : o.nota) })
      ]));
    });
    t.appendChild(tb);
    b.appendChild(t);
    b.appendChild(el('p', { class: 'hint', text: 'Se elige la banda más alta que cumple despeje, disponibilidad objetivo y alcance típico.' }));
    return b;
  }

  function tablaPares(it) {
    var b = el('div', { class: 'bloque' }, [el('h3', {}, [document.createTextNode('Sitios par evaluados')])]);
    var pares = it.mw.pares || [];
    if (!pares.length) { b.appendChild(el('p', { class: 'hint', text: it.mw.cat.txt })); return b; }
    var t = el('table', { class: 'mini' });
    t.appendChild(el('thead', {}, [el('tr', {}, [
      el('th', { text: 'Sitio' }), el('th', { class: 'n', text: 'km' }), el('th', { class: 'n', text: 'az' }),
      el('th', { class: 'n', text: 'h' }), el('th', { text: 'banda' }), el('th', { class: 'n', text: 'disp. %' }), el('th', { text: '' })
    ])]));
    var tb = el('tbody');
    pares.slice(0, 10).forEach(function (p, i) {
      tb.appendChild(el('tr', { class: i === 0 ? 'elegida' : '' }, [
        el('td', {}, [el('span', { class: 'cod', text: p.v.sitio.id }), el('span', { class: 'sub2', text: (p.v.sitio.nombre || '').slice(0, 20) })]),
        el('td', { class: 'n', text: num(p.v.distKm, 2) }),
        el('td', { class: 'n', text: num(p.v.az, 0) + '°' }),
        el('td', { class: 'n', text: num(p.hB, 0) }),
        el('td', { text: p.ev ? p.ev.et : '–' }),
        el('td', { class: 'n', text: p.ev ? fmtDisp(p.ev) : '–' }),
        el('td', {}, [el('span', { class: clasVeredicto(p.cat.cat), text: p.cat.cat })])
      ]));
    });
    t.appendChild(tb);
    b.appendChild(t);
    return b;
  }

  function bloqueRadar(it) {
    var b = el('div', { class: 'bloque' }, [el('h3', {}, [document.createTextNode('Sitios de la red alrededor'),
      el('span', { class: 'der badge', text: it.vecinos.length + ' en ' + Math.min(cfg().radioKm, 25) + ' km' })])]);
    var cv = el('canvas', { height: 260 });
    b.appendChild(cv);
    setTimeout(function () {
      Chart.radar(cv, it, it.vecinos, [
        { sitio: it.fo.sitio, tipo: 'fo' }, { sitio: it.mw.sitio, tipo: 'mw' }
      ]);
    }, 0);
    b.appendChild(el('p', { class: 'hint', text: 'Azul discontinuo: nodo FO propuesto. Violeta: sitio par MMOO.' }));
    return b;
  }

  function construirAvisos(it) {
    var a = it.avisos.slice(), ev = it.mw.ev, c = cfg();
    if (ev) {
      if (ev.extrapolado) a.push({ t: 'ojo', m: 'La banda elegida está fuera del rango 1–40 GHz de la tabla ITU-R P.838-3: la atenuación por lluvia es una extrapolación, confirmar con datos del fabricante.' });
      if (!ev.cumpleDespeje) a.push({ t: 'mal', m: 'No hay línea de vista con las alturas actuales: se requieren ' + num(ev.alturaMinima, 1) + ' m por lado (terreno plano). Con topografía real puede ser más.' });
      if (ev.margen < 15) a.push({ t: 'mal', m: 'Margen de desvanecimiento de ' + num(ev.margen, 1) + ' dB: insuficiente. Subir diámetro de antena, bajar banda o acortar el salto.' });
      if (!ev.dentroRango) a.push({ t: 'ojo', m: 'La distancia supera el alcance típico de la banda elegida.' });
      if (c.mwObst > 0) a.push({ t: 'ojo', m: 'Se incluyó un obstáculo de ' + c.mwObst + ' m en el punto medio de la trayectoria.' });
      if (ev.pMulti > ev.pLluvia * 3 && ev.pMulti > 0.001) a.push({ t: 'ojo', m: 'Domina el desvanecimiento por multitrayecto: considerar diversidad de espacio o bajar el gradiente dN1 asumido.' });
    }
    if (it.fo.sitio && it.fo.calc && it.fo.calc.rutaKm > c.foU4) {
      a.push({ t: 'ojo', m: 'El nodo FO más cercano queda a ' + num(it.fo.calc.rutaKm, 1) + ' km de ruta: revisar si existe ruta de fibra troncal más cerca que un sitio radio.' });
    }
    if (it.deRed) a.push({ t: 'bien', m: 'El punto coincide con el sitio ' + it.sitio.id + ' del inventario: se usó su coordenada y altura (' + num(it.sitio.altura, 0) + ' m).' });
    a.push({ t: '', m: 'La estimación de FO usa los sitios de la red como proxy de nodo con transporte; no reemplaza el catastro de rutas de fibra. El despeje MMOO asume terreno plano, sin DEM.' });
    return a;
  }

  /* ---------------- exportar ---------------- */
  function csv() {
    var cols = ['#', 'Punto', 'Tipo', 'Lat', 'Lon', 'Comuna', 'Region', 'Entorno',
      'FO nodo', 'FO nodo nombre', 'FO recta km', 'FO ruta km', 'FO postes', 'FO costo aereo', 'FO veredicto', 'FO criterio',
      'MMOO par', 'MMOO par nombre', 'MMOO dist km', 'MMOO azimut', 'MMOO banda', 'MMOO hA m', 'MMOO hB m',
      'MMOO despeje req m', 'MMOO holgura m', 'MMOO h minima m', 'MMOO margen dB', 'MMOO disp %', 'MMOO min/anio',
      'MMOO veredicto', 'MMOO criterio', 'Recomendacion'];
    var filas = [cols];
    resultados.forEach(function (it) {
      var f = it.fo, m = it.mw, ev = m.ev;
      filas.push([
        it.i, it.nombre, it.tipo, it.lat.toFixed(6), it.lon.toFixed(6), it.comuna, it.region, it.entorno,
        f.sitio ? f.sitio.id : '', f.sitio ? f.sitio.nombre : '',
        f.distKm != null ? f.distKm.toFixed(3) : '', f.calc ? f.calc.rutaKm.toFixed(2) : '',
        f.calc ? f.calc.postes : '', f.calc ? Math.round(f.calc.costoAereo) : '',
        f.cat.cat, f.cat.txt,
        m.sitio ? m.sitio.id : '', m.sitio ? m.sitio.nombre : '',
        m.distKm != null ? m.distKm.toFixed(3) : '', m.az != null ? m.az.toFixed(1) : '',
        ev ? ev.et : '', ev ? m.hA : '', ev ? m.hB : '',
        ev ? ev.despejeReq.toFixed(1) : '', ev ? ev.holgura.toFixed(1) : '', ev ? ev.alturaMinima.toFixed(1) : '',
        ev ? ev.margen.toFixed(1) : '',
        // se acota al techo del modelo P.530 en vez de escribir 100
        ev ? Math.min(ev.disponibilidad, 99.9999).toFixed(5) : '',
        ev ? Math.max(ev.minutosAnio, 0.5).toFixed(1) : '',
        m.cat.cat, m.cat.txt, it.reco.txt
      ]);
    });
    var texto = filas.map(function (f) {
      return f.map(function (v) {
        var s = String(v == null ? '' : v);
        return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(';');
    }).join('\r\n');

    var blob = new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' });
    var a = el('a', { href: URL.createObjectURL(blob), download: 'factibilidad_enlaces.csv' });
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ---------------- buscador ---------------- */
  function buscador() {
    var inp = $('#qSitio'), caja = $('#qRes');
    var cerrar = function () { caja.hidden = true; };
    inp.addEventListener('input', function () {
      var q = inp.value.trim();
      caja.innerHTML = '';
      if (q.length < 2) { cerrar(); return; }
      var r = inv.buscarTexto(q, 25);
      caja.hidden = false;
      if (!r.length) { caja.appendChild(el('div', { class: 'q-vacio', text: 'Sin resultados en el inventario.' })); return; }
      r.forEach(function (s) {
        var it = el('div', { class: 'q-item' }, [
          el('span', { class: 'cod', text: s.id }),
          el('span', { class: 'nm', text: s.nombre + ' — ' + s.comuna }),
          el('span', { class: 'mt', text: (s.tec || []).join('/') + ' · ' + num(s.altura, 0) + ' m' })
        ]);
        it.addEventListener('click', function () {
          var t = $('#entrada');
          t.value = (t.value.replace(/\s*$/, '') + '\n' + s.id).replace(/^\n/, '');
          cerrar(); inp.value = ''; t.focus();
        });
        caja.appendChild(it);
      });
    });
    inp.addEventListener('keydown', function (e) { if (e.key === 'Escape') cerrar(); });
    document.addEventListener('click', function (e) {
      if (!caja.contains(e.target) && e.target !== inp) cerrar();
    });
  }

  var EJEMPLO = [
    '# Pega aquí tus sitios o enlaces. Ejemplos de los formatos aceptados:',
    'Cliente Data Center Norte; -33.3712; -70.6598; h=30',
    'Bodega Pudahuel  -33.4402  -70.7890',
    'Antena Cerro San Cristobal  33°25\'32"S 70°38\'05"W  h=40',
    'Punto UTM Maipu  19S 337500 6293000',
    '# un sitio de la red por código:',
    '13_184',
    '# un enlace explícito A -> B:',
    'Cliente Quilicura -33.3560,-70.7290 -> 13_184'
  ].join('\n');

  /* ---------------- arranque ---------------- */
  function iniciar() {
    if (!global_ok()) return;
    pintarParams();
    restaurar();
    inv = new Inv.Inventario(window.RED_INV, window.RED_META);

    var m = window.RED_META || {}, r = inv.resumen();
    $('#metaRed').textContent = num(r.total) + ' sitios · ' +
      Object.keys(r.tec).sort().map(function (t) { return t + ' ' + num(r.tec[t]); }).join(' · ') +
      ' · ' + num((m.celdas && Object.keys(m.celdas).reduce(function (a, k) { return a + m.celdas[k]; }, 0)) || 0) + ' celdas';
    $('#nSitios').textContent = num(r.total);
    $('#badgeRed').textContent = num(r.total) + ' sitios';

    mapa = new Chart.Mapa($('#mapa'));
    mapa.onClick = function (it) { mostrarDetalle(it); };

    $('#btnEvaluar').addEventListener('click', evaluar);
    $('#btnEjemplo').addEventListener('click', function () { $('#entrada').value = EJEMPLO; evaluar(); });
    $('#btnLimpiar').addEventListener('click', function () {
      $('#entrada').value = ''; resultados = []; seleccion = null;
      $('#detalle').innerHTML = ''; pintarKpis(); pintarTabla();
      $('#cardMapa').hidden = true; $('#cardVacio').hidden = false; pintarErrores([]); guardar();
    });
    $('#btnReset').addEventListener('click', resetParams);
    $('#btnCsv').addEventListener('click', csv);
    $('#btnMapaFit').addEventListener('click', function () { mapa.encuadrar(); });
    $('#btnTema').addEventListener('click', function () {
      var actual = document.documentElement.getAttribute('data-tema');
      document.documentElement.setAttribute('data-tema', actual === 'claro' ? 'oscuro' : 'claro');
      guardar();
      if (resultados.length) { mapa.dibujar(); if (seleccion) mostrarDetalle(seleccion); }
    });
    $('#entrada').addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); evaluar(); }
    });
    $('#archivo').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { $('#entrada').value = String(fr.result); evaluar(); };
      fr.readAsText(f, 'utf-8');
    });
    document.querySelectorAll('#tabla thead th').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.dataset.k;
        orden = { k: k, dir: (orden.k === k ? -orden.dir : 1) };
        pintarTabla();
      });
    });
    document.querySelectorAll('.params input, .params select').forEach(function (n) {
      n.addEventListener('change', function () {
        guardar();
        if (resultados.length) evaluar();
      });
    });
    var t;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(function () {
        if (resultados.length) { mapa.dibujar(); if (seleccion) mostrarDetalle(seleccion); }
      }, 160);
    });
    buscador();
  }

  function global_ok() {
    var falta = ['RED_INV', 'Geo', 'Radio', 'Inv', 'Parse', 'Chart'].filter(function (k) { return !window[k]; });
    if (!falta.length) return true;
    document.body.insertBefore(el('div', { class: 'errores', style: 'margin:20px' },
      [el('b', { text: 'No se pudo cargar: ' + falta.join(', ') + '. Verificar que data/sites.js y js/*.js estén junto al index.html.' })]),
      document.body.firstChild);
    return false;
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
  else iniciar();
})();
