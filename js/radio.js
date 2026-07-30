/* radio.js - ingenieria de enlaces: microondas (MMOO) y fibra optica (FO).
   Referencias usadas:
     - ITU-R P.530-17  (perdida por lluvia, desvanecimiento multitrayecto)
     - ITU-R P.838-3   (coeficientes k, alfa de atenuacion especifica por lluvia)
     - ITU-R P.526     (despeje de Fresnel)
   Los valores por defecto son de planificacion preliminar: sirven para priorizar
   candidatos, no reemplazan un estudio con perfil de terreno (DEM) ni un survey. */
(function (global) {
  'use strict';

  /* --- bandas MMOO tipicas de acceso/backhaul --------------------------- */
  /* diam = diametro tipico de antena para esa banda (m), usado cuando el usuario
     deja el diametro en automatico: comparar todas las bandas con una parabolica
     de 0.6 m falsearia la comparacion (0.6 m a 38 GHz da 45 dBi, poco realista). */
  var BANDAS = [
    { f: 7,  et: '7 GHz',  maxKm: 60, diam: 1.8, cap: '≤ 400 Mbps', nota: 'salto largo, antenas grandes' },
    { f: 8,  et: '8 GHz',  maxKm: 55, diam: 1.8, cap: '≤ 400 Mbps', nota: 'salto largo' },
    { f: 11, et: '11 GHz', maxKm: 40, diam: 1.2, cap: '≤ 800 Mbps', nota: 'salto medio-largo' },
    { f: 13, et: '13 GHz', maxKm: 30, diam: 0.9, cap: '≤ 1 Gbps',   nota: 'salto medio' },
    { f: 15, et: '15 GHz', maxKm: 25, diam: 0.6, cap: '≤ 1 Gbps',   nota: 'salto medio, banda muy usada' },
    { f: 18, et: '18 GHz', maxKm: 16, diam: 0.6, cap: '1-2 Gbps',   nota: 'urbano' },
    { f: 23, et: '23 GHz', maxKm: 11, diam: 0.3, cap: '1-2 Gbps',   nota: 'urbano denso' },
    { f: 26, et: '26 GHz', maxKm: 9,  diam: 0.3, cap: '1-2.5 Gbps', nota: 'urbano denso' },
    { f: 32, et: '32 GHz', maxKm: 7,  diam: 0.3, cap: '2-3 Gbps',   nota: 'salto corto' },
    { f: 38, et: '38 GHz', maxKm: 5,  diam: 0.3, cap: '2-3 Gbps',   nota: 'salto corto' }
  ];
  /* E-band se evalua aparte: queda fuera de la tabla P.838-3 (1-40 GHz). */
  var EBAND = { f: 80, et: 'E-band 80 GHz', maxKm: 3, diam: 0.3, cap: '1-10 Gbps' };

  function bandaDe(f) {
    for (var i = 0; i < BANDAS.length; i++) if (BANDAS[i].f === f) return BANDAS[i];
    return (f >= 70) ? EBAND : null;
  }
  /* Diametro tipico si el usuario no fija uno. */
  function diamPorBanda(f) {
    var b = bandaDe(f);
    return b ? b.diam : 0.6;
  }

  /* --- ITU-R P.838-3: k y alfa por frecuencia (GHz) --------------------- */
  var P838 = [
    [1,  0.0000259, 0.9691, 0.0000308, 0.8592],
    [2,  0.0000847, 1.0664, 0.0000998, 0.9490],
    [4,  0.0001071, 1.6009, 0.0002461, 1.2476],
    [6,  0.0007056, 1.5900, 0.0004878, 1.5728],
    [7,  0.0019150, 1.4810, 0.0014250, 1.4745],
    [8,  0.0041150, 1.3905, 0.0034500, 1.3797],
    [10, 0.0121700, 1.2571, 0.0112900, 1.2156],
    [12, 0.0238600, 1.1825, 0.0245500, 1.1216],
    [15, 0.0448100, 1.1233, 0.0500800, 1.0440],
    [20, 0.0916400, 1.0568, 0.0961100, 0.9847],
    [25, 0.1571000, 0.9991, 0.1533000, 0.9491],
    [30, 0.2403000, 0.9485, 0.2291000, 0.9129],
    [35, 0.3374000, 0.9047, 0.3224000, 0.8761],
    [40, 0.4431000, 0.8673, 0.4274000, 0.8421]
  ];

  /* k se interpola en log-log, alfa en log(f)-lineal (recomendacion P.838). */
  function coefLluvia(fGHz, pol) {
    var f = Math.min(40, Math.max(1, fGHz));
    var i = 0;
    while (i < P838.length - 2 && P838[i + 1][0] < f) i++;
    var a = P838[i], b = P838[i + 1];
    var t = (Math.log(f) - Math.log(a[0])) / (Math.log(b[0]) - Math.log(a[0]));
    var kA = (pol === 'V') ? a[3] : a[1], kB = (pol === 'V') ? b[3] : b[1];
    var aA = (pol === 'V') ? a[4] : a[2], aB = (pol === 'V') ? b[4] : b[2];
    return {
      k: Math.exp(Math.log(kA) + t * (Math.log(kB) - Math.log(kA))),
      alfa: aA + t * (aB - aA),
      extrapolado: fGHz > 40 || fGHz < 1
    };
  }

  /* Atenuacion por lluvia excedida el 0.01% del año (ITU-R P.530-17 §2.4.1) */
  function lluvia001(dKm, fGHz, R001, pol) {
    var c = coefLluvia(fGHz, pol);
    var gamma = c.k * Math.pow(Math.max(0.1, R001), c.alfa);   // dB/km
    var d0 = 35 * Math.exp(-0.015 * R001);
    var d = Math.max(0.1, dKm);
    var den = 0.477 * Math.pow(d, 0.633) * Math.pow(R001, 0.073 * c.alfa) *
              Math.pow(fGHz, 0.123) - 10.579 * (1 - Math.exp(-0.024 * d));
    var r = den > 0 ? 1 / den : 2.5;
    r = Math.min(2.5, Math.max(0.1, r));
    return { A001: gamma * d * r, gamma: gamma, deff: d * r, d0: d0, coef: c };
  }

  /* Escalado de la atenuacion por lluvia a otro porcentaje p (P.530-17) */
  function lluviaEnP(A001, fGHz, p) {
    var C0 = (fGHz >= 10) ? 0.12 + 0.4 * Math.log10(Math.pow(fGHz / 10, 0.8)) : 0.12;
    var C1 = Math.pow(0.07, C0) * Math.pow(0.12, 1 - C0);
    var C2 = 0.855 * C0 + 0.546 * (1 - C0);
    var C3 = 0.139 * C0 + 0.043 * (1 - C0);
    return A001 * C1 * Math.pow(p, -(C2 + C3 * Math.log10(p)));
  }

  /* Porcentaje de tiempo en que la lluvia supera el margen -> indisponibilidad.
     A(p) decrece cuando p crece, asi que el bracket va de p chico (evento
     intenso) a p grande (evento leve). El rango de validez de P.530 para el
     escalado es 0.001% - 1%; se acota a 0.0001% para no extrapolar de mas. */
  var P_MIN = 1e-4, P_MAX = 1;
  function indispLluvia(margenDB, A001, fGHz) {
    if (!(A001 > 0)) return 0;
    if (lluviaEnP(A001, fGHz, P_MIN) <= margenDB) return 0;   // ni el evento extremo supera el margen
    if (lluviaEnP(A001, fGHz, P_MAX) > margenDB) return P_MAX; // lo supera mas del 1% del tiempo
    var lo = P_MIN, hi = P_MAX;
    for (var i = 0; i < 60; i++) {
      var mid = Math.sqrt(lo * hi);
      if (lluviaEnP(A001, fGHz, mid) > margenDB) lo = mid; else hi = mid;
    }
    return hi;   // %
  }

  /* Desvanecimiento por multitrayecto, mes peor (P.530-17 §2.3.2) */
  function indispMultitrayecto(margenDB, dKm, fGHz, hA, hB, dN1) {
    var K = Math.pow(10, -4.6 - 0.0027 * dN1);
    var epsilon = Math.abs(hB - hA) / Math.max(0.001, dKm);          // mrad
    var hL = Math.min(hA, hB);
    var p = K * Math.pow(dKm, 3.0) * Math.pow(1 + Math.abs(epsilon), -1.2) *
            Math.pow(10, 0.033 * fGHz - 0.001 * hL - margenDB / 10);
    return Math.min(100, Math.max(0, p));   // %
  }

  /* --- geometria de la trayectoria ------------------------------------- */
  function bulboTierra(d1, d2, k) { return (d1 * d2) / (12.75 * (k || 1.33)); }        // m
  function fresnel1(d1, d2, fGHz) {
    var d = d1 + d2;
    return d <= 0 ? 0 : 17.32 * Math.sqrt((d1 * d2) / (fGHz * d));                     // m
  }
  /* Despeje necesario sobre el terreno en un punto de la trayectoria */
  function despejeReq(d1, d2, fGHz, k, fracFresnel) {
    return bulboTierra(d1, d2, k) + (fracFresnel == null ? 0.6 : fracFresnel) * fresnel1(d1, d2, fGHz);
  }
  /* Altura minima (igual en ambos extremos, terreno plano) para cumplir despeje */
  function alturaMinima(dKm, fGHz, k, fracFresnel, obstaculoM) {
    var mitad = dKm / 2;
    return despejeReq(mitad, mitad, fGHz, k, fracFresnel) + (obstaculoM || 0);
  }

  /* --- presupuesto de enlace ------------------------------------------- */
  function fsl(dKm, fGHz) { return 92.45 + 20 * Math.log10(fGHz) + 20 * Math.log10(Math.max(0.001, dKm)); }
  /* Ganancia de parabolica, eficiencia ~55% */
  function ganancia(diamM, fGHz) { return 17.8 + 20 * Math.log10(diamM) + 20 * Math.log10(fGHz); }

  /* Umbral de recepcion tipico por banda y capacidad (referencia editable) */
  function umbralRx(fGHz) { return -72 + (fGHz > 30 ? 2 : 0); }   // dBm @ ~1 Gbps, 56 MHz

  /* --- evaluacion MMOO de un salto ------------------------------------- */
  /*  o = { dKm, banda(f GHz), hA, hB, k, fracFresnel, obstaculoM, R001, pol,
            diamA, diamB, ptx, umbral, perdidas, dN1, dispObjetivo(%) }        */
  function evalMMOO(o) {
    var f = o.banda, d = o.dKm;
    var hA = o.hA || 0, hB = o.hB || 0;
    var k = o.k || 1.33, frac = (o.fracFresnel == null ? 0.6 : o.fracFresnel);

    // geometria
    var mitad = d / 2;
    var reqMitad = despejeReq(mitad, mitad, f, k, frac) + (o.obstaculoM || 0);
    var losMitad = (hA + hB) / 2;                       // altura de la visual sobre terreno plano
    var holgura = losMitad - reqMitad;                  // m; >=0 cumple criterio
    var hMin = alturaMinima(d, f, k, frac, o.obstaculoM);

    // presupuesto
    var dA = o.diamA || diamPorBanda(f), dB = o.diamB || diamPorBanda(f);
    var gA = ganancia(dA, f), gB = ganancia(dB, f);
    var perdidaLibre = fsl(d, f);
    var rsl = (o.ptx == null ? 20 : o.ptx) + gA + gB - perdidaLibre - (o.perdidas == null ? 2 : o.perdidas);
    var umbral = (o.umbral == null ? umbralRx(f) : o.umbral);
    var margen = rsl - umbral;

    // disponibilidad
    var R001 = (o.R001 == null ? 30 : o.R001);
    var ll = lluvia001(d, f, R001, o.pol || 'V');
    var pLluvia = indispLluvia(Math.max(0, margen), ll.A001, f);
    var pMulti = indispMultitrayecto(Math.max(0, margen), d, f, hA, hB, (o.dN1 == null ? -300 : o.dN1));
    var pTotal = Math.min(100, pLluvia + pMulti);
    var disp = 100 - pTotal;
    var objetivo = (o.dispObjetivo == null ? 99.99 : o.dispObjetivo);

    return {
      banda: f, dKm: d, cap: capacidadBanda(f), diamA: dA, diamB: dB,
      fsl: perdidaLibre, gA: gA, gB: gB, rsl: rsl, umbral: umbral, margen: margen,
      bulbo: bulboTierra(mitad, mitad, k), fresnel: fresnel1(mitad, mitad, f),
      despejeReq: reqMitad, holgura: holgura, alturaMinima: hMin,
      hFaltanteA: Math.max(0, hMin - hA), hFaltanteB: Math.max(0, hMin - hB),
      lluvia: ll, pLluvia: pLluvia, pMulti: pMulti, indisp: pTotal,
      disponibilidad: disp, minutosAnio: pTotal / 100 * 525600,
      objetivo: objetivo, cumpleDisp: disp >= objetivo, cumpleDespeje: holgura >= 0,
      extrapolado: ll.coef.extrapolado
    };
  }

  function capacidadBanda(f) {
    var b = bandaDe(f);
    return b ? b.cap : '-';
  }

  /* Elige la banda mas alta (mas espectro/capacidad, antena mas chica) que
     cumpla disponibilidad y despeje con las alturas disponibles. */
  function mejorBanda(o) {
    var res = [], i, r, cand = BANDAS.slice();
    if (o.dKm <= EBAND.maxKm) cand.push(EBAND);
    for (i = 0; i < cand.length; i++) {
      if (o.dKm > cand[i].maxKm * 1.25) continue;          // fuera de rango practico
      r = evalMMOO(Object.assign({}, o, { banda: cand[i].f }));
      r.et = cand[i].et; r.dentroRango = o.dKm <= cand[i].maxKm; r.nota = cand[i].nota || '';
      res.push(r);
    }
    if (!res.length) return { opciones: [], elegida: null };
    var ok = res.filter(function (x) { return x.cumpleDisp && x.cumpleDespeje && x.dentroRango && !x.extrapolado; });
    var elegida = ok.length ? ok[ok.length - 1] : null;
    if (!elegida) {
      // ninguna cumple todo: la de mayor margen relativo al objetivo
      var orden = res.slice().sort(function (a, b) { return b.disponibilidad - a.disponibilidad; });
      elegida = orden[0];
    }
    return { opciones: res, elegida: elegida };
  }

  /* --- lluvia de referencia por region (R0.01, mm/h) --------------------
     Estimacion de planificacion para Chile; editable en la interfaz.        */
  var R001_REGION = {
    'XV': 8, 'I': 8, 'II': 10, 'III': 14, 'IV': 20, 'V': 30, 'RM': 30,
    'VI': 34, 'VII': 36, 'XVI': 40, 'VIII': 40, 'IX': 42, 'XIV': 42,
    'X': 45, 'XI': 45, 'XII': 26
  };
  function r001DeRegion(reg) { return R001_REGION[String(reg || '').toUpperCase()] || 30; }

  /* --- factibilidad FO -------------------------------------------------- */
  /*  o = { distKm, entorno('U'|'SU'|'R'|'DU'), factorUrbano, factorRural,
            costoAereo, costoCanalizado, vanoPostes }                        */
  function evalFO(o) {
    var rural = (o.entorno === 'R');
    // En rural la ruta sigue caminos largos pero rectos; en urbano hay mas quiebres
    // por manzanas y cruces, de ahi el factor de sinuosidad mayor.
    var factor = rural ? (o.factorRural || 1.25) : (o.factorUrbano || 1.45);
    var ruta = o.distKm * factor;
    return {
      distKm: o.distKm, factor: factor, rutaKm: ruta,
      postes: Math.ceil(ruta * 1000 / (o.vanoPostes || 45)),
      costoAereo: ruta * (o.costoAereo || 0),
      costoCanalizado: ruta * (o.costoCanalizado || 0),
      rural: rural
    };
  }

  /* Categoria de factibilidad FO segun km de ruta (umbrales editables) */
  function categoriaFO(rutaKm, u) {
    var t = u || { alta: 0.8, mediaAlta: 2.5, media: 6, baja: 15 };
    if (rutaKm <= t.alta)      return { cat: 'ALTA',    score: 95, txt: 'nodo contiguo, tendido corto' };
    if (rutaKm <= t.mediaAlta) return { cat: 'ALTA',    score: 82, txt: 'tendido acotado' };
    if (rutaKm <= t.media)     return { cat: 'MEDIA',   score: 60, txt: 'tendido relevante, revisar ruta y permisos' };
    if (rutaKm <= t.baja)      return { cat: 'BAJA',    score: 32, txt: 'tendido extenso, evaluar MMOO' };
    return { cat: 'NO VIABLE', score: 8, txt: 'sin nodo cercano, priorizar MMOO' };
  }

  /* Categoria MMOO a partir de la evaluacion del mejor salto */
  function categoriaMMOO(ev) {
    if (!ev) return { cat: 'NO VIABLE', score: 0, txt: 'sin sitio par dentro de rango' };
    var score = 0, notas = [];
    // disponibilidad
    if (ev.disponibilidad >= ev.objetivo) score += 45;
    else if (ev.disponibilidad >= 99.9) { score += 28; notas.push('disponibilidad bajo objetivo'); }
    else if (ev.disponibilidad >= 99.5) { score += 14; notas.push('disponibilidad baja'); }
    else notas.push('disponibilidad insuficiente');
    // despeje con alturas actuales
    if (ev.holgura >= 0) score += 35;
    else if (ev.holgura > -10) { score += 20; notas.push('faltan ~' + Math.ceil(-ev.holgura) + ' m de altura'); }
    else { score += 5; notas.push('requiere ' + Math.ceil(ev.alturaMinima) + ' m de altura'); }
    // margen
    if (ev.margen >= 35) score += 20;
    else if (ev.margen >= 25) score += 14;
    else if (ev.margen >= 15) { score += 7; notas.push('margen ajustado'); }
    else notas.push('margen insuficiente');

    var cat = score >= 80 ? 'ALTA' : score >= 55 ? 'MEDIA' : score >= 30 ? 'BAJA' : 'NO VIABLE';
    return { cat: cat, score: score, txt: notas.length ? notas.join('; ') : 'cumple criterios de planificacion' };
  }

  global.Radio = {
    BANDAS: BANDAS, EBAND: EBAND, R001_REGION: R001_REGION,
    coefLluvia: coefLluvia, lluvia001: lluvia001, lluviaEnP: lluviaEnP,
    indispLluvia: indispLluvia, indispMultitrayecto: indispMultitrayecto,
    bulboTierra: bulboTierra, fresnel1: fresnel1, despejeReq: despejeReq,
    alturaMinima: alturaMinima, fsl: fsl, ganancia: ganancia, umbralRx: umbralRx,
    evalMMOO: evalMMOO, mejorBanda: mejorBanda, r001DeRegion: r001DeRegion,
    bandaDe: bandaDe, diamPorBanda: diamPorBanda,
    evalFO: evalFO, categoriaFO: categoriaFO, categoriaMMOO: categoriaMMOO
  };
})(window);
