/* ==========================================================================
   Factibilidad FO / MMOO
   Evalúa si un sitio o enlace nuevo se puede resolver con fibra óptica o con
   un vano de microondas contra la red existente (base CGI 2G/3G/LTE/5G).

   Secciones:
     1. Base de red        5. Análisis
     2. Geodesia           6. Entrada (parseo)
     3. Radio (ITU-R)      7. Mapa
     4. Fibra óptica       8. Interfaz
   ========================================================================== */

'use strict';

/* =========================== 1. Base de red =========================== */

const RED = (function unpack(p) {
  const out = [];
  const d = p.dic;
  for (let i = 0; i < p.n; i++) {
    out.push({
      idx: i,
      id: p.id[i],
      nombre: p.nom[i] || p.id[i],
      lat: p.lat[i],
      lon: p.lon[i],
      alt: p.alt[i] || null,
      region: d.reg[p.reg[i]] || null,
      comuna: d.com[p.com[i]] || null,
      ciudad: d.ciu[p.ciu[i]] || null,
      direccion: p.dir[i] || null,
      morfologia: d.morf[p.morf[i]] || null,
      posicion: d.pos[p.pos[i]] || null,
      estado: d.est[p.est[i]] || null,
      proveedor: d.prov[p.prov[i]] || null,
      sectorTipo: d.sect[p.sect[i]] || null,
      techMask: p.tech[i],
      celdas: p.cel[i],
      celdasLTE: p.celL[i],
      sectores: p.sec[i] || null,
    });
  }
  return out;
})(window.__RED__);

const META = window.__RED__.meta;

const TECH_BITS = [['2G', 1], ['3G', 2], ['LTE', 4], ['5G', 8]];
const techList = (mask) => TECH_BITS.filter(([, b]) => mask & b).map(([t]) => t);
const byId = new Map(RED.map((s) => [s.id, s]));

/* Regiones de Chile: nombre y tasa de lluvia R0.01 (mm/h) de referencia.
   Valores de planificación por defecto — editables en la pestaña Parámetros. */
const REGIONES = {
  XV:  { nombre: 'Arica y Parinacota', R: 8 },
  I:   { nombre: 'Tarapacá',           R: 8 },
  II:  { nombre: 'Antofagasta',        R: 10 },
  III: { nombre: 'Atacama',            R: 12 },
  IV:  { nombre: 'Coquimbo',           R: 16 },
  V:   { nombre: 'Valparaíso',         R: 22 },
  RM:  { nombre: 'Metropolitana',      R: 24 },
  VI:  { nombre: "O'Higgins",          R: 28 },
  VII: { nombre: 'Maule',              R: 30 },
  XVI: { nombre: 'Ñuble',              R: 31 },
  VIII:{ nombre: 'Biobío',             R: 32 },
  IX:  { nombre: 'La Araucanía',       R: 33 },
  XIV: { nombre: 'Los Ríos',           R: 34 },
  X:   { nombre: 'Los Lagos',          R: 35 },
  XI:  { nombre: 'Aysén',              R: 34 },
  XII: { nombre: 'Magallanes',         R: 26 },
};

/* =========================== 2. Geodesia =========================== */

const R_TIERRA = 6371.0088; // km
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

function haversine(aLat, aLon, bLat, bLon) {
  const dLat = rad(bLat - aLat);
  const dLon = rad(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_TIERRA * Math.asin(Math.min(1, Math.sqrt(s)));
}

function azimut(aLat, aLon, bLat, bLon) {
  const φ1 = rad(aLat), φ2 = rad(bLat), Δλ = rad(bLon - aLon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const rumbo = (az) => {
  const p = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
             'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  return p[Math.round(az / 22.5) % 16];
};

/* Búsqueda de vecinos por rejilla de 0.25° — evita recorrer 4.500 sitios por
   candidato cuando se procesan lotes grandes. */
const REJILLA = (function () {
  const paso = 0.25, celdas = new Map();
  const clave = (la, lo) => `${Math.floor(la / paso)}|${Math.floor(lo / paso)}`;
  RED.forEach((s) => {
    const k = clave(s.lat, s.lon);
    if (!celdas.has(k)) celdas.set(k, []);
    celdas.get(k).push(s);
  });
  return {
    cerca(lat, lon, radioKm) {
      const anilloLat = Math.ceil(radioKm / 111 / paso);
      const anilloLon = Math.ceil(radioKm / (111 * Math.max(0.2, Math.cos(rad(lat)))) / paso);
      const gl = Math.floor(lat / paso), go = Math.floor(lon / paso);
      const out = [];
      for (let i = -anilloLat; i <= anilloLat; i++) {
        for (let j = -anilloLon; j <= anilloLon; j++) {
          const c = celdas.get(`${gl + i}|${go + j}`);
          if (c) out.push(...c);
        }
      }
      return out;
    },
  };
})();

/** Los N sitios de red más cercanos a un punto, ordenados por distancia. */
function vecinos(lat, lon, n, excluir) {
  const fuera = new Set(
    (Array.isArray(excluir) ? excluir : [excluir]).filter(Boolean).map((x) => String(x).toUpperCase()));
  let radio = 12, cand = [];
  while (radio <= 400) {
    cand = REJILLA.cerca(lat, lon, radio);
    if (cand.length >= n + fuera.size + 4) break;
    radio *= 2;
  }
  if (!cand.length) cand = RED;
  const conDist = [];
  for (const s of cand) {
    if (fuera.has(s.id)) continue;
    conDist.push({ sitio: s, km: haversine(lat, lon, s.lat, s.lon) });
  }
  conDist.sort((a, b) => a.km - b.km);
  return conDist.slice(0, n);
}

/* =========================== 3. Radio (ITU-R) =========================== */

/* Bandas de microondas de uso habitual en enlaces fijos.
   ptx: potencia típica del ODU (dBm) · ants: diámetros disponibles (m)
   atm: absorción atmosférica (dB/km) · bw: ancho de canal de referencia (MHz) */
const BANDAS = [
  { id: '7 GHz',  f: 7.4,  ptx: 25, ants: [1.2, 1.8, 2.4, 3.0], atm: 0.008, bw: 56 },
  { id: '8 GHz',  f: 8.0,  ptx: 25, ants: [1.2, 1.8, 2.4, 3.0], atm: 0.009, bw: 56 },
  { id: '11 GHz', f: 11.2, ptx: 24, ants: [0.6, 1.2, 1.8, 2.4, 3.0], atm: 0.012, bw: 56 },
  { id: '13 GHz', f: 13.0, ptx: 24, ants: [0.6, 1.2, 1.8, 2.4], atm: 0.015, bw: 56 },
  { id: '15 GHz', f: 15.0, ptx: 23, ants: [0.3, 0.6, 1.2, 1.8, 2.4], atm: 0.020, bw: 56 },
  { id: '18 GHz', f: 18.7, ptx: 22, ants: [0.3, 0.6, 1.2, 1.8], atm: 0.045, bw: 56 },
  { id: '23 GHz', f: 23.0, ptx: 20, ants: [0.3, 0.6, 1.2, 1.8], atm: 0.180, bw: 56 },
  { id: '26 GHz', f: 26.0, ptx: 19, ants: [0.3, 0.6, 1.2], atm: 0.120, bw: 56 },
  { id: '38 GHz', f: 38.0, ptx: 17, ants: [0.3, 0.6, 1.2], atm: 0.130, bw: 56 },
  { id: 'E-band', f: 80.0, ptx: 10, ants: [0.3, 0.6, 0.9], atm: 0.500, bw: 500 },
];

/* Umbral de recepción por modulación, referido a 56 MHz y BER 1e-6.
   [bits/símbolo, umbral dBm] */
const MODULACIONES = [
  ['QPSK',     2,  -83.0],
  ['16QAM',    4,  -77.0],
  ['32QAM',    5,  -74.0],
  ['64QAM',    6,  -71.0],
  ['128QAM',   7,  -68.0],
  ['256QAM',   8,  -65.0],
  ['512QAM',   9,  -62.5],
  ['1024QAM', 10,  -60.0],
  ['2048QAM', 11,  -57.5],
  ['4096QAM', 12,  -55.0],
];

/* ITU-R P.838-3: coeficientes de atenuación específica por lluvia.
   [f GHz, kH, aH, kV, aV] */
const P838 = [
  [1, 0.0000259, 0.9691, 0.0000308, 0.8592],
  [2, 0.0000847, 1.0664, 0.0000998, 0.9490],
  [4, 0.0001071, 1.6009, 0.0002461, 1.2476],
  [6, 0.0007056, 1.5900, 0.0004878, 1.5728],
  [7, 0.001915,  1.4810, 0.001425,  1.4745],
  [8, 0.004115,  1.3905, 0.003450,  1.3797],
  [10, 0.01217,  1.2571, 0.01129,   1.2156],
  [12, 0.02386,  1.1825, 0.02455,   1.1216],
  [15, 0.04481,  1.1233, 0.05008,   1.0440],
  [20, 0.09164,  1.0568, 0.09611,   0.9847],
  [25, 0.1571,   0.9991, 0.1533,    0.9491],
  [30, 0.2403,   0.9485, 0.2291,    0.9129],
  [35, 0.3374,   0.9047, 0.3224,    0.8761],
  [40, 0.4431,   0.8673, 0.4274,    0.8421],
  [45, 0.5521,   0.8355, 0.5375,    0.8123],
  [50, 0.6600,   0.8084, 0.6472,    0.7871],
  [60, 0.8606,   0.7656, 0.8515,    0.7486],
  [70, 1.0315,   0.7302, 1.0253,    0.7136],
  [80, 1.1704,   0.7038, 1.1668,    0.6948],
  [90, 1.2807,   0.6872, 1.2795,    0.6737],
  [100, 1.3671,  0.6769, 1.3680,    0.6657],
];

/** Interpola k y α en frecuencia (log-log para k, lineal para α). */
function coefLluvia(fGHz, polarizacion) {
  const kIdx = polarizacion === 'H' ? 1 : 3;
  const aIdx = polarizacion === 'H' ? 2 : 4;
  let lo = P838[0], hi = P838[P838.length - 1];
  for (let i = 0; i < P838.length - 1; i++) {
    if (fGHz >= P838[i][0] && fGHz <= P838[i + 1][0]) { lo = P838[i]; hi = P838[i + 1]; break; }
  }
  if (lo === hi) return { k: lo[kIdx], a: lo[aIdx] };
  const t = (Math.log(fGHz) - Math.log(lo[0])) / (Math.log(hi[0]) - Math.log(lo[0]));
  const k = Math.exp(Math.log(lo[kIdx]) + t * (Math.log(hi[kIdx]) - Math.log(lo[kIdx])));
  const a = lo[aIdx] + t * (hi[aIdx] - lo[aIdx]);
  return { k, a };
}

/** Atenuación por lluvia excedida el 0,01 % del tiempo (ITU-R P.530). */
function lluvia001(fGHz, dKm, R001, polarizacion) {
  if (R001 <= 0) return 0;
  const { k, a } = coefLluvia(fGHz, polarizacion);
  const gamma = k * Math.pow(R001, a);            // dB/km
  const d0 = 35 * Math.exp(-0.015 * Math.min(R001, 100));
  const dEff = dKm / (1 + dKm / d0);
  return gamma * dEff;
}

/** Factor de escala de P.530-17 para llevar A(0,01 %) a otro porcentaje p. */
const factorP = (p) => 0.12 * Math.pow(p, -(0.546 + 0.043 * Math.log10(p)));

/** Porcentaje de tiempo con corte por lluvia dado el margen disponible. */
function indispLluvia(margenDB, a001) {
  if (a001 <= 0) return 0;
  if (margenDB <= 0) return 100;
  const objetivo = margenDB / a001;
  if (objetivo >= factorP(0.00001)) return 0.00001;
  let lo = -5, hi = 2;                             // log10(p), de 0,00001 % a 100 %
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (factorP(Math.pow(10, mid)) > objetivo) lo = mid; else hi = mid;
  }
  return Math.pow(10, (lo + hi) / 2);
}

/** Desvanecimiento multitrayecto, P.530 simplificado (fading plano).
    La expresión de P.530 ya entrega el resultado en por ciento del peor mes. */
function indispMultitrayecto(margenDB, dKm, fGHz, inclinacionMrad, dN1) {
  const K = Math.pow(10, -4.2 - 0.0029 * dN1);
  const pw = K * Math.pow(dKm, 3.6) * Math.pow(fGHz, 0.89) *
             Math.pow(1 + Math.abs(inclinacionMrad), -1.4) * Math.pow(10, -margenDB / 10);
  return Math.max(0, Math.min(100, pw));
}

/** Ganancia de una parábola de diámetro D (m) con 55 % de eficiencia. */
const ganancia = (D, fGHz) => 20 * Math.log10(D) + 20 * Math.log10(fGHz) + 17.8;

/** Pérdida en espacio libre. */
const fsl = (dKm, fGHz) => 92.45 + 20 * Math.log10(fGHz) + 20 * Math.log10(dKm);

/** Radio de la primera zona de Fresnel en un punto del vano (m). */
const fresnel1 = (d1Km, d2Km, fGHz) =>
  17.32 * Math.sqrt((d1Km * d2Km) / ((d1Km + d2Km) * fGHz));

/** Abultamiento terrestre con factor k de refracción (m). */
const abultamiento = (d1Km, d2Km, k) => (d1Km * d2Km) / (12.74 * k);

/** Modulación mínima que entrega la capacidad pedida en un canal dado. */
function elegirModulacion(capacidadMbps, bwMHz, xpic) {
  const canales = xpic ? 2 : 1;
  for (const [nombre, bits, umbral56] of MODULACIONES) {
    const cap = bwMHz * bits * 0.85 * canales;     // descuenta overhead y roll-off
    if (cap >= capacidadMbps) {
      return { nombre, bits, cap, umbral: umbral56 + 10 * Math.log10(bwMHz / 56) };
    }
  }
  return null;
}

/**
 * Evalúa una banda concreta para un vano: elige la antena más pequeña que
 * alcanza la disponibilidad objetivo y devuelve el balance resultante.
 */
function evaluarBanda(banda, dKmBruto, P, inclinacionMrad) {
  const dKm = Math.max(0.01, dKmBruto);
  const mod = elegirModulacion(P.capacidad, banda.bw, P.xpic);
  if (!mod) return { banda, viable: false, motivo: 'capacidad fuera de rango' };

  const a001 = lluvia001(banda.f, dKm, P.R001, P.polarizacion);
  const fslDB = fsl(dKm, banda.f);
  const perdida = fslDB + banda.atm * dKm + P.perdidasFijas;
  const objetivo = 100 - P.disponibilidad;         // % de indisponibilidad admitida

  let mejor = null;
  for (const D of banda.ants) {
    if (D > P.antenaMax) continue;
    const rx = banda.ptx + 2 * ganancia(D, banda.f) - perdida;
    const margen = rx - mod.umbral;
    const pLluvia = indispLluvia(margen, a001);
    const pMulti = indispMultitrayecto(margen, dKm, banda.f, inclinacionMrad, P.dN1);
    const indisp = pLluvia + pMulti;
    const cand = {
      banda, antena: D, mod, rx, margen, a001, fslDB, dKm,
      pLluvia, pMulti, indisp,
      disponibilidad: 100 - indisp,
      minutosAnio: (indisp / 100) * 525600,
      viable: indisp <= objetivo,
    };
    if (!mejor || cand.indisp < mejor.indisp) mejor = cand;
    if (cand.viable) return cand;                  // la antena más pequeña que cumple
  }
  return mejor
    ? Object.assign(mejor, { viable: false, motivo: 'no alcanza la disponibilidad objetivo' })
    : { banda, viable: false, motivo: `requiere antena > ${P.antenaMax} m` };
}

/**
 * Geometría del vano y resolución del despeje. Tres calidades de respuesta, en
 * orden de precedencia:
 *   1. cotas que declaró el usuario — puede conocer un obstáculo que el modelo
 *      digital no ve, como un edificio nuevo;
 *   2. perfil altimétrico medido, evaluado punto por punto;
 *   3. sin ninguno de los dos, terreno plano: un tamiz, no un perfil.
 */
function geometria(dKmBruto, hA, hB, P, cotas, perfil) {
  const dKm = Math.max(0.01, dKmBruto);
  const dObs = cotas && cotas.dObsKm > 0 && cotas.dObsKm < dKm ? cotas.dObsKm : dKm / 2;
  const f = P.fRef;
  const requeridoEn = (d1, d2) =>
    abultamiento(d1, d2, P.kRefraccion) + P.fraccionFresnel * fresnel1(d1, d2, f) + P.clutter;

  const F1 = fresnel1(dObs, dKm - dObs, f);
  const bulge = abultamiento(dObs, dKm - dObs, P.kRefraccion);
  const g = { dKm, dObsKm: dObs, F1, bulge, requerido: requeridoEn(dObs, dKm - dObs),
              los: 'desconocido', disponible: null, holgura: null, fuente: 'plano' };

  const dictamen = (disponible, requerido, bulgeLocal) => {
    g.disponible = disponible;
    g.holgura = disponible - requerido;
    g.requerido = requerido;
    g.los = g.holgura >= 0 ? 'ok'
          : (disponible >= bulgeLocal + P.clutter ? 'marginal' : 'insuficiente');
  };

  if (cotas && cotas.cotaA != null && cotas.cotaB != null && cotas.cotaObs != null) {
    const topeA = cotas.cotaA + hA;
    const topeB = cotas.cotaB + hB;
    const rayo = topeA + ((topeB - topeA) * dObs) / dKm;   // altura del rayo sobre el obstáculo
    dictamen(rayo - cotas.cotaObs, g.requerido, bulge);
    g.fuente = 'cotas';
    g.rayo = rayo;
    g.cotaA = cotas.cotaA;
    g.cotaB = cotas.cotaB;
    g.cotaObs = cotas.cotaObs;
  } else if (perfil && perfil.puntos && perfil.puntos.length >= 3) {
    /* El punto crítico no es el medio del vano: se busca el de menor holgura
       sobre todo el perfil, que es lo que decide la línea de vista. */
    const pts = perfil.puntos;
    const elevA = pts[0].elev, elevB = pts[pts.length - 1].elev;
    const topeA = elevA + hA, topeB = elevB + hB;
    /* Las muestras pegadas a las torres quedan dominadas por el clutter y
       ganarían el mínimo siempre sin informar nada: lo que hay al pie de la
       torre se resuelve en inspección, no sobre el perfil. */
    const borde = Math.max(0.03, dKm * 0.02);
    let peor = null;
    for (let i = 1; i < pts.length - 1; i++) {
      const d1 = pts[i].km, d2 = dKm - d1;
      if (d1 <= borde || d2 <= borde) continue;
      const req = requeridoEn(d1, d2);
      const rayo = topeA + ((topeB - topeA) * d1) / dKm;
      const disp = rayo - pts[i].elev;
      const hol = disp - req;
      if (!peor || hol < peor.holgura) {
        peor = { km: d1, elev: pts[i].elev, requerido: req, disponible: disp, holgura: hol,
                 bulge: abultamiento(d1, d2, P.kRefraccion), F1: fresnel1(d1, d2, f) };
      }
    }
    if (peor) {
      dictamen(peor.disponible, peor.requerido, peor.bulge);
      g.fuente = 'perfil';
      g.perfil = perfil;
      g.peor = peor;
      g.dObsKm = peor.km;
      g.bulge = peor.bulge;
      g.F1 = peor.F1;
      g.cotaA = elevA;
      g.cotaB = elevB;
      g.cotaObs = peor.elev;
      g.rayo = topeA + ((topeB - topeA) * peor.km) / dKm;
    }
  }

  if (g.los === 'desconocido') {
    /* Sin cotas ni perfil: se asume terreno plano y se comprueba si la altura
       media de las antenas cubre el despeje exigido. */
    g.disponible = (hA + hB) / 2;
    g.holgura = g.disponible - g.requerido;
    g.losPlano = g.holgura >= 0;
  }
  return g;
}

/** Extremo arbitrario tratado como nodo: hereda la morfología del sitio de red
    más cercano, que es lo que determina sinuosidad y costo del tendido. */
function extremoComoNodo(ext, P) {
  const v = vecinos(ext.lat, ext.lon, 1);
  const cerca = v.length ? v[0].sitio : null;
  return {
    id: ext.nombre, nombre: ext.nombre, lat: ext.lat, lon: ext.lon, alt: ext.alt,
    morfologia: cerca ? cerca.morfologia : null,
    posicion: null, techMask: 0, celdas: 0, celdasLTE: 0, sectores: null,
    comuna: cerca ? cerca.comuna : null, region: cerca ? cerca.region : (P.region || null),
  };
}

/** Análisis completo de un vano de microondas entre dos extremos. */
function analizarMMOO(A, B, P, cotas, perfil) {
  const dKm = haversine(A.lat, A.lon, B.lat, B.lon);
  const hA = A.alt || P.alturaDefecto;
  const hB = B.alt || P.alturaDefecto;
  const inclinacion = dKm > 0 ? Math.abs(hA - hB) / dKm : 0;   // m/km ≡ mrad
  const geo = geometria(dKm, hA, hB, P, cotas, perfil);

  const habilitadas = Array.isArray(P.bandas) && P.bandas.length
    ? BANDAS.filter((b) => P.bandas.includes(b.id)) : BANDAS;
  const bandas = habilitadas.map((b) => evaluarBanda(b, dKm, P, inclinacion));
  /* De las bandas que cierran se toma la de antena más pequeña —menos carga de
     torre y menos costo— y, a igualdad de antena, la frecuencia más alta, para
     no consumir las bandas bajas en saltos que se resuelven arriba. */
  const viables = bandas.filter((b) => b.viable);
  const recomendada = viables.length
    ? viables.reduce((a, b) => (b.antena < a.antena || (b.antena === a.antena && b.banda.f > a.banda.f) ? b : a))
    : null;

  let grade, why;
  if (dKm < 0.15) {
    grade = 'warn';
    why = 'Vano demasiado corto: revisar acoplamiento y desacople de campo cercano.';
  } else if (!recomendada) {
    grade = 'bad';
    const mejor = bandas.reduce((a, b) => (a && a.disponibilidad > (b.disponibilidad ?? -1) ? a : b), null);
    why = mejor && mejor.disponibilidad != null
      ? `Ninguna banda alcanza ${fmt(P.disponibilidad, 3)} % a ${fmt(dKm, 1)} km; el máximo es ${fmtDisp(mejor.disponibilidad)} en ${mejor.banda.id} con antena de ${fmtAnt(mejor.antena)}.`
      : `Ninguna banda cierra el vano de ${fmt(dKm, 1)} km con antenas de hasta ${P.antenaMax} m.`;
  } else if (geo.los === 'insuficiente') {
    grade = 'bad';
    const donde = geo.fuente === 'perfil'
      ? `el terreno en el km ${fmt(geo.dObsKm, 1)} (${fmt(geo.cotaObs, 0)} msnm) corta el rayo`
      : 'el despeje sobre el obstáculo declarado es insuficiente';
    why = `Radioeléctricamente cierra en ${recomendada.banda.id}, pero ${donde}: faltan ${fmt(-geo.holgura, 1)} m.`;
  } else if (geo.los === 'marginal') {
    grade = 'warn';
    const donde = geo.fuente === 'perfil' ? ` en el km ${fmt(geo.dObsKm, 1)}` : '';
    why = `Cierra en ${recomendada.banda.id}, con despeje marginal: obstruye la zona de Fresnel en ${fmt(-geo.holgura, 1)} m${donde}. Elevar torre o replantear.`;
  } else if (geo.los === 'ok') {
    grade = 'ok';
    const como = geo.fuente === 'perfil'
      ? `despeje resuelto sobre perfil SRTM con holgura de ${fmt(geo.holgura, 1)} m en el km ${fmt(geo.dObsKm, 1)}`
      : `despeje verificado con holgura de ${fmt(geo.holgura, 1)} m`;
    why = `Vano de ${fmt(dKm, 1)} km en ${recomendada.banda.id}, antena de ${fmtAnt(recomendada.antena)}, ${como}.`;
  } else if (!geo.losPlano) {
    grade = 'warn';
    why = `Cierra en ${recomendada.banda.id}, pero con las alturas declaradas (${fmt(hA, 0)} / ${fmt(hB, 0)} m) no se cubre el despeje de ${fmt(geo.requerido, 1)} m ni en terreno plano.`;
  } else if (recomendada.antena >= 1.8) {
    grade = 'warn';
    why = `Cierra en ${recomendada.banda.id} pero exige antena de ${fmtAnt(recomendada.antena)}: verificar carga de torre y perfil topográfico.`;
  } else {
    grade = 'ok';
    why = `Vano de ${fmt(dKm, 1)} km viable en ${recomendada.banda.id} con antena de ${fmtAnt(recomendada.antena)}. Falta confirmar línea de vista con perfil.`;
  }

  return { dKm, hA, hB, geo, bandas, recomendada, grade, why, inclinacion };
}

/* =========================== 3.b Altimetría =========================== */

/* Modelo digital de elevación. Instancia pública de OpenTopoData sobre SRTM de
   30 m, gratuita y sin clave: 100 puntos por llamada, una llamada por segundo.
   Para volumen alto, levantar OpenTopoData propio y apuntar aquí.
   SRTM cubre de 60°S al norte, así que alcanza hasta Magallanes. */
const ELEVACION_URL = 'https://api.opentopodata.org/v1/srtm30m';
const ELEVACION_PUNTOS = 100;        // tope por llamada del servicio
const ELEVACION_ESPERA = 1100;       // ms entre llamadas, por el límite de 1/s

const Altimetria = (function () {
  const cache = new Map();
  let fallos = 0;
  let apagado = false;
  let ultima = 0;
  let cola = Promise.resolve();       // serializa: el servicio admite 1 llamada/s

  const clave = (a, b) =>
    `${a.lat.toFixed(4)},${a.lon.toFixed(4)}>${b.lat.toFixed(4)},${b.lon.toFixed(4)}`;

  /** Interpolación sobre el círculo máximo, para muestrear el vano. */
  function interpolar(a, b, t) {
    const la1 = rad(a.lat), lo1 = rad(a.lon), la2 = rad(b.lat), lo2 = rad(b.lon);
    const d = 2 * Math.asin(Math.sqrt(
      Math.sin((la2 - la1) / 2) ** 2 +
      Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
    if (d < 1e-9) return { lat: a.lat, lon: a.lon };
    const A = Math.sin((1 - t) * d) / Math.sin(d);
    const B = Math.sin(t * d) / Math.sin(d);
    const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
    const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
    const z = A * Math.sin(la1) + B * Math.sin(la2);
    return { lat: deg(Math.atan2(z, Math.hypot(x, y))), lon: deg(Math.atan2(y, x)) };
  }

  async function esperarTurno() {
    const falta = ELEVACION_ESPERA - (performance.now() - ultima);
    if (falta > 0) await new Promise((r) => setTimeout(r, falta));
    ultima = performance.now();
  }

  /**
   * Perfil altimétrico del vano: n muestras equiespaciadas entre los extremos.
   * Devuelve null si no hay servicio, y quien llama debe seguir funcionando con
   * lo que tenga.
   */
  async function perfil(a, b, n) {
    if (apagado || !ESTADO.params.altimetria) return null;
    const k = clave(a, b);
    if (cache.has(k)) return cache.get(k);

    const muestras = Math.max(3, Math.min(ELEVACION_PUNTOS, n || ELEVACION_PUNTOS));
    const dKm = haversine(a.lat, a.lon, b.lat, b.lon);
    const pts = [];
    for (let i = 0; i < muestras; i++) {
      const t = i / (muestras - 1);
      const p = interpolar(a, b, t);
      pts.push({ km: dKm * t, lat: p.lat, lon: p.lon });
    }

    const tarea = cola.then(async () => {
      if (cache.has(k)) return cache.get(k);
      try {
        await esperarTurno();
        const locs = pts.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join('|');
        const resp = await fetch(`${ELEVACION_URL}?locations=${encodeURIComponent(locs)}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const j = await resp.json();
        if (j.status !== 'OK' || !Array.isArray(j.results)) throw new Error(j.status || 'sin datos');
        const puntos = j.results.map((r, i) => ({
          km: pts[i].km, lat: pts[i].lat, lon: pts[i].lon,
          elev: Number.isFinite(r.elevation) ? r.elevation : 0,
        }));
        /* si el modelo no cubre la zona devuelve nulos, que llegan como 0 */
        const utiles = j.results.filter((r) => Number.isFinite(r.elevation)).length;
        if (utiles < muestras * 0.6) throw new Error('cobertura insuficiente');
        const res = { puntos, dKm, fuente: 'SRTM 30 m', muestras };
        cache.set(k, res);
        fallos = 0;
        return res;
      } catch (e) {
        if (++fallos >= 3) apagado = true;
        cache.set(k, null);
        return null;
      }
    });
    cola = tarea.catch(() => {});
    return tarea;
  }

  return {
    perfil,
    interpolar,
    get activo() { return !apagado; },
    reactivar() { apagado = false; fallos = 0; },
  };
})();

/* =========================== 3.c Ruteo por calles =========================== */

/* Servicio de ruteo. Es el servidor público de demostración de OSRM: gratuito y
   sin clave, con uso razonable esperado. Para volumen alto, apuntar esta
   constante a una instancia propia de OSRM o Valhalla. */
const RUTEO_URL = 'https://router.project-osrm.org/route/v1/driving';

const Ruteo = (function () {
  const cache = new Map();
  let fallos = 0;
  let apagado = false;                 // se apaga solo si el servicio no responde

  const clave = (a, b) =>
    `${a.lat.toFixed(5)},${a.lon.toFixed(5)}>${b.lat.toFixed(5)},${b.lon.toFixed(5)}`;

  /** Decodifica una polilínea codificada de Google (precisión 5). */
  function decodificar(txt, precision) {
    const factor = Math.pow(10, precision || 5);
    const salida = [];
    let i = 0, lat = 0, lon = 0;
    while (i < txt.length) {
      let res = 1, desp = 0, b;
      do { b = txt.charCodeAt(i++) - 64; res += b << desp; desp += 5; } while (b >= 0x1f);
      lat += (res & 1) ? ~(res >> 1) : (res >> 1);
      res = 1; desp = 0;
      do { b = txt.charCodeAt(i++) - 64; res += b << desp; desp += 5; } while (b >= 0x1f);
      lon += (res & 1) ? ~(res >> 1) : (res >> 1);
      salida.push([lat / factor, lon / factor]);
    }
    return salida;
  }

  /**
   * Recorrido real por la red viaria entre dos puntos. Devuelve la longitud y
   * la traza, o null si no hay servicio o no existe camino: quien llama debe
   * poder seguir trabajando con la estimación por sinuosidad.
   */
  async function ruta(a, b) {
    if (apagado || !ESTADO.params.ruteo) return null;
    const k = clave(a, b);
    if (cache.has(k)) return cache.get(k);
    try {
      const url = `${RUTEO_URL}/${a.lon},${a.lat};${b.lon},${b.lat}` +
                  '?overview=full&geometries=polyline&alternatives=false&steps=false';
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const j = await resp.json();
      if (j.code !== 'Ok' || !j.routes || !j.routes.length) throw new Error(j.code || 'sin ruta');
      const r = {
        km: j.routes[0].distance / 1000,
        geometria: decodificar(j.routes[0].geometry, 5),
        fuente: 'calles',
      };
      cache.set(k, r);
      fallos = 0;
      return r;
    } catch (e) {
      /* tres fallos seguidos: el servicio no está disponible en este entorno */
      if (++fallos >= 3) apagado = true;
      cache.set(k, null);
      return null;
    }
  }

  return {
    ruta,
    decodificar,
    get activo() { return !apagado; },
    reactivar() { apagado = false; fallos = 0; },
  };
})();

/* =========================== 4. Fibra óptica =========================== */

/**
 * Probabilidad de que un nodo de la red ya tenga fibra, inferida del perfil
 * radio del sitio. La base CGI no trae el medio de transmisión; si se importa
 * un inventario real de nodos FO, ese dato manda sobre esta heurística.
 */
function probabilidadFO(s) {
  if (ESTADO.nodosFO.size) {
    return ESTADO.nodosFO.has(s.id)
      ? { score: 100, nivel: 'confirmada', fuente: 'inventario' }
      : { score: 0, nivel: 'sin FO', fuente: 'inventario' };
  }
  let p = 8;
  if (s.techMask & 8) p += 45;                       // 5G exige transporte de alta capacidad
  if (s.celdasLTE >= 24) p += 20;
  else if (s.celdasLTE >= 12) p += 12;
  else if (s.celdasLTE >= 6) p += 6;
  if (s.morfologia === 'URBANO') p += 15;
  else if (s.morfologia === 'RURAL') p -= 10;
  if (s.posicion === 'INDOOR') p += 10;
  if (s.sectores && s.sectores > 3) p += 5;
  const score = Math.max(0, Math.min(100, p));
  const nivel = score >= 60 ? 'alta' : score >= 35 ? 'media' : 'baja';
  return { score, nivel, fuente: 'heurística' };
}

/**
 * Trazado y costo de un tendido de fibra hasta un nodo. Si se entrega una ruta
 * medida sobre la red viaria se usa su longitud real; si no, se estima
 * multiplicando la recta por el factor de sinuosidad.
 */
function analizarFO(candLat, candLon, nodo, P, rutaMedida) {
  const km = haversine(candLat, candLon, nodo.lat, nodo.lon);
  const urbano = nodo.morfologia === 'URBANO';
  const medida = rutaMedida && Number.isFinite(rutaMedida.km) && rutaMedida.km >= km * 0.9;
  const sinuosidad = medida ? rutaMedida.km / Math.max(0.001, km)
                            : (urbano ? P.sinuosidadUrbana : P.sinuosidadRural);
  const rutaKm = medida ? rutaMedida.km : km * sinuosidad;
  const costoKm = urbano ? P.costoUrbano : P.costoRural;
  const costo = rutaKm * costoKm;
  const fo = probabilidadFO(nodo);
  const via = medida ? 'por calles' : 'estimados';
  const traza = medida ? rutaMedida.geometria : null;

  let grade, why;
  if (rutaKm <= P.foVerdeKm && fo.score >= 60) {
    grade = 'ok';
    why = `${fmt(rutaKm, 2)} km de tendido ${via} hasta ${nodo.id}, nodo con probabilidad ${fo.nivel} de fibra.`;
  } else if (rutaKm <= P.foVerdeKm && fo.score >= 35) {
    grade = 'warn';
    why = `Tendido corto (${fmt(rutaKm, 2)} km ${via}), pero hay que confirmar fibra en ${nodo.id} (probabilidad ${fo.nivel}).`;
  } else if (rutaKm <= P.foAmbarKm && fo.score >= 35) {
    grade = 'warn';
    why = `${fmt(rutaKm, 2)} km ${via}: viable con obra civil, sujeto a permisos y a confirmar fibra en ${nodo.id}.`;
  } else if (rutaKm <= P.foAmbarKm) {
    grade = 'bad';
    why = `${fmt(rutaKm, 2)} km ${via} hasta un nodo con probabilidad ${fo.nivel} de fibra: costo alto frente al beneficio.`;
  } else {
    grade = 'bad';
    why = `${fmt(rutaKm, 2)} km ${via} superan el umbral de ${P.foAmbarKm} km. Resolver por radio o por un tercero.`;
  }
  return { km, rutaKm, sinuosidad, costo, costoKm, urbano, fo, grade, why, nodo, medida, traza };
}

/* =========================== 5. Análisis =========================== */

const PESO_GRADO = { ok: 0, warn: 1, bad: 2 };

/** Evalúa un punto candidato contra los nodos de red más cercanos. */
function analizarSitio(cand, P, excluir) {
  const cerca = vecinos(cand.lat, cand.lon, P.nNodos, excluir || cand.id);
  if (!cerca.length) return null;

  /* Las cotas de terreno se piden por vano, no por sitio: aquí el despeje se
     tamiza en terreno plano y se resuelve luego en el modo Enlace A–B. */
  const filas = cerca.map(({ sitio, km }) => {
    const fo = analizarFO(cand.lat, cand.lon, sitio, P);
    const mw = analizarMMOO(
      { lat: cand.lat, lon: cand.lon, alt: cand.alt || P.alturaCandidato }, sitio, P, null);
    return { sitio, km, fo, mw };
  });

  const mejorFO = filas.reduce((a, b) =>
    PESO_GRADO[b.fo.grade] < PESO_GRADO[a.fo.grade] ||
    (b.fo.grade === a.fo.grade && b.fo.rutaKm < a.fo.rutaKm) ? b : a);
  const mejorMW = filas.reduce((a, b) => {
    const ga = PESO_GRADO[a.mw.grade], gb = PESO_GRADO[b.mw.grade];
    if (gb !== ga) return gb < ga ? b : a;
    const aa = a.mw.recomendada ? a.mw.recomendada.disponibilidad : -1;
    const bb = b.mw.recomendada ? b.mw.recomendada.disponibilidad : -1;
    return bb > aa ? b : a;
  });

  return { cand, filas, mejorFO, mejorMW };
}

/**
 * Alternativas a un vano directo: los nodos de la red que podrían servir a cada
 * extremo, excluyendo los propios extremos. Es lo que se mira cuando el salto
 * A-B no cierra, o cuando cierra pero conviene comparar.
 */
function alternativasDeEnlace(A, B, P) {
  const fuera = [A.id, B.id].filter(Boolean);
  const porExtremo = [];
  [['A', A], ['B', B]].forEach(([etiqueta, ext]) => {
    const cerca = vecinos(ext.lat, ext.lon, Math.max(3, Math.ceil(P.nNodos / 2)), fuera);
    cerca.forEach(({ sitio, km }) => {
      porExtremo.push({
        extremo: etiqueta,
        desde: ext,
        sitio,
        km,
        fo: analizarFO(ext.lat, ext.lon, sitio, P),
        mw: analizarMMOO({ lat: ext.lat, lon: ext.lon, alt: ext.alt }, sitio, P, null),
      });
    });
  });
  return porExtremo;
}

/** Recomendación global entre fibra y radio. */
function recomendacion(res) {
  const f = res.mejorFO.fo, m = res.mejorMW.mw;
  const gf = PESO_GRADO[f.grade], gm = PESO_GRADO[m.grade];
  if (gf === 2 && gm === 2) {
    return { medio: 'Ninguno directo', grade: 'bad',
      texto: 'Ni fibra ni radio resuelven contra la red actual. Evaluar salto en dos tramos, sitio repetidor o capacidad de terceros.' };
  }
  if (gf < gm) {
    return { medio: 'Fibra óptica', grade: f.grade,
      texto: `Ir por FO hasta ${f.nodo.id} (${fmt(f.rutaKm, 2)} km de tendido estimado).` };
  }
  if (gm < gf) {
    return { medio: 'Microondas', grade: m.grade,
      texto: `Ir por MMOO contra ${res.mejorMW.sitio.id}: ${fmt(m.dKm, 1)} km${m.recomendada ? ` en ${m.recomendada.banda.id}` : ''}.` };
  }
  /* Empate de semáforo: manda el tendido corto, si no la radio. */
  if (f.rutaKm <= 1.5) {
    return { medio: 'Fibra óptica', grade: f.grade,
      texto: `Tendido corto (${fmt(f.rutaKm, 2)} km) hasta ${f.nodo.id}: preferir FO por capacidad y vida útil.` };
  }
  return { medio: 'Microondas', grade: m.grade,
    texto: `Ambos medios empatan; MMOO contra ${res.mejorMW.sitio.id} despliega antes y sin obra civil.` };
}

/* =========================== 6. Entrada (parseo) =========================== */

/** Convierte grados/minutos/segundos o grados decimales a decimal. */
function parseCoord(txt) {
  if (txt == null) return null;
  let s = String(txt).trim().replace(/\s+/g, ' ');
  if (!s) return null;
  const dms = s.match(/^(-?\d{1,3})\s*[°:\s]\s*(\d{1,2})\s*['′:\s]\s*([\d.,]+)\s*["″]?\s*([NSEWOnsewo])?$/);
  if (dms) {
    const g = parseFloat(dms[1]), m = parseFloat(dms[2]), sec = parseFloat(String(dms[3]).replace(',', '.'));
    let v = Math.abs(g) + m / 60 + sec / 3600;
    if (g < 0) v = -v;
    const h = (dms[4] || '').toUpperCase();
    if (h === 'S' || h === 'W' || h === 'O') v = -Math.abs(v);
    return v;
  }
  const hemi = s.match(/([NSEWOnsewo])\s*$/);
  let signo = 1;
  if (hemi) {
    const h = hemi[1].toUpperCase();
    if (h === 'S' || h === 'W' || h === 'O') signo = -1;
    s = s.slice(0, hemi.index).trim();
  }
  s = s.replace(/[°'"′″]/g, '').trim();
  /* Coma decimal sólo si no actúa como separador de miles ni de campos. */
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  const v = parseFloat(s);
  return Number.isFinite(v) ? signo * v : null;
}

/**
 * Ordena un par de valores en lat/lon. En Chile la latitud va de −17 a −56 y
 * la longitud de −66 a −76, así que |v| > 66 sólo puede ser longitud.
 */
function ordenarLatLon(a, b) {
  if (a == null || b == null) return null;
  const esLon = (v) => Math.abs(v) > 66;
  if (esLon(a) && !esLon(b)) return { lat: b, lon: a };
  if (esLon(b) && !esLon(a)) return { lat: a, lon: b };
  return { lat: a, lon: b };   // ambigüedad: se respeta el orden lat, lon
}

const RE_SEP = /[\t;|]|,(?=\s*-?\d)|\s{2,}/;

function partirCampos(linea) {
  let campos = linea.split(RE_SEP).map((c) => c.trim()).filter((c) => c !== '');
  if (campos.length < 2) campos = linea.split(',').map((c) => c.trim()).filter((c) => c !== '');
  return campos;
}

/**
 * Reconoce un enlace escrito con los códigos de dos sitios de la red, del tipo
 * «06_109-06_331». Ningún código del inventario contiene guiones, así que el
 * separador no es ambiguo; se aceptan además flechas y guiones tipográficos.
 */
function parEnlaceDeCodigos(txt) {
  const partes = String(txt).trim().toUpperCase()
    .split(/\s*(?:->|=>|→|[-–—/>])\s*/).filter(Boolean);
  if (partes.length !== 2) return null;
  const a = byId.get(partes[0]), b = byId.get(partes[1]);
  return a && b && a !== b ? [a, b] : null;
}

/** Los sitios de la red mencionados en una fila, por código o por par A-B. */
function codigosDeFila(campos) {
  const out = [];
  campos.forEach((c) => {
    const par = parEnlaceDeCodigos(c);
    if (par) { out.push(par[0], par[1]); return; }
    const s = byId.get(c.trim().toUpperCase());
    if (s) out.push(s);
  });
  return out;
}

/**
 * Interpreta líneas pegadas desde una planilla. Acepta:
 *   nombre; lat; lon [; altura]
 *   nombre; latA; lonA; latB; lonB      (enlace explícito)
 *   CODIGO_SITIO                         (sitio ya en la red)
 */
function parsearLote(texto) {
  const filas = [], errores = [];
  const lineas = texto.split(/\r?\n/);
  lineas.forEach((linea, i) => {
    const bruto = linea.trim();
    if (!bruto || /^(nombre|name|sitio|site|id)\b/i.test(bruto) && i === 0) return;
    const campos = partirCampos(bruto);
    if (!campos.length) return;

    /* Códigos de la red: uno solo es un sitio; dos, el enlace entre ellos. */
    const sitios = codigosDeFila(campos);
    const sobrantes = campos.filter((c) => !parEnlaceDeCodigos(c) && !byId.has(c.trim().toUpperCase()));
    const numsSobrantes = sobrantes.map(parseCoord)
      .filter((v) => v != null && Math.abs(v) >= 15 && Math.abs(v) <= 180);

    if (sitios.length >= 2) {
      const [A, B] = sitios;
      const rotulo = sobrantes.find((c) => parseCoord(c) == null);
      filas.push({
        nombre: rotulo || `${A.id}–${B.id}`,
        lat: A.lat, lon: A.lon, alt: A.alt, refA: A,
        latB: B.lat, lonB: B.lon, altB: B.alt, refB: B,
        linea: i + 1,
      });
      return;
    }
    /* Un código más un par de coordenadas: enlace del sitio al punto nuevo. */
    if (sitios.length === 1 && numsSobrantes.length >= 2) {
      const A = sitios[0];
      const pto = ordenarLatLon(numsSobrantes[0], numsSobrantes[1]);
      if (pto && validar(pto)) {
        const rotulo = sobrantes.find((c) => parseCoord(c) == null);
        filas.push({
          nombre: rotulo || `${A.id}–punto`,
          lat: A.lat, lon: A.lon, alt: A.alt, refA: A,
          latB: pto.lat, lonB: pto.lon, linea: i + 1,
        });
        return;
      }
    }
    if (sitios.length === 1 && !numsSobrantes.length) {
      const s = sitios[0];
      filas.push({ nombre: s.id, lat: s.lat, lon: s.lon, alt: s.alt, ref: s, linea: i + 1 });
      return;
    }

    if (campos.length === 1) {
      errores.push(`Línea ${i + 1}: «${bruto}» no es un código de la red ni trae coordenadas.`);
      return;
    }

    const nums = campos.map(parseCoord);
    const idxNum = nums.map((v, k) => (v != null && Math.abs(v) <= 180 ? k : -1)).filter((k) => k >= 0);
    const noNum = campos.map((c, k) => (idxNum.includes(k) ? null : c)).filter(Boolean);
    const nombre = noNum.length ? noNum[0] : `Punto ${filas.length + 1}`;

    const coordsIdx = idxNum.filter((k) => Math.abs(nums[k]) >= 15);   // descarta alturas
    if (coordsIdx.length >= 4) {
      const A = ordenarLatLon(nums[coordsIdx[0]], nums[coordsIdx[1]]);
      const B = ordenarLatLon(nums[coordsIdx[2]], nums[coordsIdx[3]]);
      if (A && B && validar(A) && validar(B)) {
        filas.push({ nombre, lat: A.lat, lon: A.lon, latB: B.lat, lonB: B.lon, linea: i + 1 });
        return;
      }
    }
    if (coordsIdx.length >= 2) {
      const A = ordenarLatLon(nums[coordsIdx[0]], nums[coordsIdx[1]]);
      if (A && validar(A)) {
        const alturas = idxNum.filter((k) => !coordsIdx.slice(0, 2).includes(k) && nums[k] > 0 && nums[k] < 150);
        filas.push({ nombre, lat: A.lat, lon: A.lon, alt: alturas.length ? nums[alturas[0]] : null, linea: i + 1 });
        return;
      }
    }
    errores.push(`Línea ${i + 1}: no se reconocieron coordenadas válidas en «${bruto}».`);
  });
  return { filas, errores };
}

const validar = (p) => p && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180 && (p.lat !== 0 || p.lon !== 0);

/** Región de red más cercana al punto, para heredar la tasa de lluvia. */
function regionDe(lat, lon) {
  const v = vecinos(lat, lon, 1);
  return v.length ? v[0].sitio.region : 'RM';
}

/* =========================== 6.b Capas SUBTEL =========================== */

/* Registros de antenas de SUBTEL. Son ~17.000 y ~12.600 emplazamientos, así que
   no se incrustan: se piden al activar la capa y quien no las usa no las baja.
   Con dist/index.html abierto desde el disco, fetch() sobre file:// está vetado
   por el navegador y la capa queda no disponible; se avisa en la interfaz. */
const CAPAS = [
  { id: 'servicio', archivo: 'capas/servicio.json', nombre: 'Antenas en servicio',
    forma: 'arriba', alfa: 0.9 },
  { id: 'autorizadas', archivo: 'capas/autorizadas.json', nombre: 'Antenas autorizadas',
    forma: 'abajo', alfa: 0.6 },
];

/* Un color por marca, compartido por las dos capas: lo que se quiere leer de un
   vistazo es de quién es la antena, no en qué registro aparece. */
const COLOR_MARCA = {
  CLARO: '#e4574f', ENTEL: '#3f8ae0', MOVISTAR: '#4fb3a6', WOM: '#c964c0',
  WILL: '#d99a3c', VTR: '#6cae4a', BORDER: '#8a8fa8', OTROS: '#8a8fa8',
};

const Capas = (function () {
  const estado = new Map();     // id -> {cargando, datos, error}

  function decodificar(j) {
    const n = j.n;
    const lat = new Float64Array(n), lon = new Float64Array(n);
    let acLat = 0, acLon = 0;
    for (let i = 0; i < n; i++) {
      acLat += j.lat[i]; acLon += j.lon[i];
      lat[i] = acLat / 1e5; lon[i] = acLon / 1e5;
    }
    return { titulo: j.titulo, n, lat, lon, dic: j.dic,
             marca: j.marca, tec: j.tec, sop: j.sop, alt: j.alt,
             com: j.com, ban: j.ban, nom: j.nom, sid: j.sid, el: j.el };
  }

  /** Índices dentro de una ventana. Los puntos vienen ordenados por latitud,
      así que una búsqueda binaria acota el barrido sin estructura extra. */
  function enVentana(d, laMin, laMax, loMin, loMax, tope) {
    let lo = 0, hi = d.n;
    while (lo < hi) { const m = (lo + hi) >> 1; d.lat[m] < laMin ? lo = m + 1 : hi = m; }
    const out = [];
    for (let i = lo; i < d.n && d.lat[i] <= laMax; i++) {
      if (d.lon[i] >= loMin && d.lon[i] <= loMax) {
        out.push(i);
        if (tope && out.length >= tope) break;
      }
    }
    return out;
  }

  async function activar(id) {
    const cfg = CAPAS.find((c) => c.id === id);
    if (!cfg) return null;
    let e = estado.get(id);
    if (e && (e.datos || e.cargando)) return e.datos || null;
    e = { cargando: true, datos: null, error: null };
    estado.set(id, e);
    try {
      const resp = await fetch(cfg.archivo);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      e.datos = decodificar(await resp.json());
    } catch (err) {
      e.error = err.message || 'no disponible';
    } finally {
      e.cargando = false;
    }
    return e.datos;
  }

  const datos = (id) => (estado.get(id) || {}).datos || null;
  const info = (id) => estado.get(id) || {};

  /** Ficha legible de un emplazamiento, para el rótulo al pasar el cursor. */
  function ficha(d, i) {
    const marcas = Object.keys(COLOR_MARCA)
      .filter((_, k) => d.marca[i] & (1 << k)).slice(0, 4);
    const tec = ['2G', '3G', '4G', '5G'].filter((_, k) => d.tec[i] & (1 << k));
    return {
      nombre: d.nom[i] || d.sid[i] || '—',
      sid: d.sid[i],
      marcas: marcas.length ? marcas : ['OTROS'],
      tec,
      soporte: d.sop[i] >= 0 ? d.dic.soportes[d.sop[i]] : '—',
      altura: d.alt[i],
      comuna: d.com[i] >= 0 ? d.dic.comunas[d.com[i]] : '',
      bandas: (d.ban[i] || []).map((k) => d.dic.bandas[k]),
      elementos: d.el[i],
      lat: d.lat[i], lon: d.lon[i],
    };
  }

  const marcaDe = (mask) => {
    const claves = Object.keys(COLOR_MARCA);
    for (let k = 0; k < claves.length; k++) if (mask & (1 << k)) return claves[k];
    return 'OTROS';
  };

  return { activar, datos, info, enVentana, ficha, marcaDe };
})();

/* =========================== 7. Mapa =========================== */

/**
 * Fondos cartográficos, todos gratuitos y sin clave de API.
 *   velo: opacidad del velo del color de fondo sobre las teselas. Apaga el
 *         basemap lo justo para que los vanos y los puntos sigan leyéndose.
 *   El crédito es obligatorio por licencia en todos ellos.
 */
const FONDOS = [
  {
    id: 'carto', nombre: 'Mapa claro/oscuro',
    url: {
      claro: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
      oscuro: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    },
    subs: ['a', 'b', 'c', 'd'], retina: true, maxZ: 19, velo: 0,
    credito: '© OpenStreetMap · © CARTO',
  },
  {
    id: 'osm', nombre: 'Calles (OSM)',
    url: { claro: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' },
    maxZ: 19, velo: 0.12,
    credito: '© OpenStreetMap',
  },
  {
    id: 'topo', nombre: 'Topográfico',
    url: { claro: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png' },
    subs: ['a', 'b', 'c'], maxZ: 17, velo: 0.10,
    credito: '© OpenStreetMap · SRTM · OpenTopoMap (CC-BY-SA)',
  },
  {
    id: 'sat', nombre: 'Satélite',
    url: { claro: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}' },
    maxZ: 19, velo: 0.28,
    credito: 'Esri · Maxar · Earthstar Geographics',
  },
  { id: 'ninguno', nombre: 'Sin fondo', url: null, maxZ: 19, velo: 0, credito: '' },
];

const fondoPorId = (id) => FONDOS.find((f) => f.id === id) || FONDOS[0];

function temaOscuro() {
  const t = document.documentElement.getAttribute('data-theme');
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

const Mapa = (function () {
  let cv, ctx, W = 0, H = 0, dpr = 1;
  let escala = 1, cx = 0, cy = 0;            // centro en coordenadas Mercator
  let capas = { candidatos: [], enlaces: [], foco: null };
  let hover = null;
  let listo = false;
  let fondo = fondoPorId('carto');
  let capasVisibles = [];         // marcadores SUBTEL pintados, para el cursor
  const teselas = new Map();                 // "z/x/y" -> {img, estado}
  let usadas = new Set();
  let fallos = 0, aciertos = 0;
  let repintarPedido = false;

  const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));
  const mercLat = (y) => deg(2 * Math.atan(Math.exp(y)) - Math.PI / 2);

  function tema() {
    const cs = getComputedStyle(document.documentElement);
    return {
      fondo: cs.getPropertyValue('--sunken').trim(),
      linea: cs.getPropertyValue('--line').trim(),
      ink3: cs.getPropertyValue('--ink-3').trim(),
      ink: cs.getPropertyValue('--ink').trim(),
      fo: cs.getPropertyValue('--fo').trim(),
      mw: cs.getPropertyValue('--mw').trim(),
      ok: cs.getPropertyValue('--ok').trim(),
      warn: cs.getPropertyValue('--warn').trim(),
      bad: cs.getPropertyValue('--bad').trim(),
    };
  }

  const px = (lon) => W / 2 + (rad(lon) - cx) * escala;
  const py = (lat) => H / 2 - (mercY(lat) - cy) * escala;
  const lonDe = (x) => deg(cx + (x - W / 2) / escala);
  const latDe = (y) => mercLat(cy - (y - H / 2) / escala);

  /* ---------------- capa de teselas ----------------
     El canvas ya está en Web Mercator, así que basta convertir escala (píxeles
     por radián de longitud) al nivel de zoom del esquema de teselas: el mundo
     completo mide 2π·escala píxeles y 256·2^z en el esquema estándar. */
  const TAU = Math.PI * 2;

  function repintarPronto() {
    if (repintarPedido) return;
    repintarPedido = true;
    requestAnimationFrame(() => { repintarPedido = false; pintar(); });
  }

  function urlTesela(z, x, y) {
    const plantilla = fondo.url[temaOscuro() && fondo.url.oscuro ? 'oscuro' : 'claro'];
    const sub = fondo.subs ? fondo.subs[(x + y) % fondo.subs.length] : '';
    return plantilla
      .replace('{s}', sub)
      .replace('{z}', z)
      .replace('{x}', x)
      .replace('{y}', y)
      .replace('{r}', fondo.retina && dpr > 1.4 ? '@2x' : '');
  }

  function tesela(z, x, y) {
    const clave = `${fondo.id}/${temaOscuro() ? 'd' : 'l'}/${z}/${x}/${y}`;
    let t = teselas.get(clave);
    if (t) return t;
    const img = new Image();
    t = { img, estado: 'cargando' };
    teselas.set(clave, t);
    img.onload = () => { t.estado = 'ok'; aciertos++; repintarPronto(); };
    img.onerror = () => { t.estado = 'error'; fallos++; repintarPronto(); };
    img.src = urlTesela(z, x, y);
    return t;
  }

  function pintarFondo(t) {
    if (!fondo.url) return false;
    const z = Math.max(0, Math.min(fondo.maxZ, Math.round(Math.log2((TAU * escala) / 256))));
    const n = Math.pow(2, z);
    const lado = (TAU * escala) / n;               // tamaño en pantalla de cada tesela

    /* rango visible en coordenadas normalizadas del esquema de teselas */
    const xNorm = (xpx) => 0.5 + (cx + (xpx - W / 2) / escala) / TAU;
    const yNorm = (ypx) => 0.5 - (cy - (ypx - H / 2) / escala) / TAU;
    const x0 = Math.floor(xNorm(0) * n), x1 = Math.ceil(xNorm(W) * n);
    const y0 = Math.floor(yNorm(0) * n), y1 = Math.ceil(yNorm(H) * n);
    if (!Number.isFinite(x0) || !Number.isFinite(y0)) return false;

    usadas = new Set();
    let dibujadas = 0;
    ctx.imageSmoothingEnabled = true;
    for (let ty = Math.max(0, y0); ty <= Math.min(n - 1, y1); ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const envuelto = ((tx % n) + n) % n;        // permite cruzar el antimeridiano
        const t2 = tesela(z, envuelto, ty);
        usadas.add(`${fondo.id}/${temaOscuro() ? 'd' : 'l'}/${z}/${envuelto}/${ty}`);
        if (t2.estado !== 'ok') continue;
        /* esquina superior izquierda de la tesela, en las mismas coordenadas
           Mercator que usan px()/py() */
        const lonRad = (tx / n - 0.5) * TAU;
        const mercTop = (0.5 - ty / n) * TAU;
        const sx = W / 2 + (lonRad - cx) * escala;
        const sy = H / 2 - (mercTop - cy) * escala;
        /* +1 px cubre las costuras del redondeo entre teselas contiguas */
        ctx.drawImage(t2.img, Math.round(sx), Math.round(sy),
                      Math.ceil(lado) + 1, Math.ceil(lado) + 1);
        dibujadas++;
      }
    }

    /* la caché no puede crecer sin límite en sesiones largas de navegación */
    if (teselas.size > 700) {
      for (const k of teselas.keys()) if (!usadas.has(k)) teselas.delete(k);
    }

    if (dibujadas && fondo.velo > 0) {
      ctx.globalAlpha = fondo.velo;
      ctx.fillStyle = t.fondo;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
    return dibujadas > 0;
  }

  function limpiarTeselas() {
    teselas.clear();
    fallos = 0;
    aciertos = 0;
  }

  function medir() {
    const r = cv.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    cv.width = W * dpr;
    cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function encuadrar(puntos, margen) {
    const pts = puntos && puntos.length ? puntos : RED;
    let laMin = 90, laMax = -90, loMin = 180, loMax = -180;
    pts.forEach((p) => {
      laMin = Math.min(laMin, p.lat); laMax = Math.max(laMax, p.lat);
      loMin = Math.min(loMin, p.lon); loMax = Math.max(loMax, p.lon);
    });
    /* mercY crece con la latitud: el borde norte es el valor mayor */
    const yNorte = mercY(laMax), ySur = mercY(laMin);
    const xMin = rad(loMin), xMax = rad(loMax);
    const dx = Math.max(1e-9, xMax - xMin), dy = Math.max(1e-9, yNorte - ySur);
    const m = margen == null ? 0.86 : margen;
    escala = Math.min((W * m) / dx, (H * m) / dy);
    cx = (xMin + xMax) / 2;
    cy = (yNorte + ySur) / 2;
    /* Un grupo de nodos muy juntos daría un encuadre de cientos de metros, sin
       contexto alrededor: se limita el acercamiento a un ancho mínimo útil. */
    const MIN_KM = 2.5;
    const minRad = rad(MIN_KM / (111.32 * Math.max(0.25, Math.cos(cy ? rad(mercLat(cy)) : 0))));
    escala = Math.min(escala, W / minRad);
  }

  /** Marcadores de las capas SUBTEL activas, por debajo de la red propia. */
  function pintarCapasSubtel() {
    const laMin = latDe(H), laMax = latDe(0), loMin = lonDe(0), loMax = lonDe(W);
    capasVisibles = [];
    CAPAS.forEach((cfg) => {
      if (!ESTADO.capas[cfg.id]) return;
      const d = Capas.datos(cfg.id);
      if (!d) return;
      const idx = Capas.enVentana(d, laMin, laMax, loMin, loMax, 12000);
      const filtro = ESTADO.marcas;
      /* con mucha densidad el triángulo no aporta y cuesta: se cae a punto */
      const denso = idx.length > 2500;
      const r = denso ? 1.1 : (escala > 400000 ? 4 : 3);
      ctx.globalAlpha = cfg.alfa;
      for (const i of idx) {
        const marca = Capas.marcaDe(d.marca[i]);
        if (filtro && filtro.size && !filtro.has(marca)) continue;
        const x = px(d.lon[i]), y = py(d.lat[i]);
        ctx.fillStyle = COLOR_MARCA[marca] || COLOR_MARCA.OTROS;
        if (denso) {
          ctx.fillRect(x - r, y - r, r * 2, r * 2);
        } else {
          const s = cfg.forma === 'abajo' ? -1 : 1;
          ctx.beginPath();
          ctx.moveTo(x, y - r * s);
          ctx.lineTo(x - r, y + r * 0.75 * s);
          ctx.lineTo(x + r, y + r * 0.75 * s);
          ctx.closePath();
          ctx.fill();
        }
        capasVisibles.push({ capa: cfg, d, i, x, y });
      }
      ctx.globalAlpha = 1;
    });
  }

  /** Marcador SUBTEL bajo el cursor, si hay alguno a tiro. */
  function antenaEn(mx, my) {
    let mejor = null, mejorD = 81;        // 9 px de radio
    for (const m of capasVisibles) {
      const dd = (m.x - mx) ** 2 + (m.y - my) ** 2;
      if (dd < mejorD) { mejorD = dd; mejor = m; }
    }
    return mejor;
  }

  function grilla(t, conFondo) {
    /* de menor a mayor: el primer paso cuya separación supera los 58 px es el
       más fino que aún se lee (al revés siempre ganaría el paso de 10°) */
    const paso = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10]
      .find((p) => (rad(p) * escala) > 58) || 10;
    /* --line no contrasta contra --sunken en tema claro: la retícula se traza
       con el tono de texto terciario a baja opacidad, que funciona en ambos */
    ctx.strokeStyle = t.ink3;
    ctx.fillStyle = t.ink3;
    ctx.lineWidth = 1;
    ctx.font = '9.5px ui-monospace, monospace';
    const alfaLinea = conFondo ? 0.13 : 0.22;      // sobre cartografía, sólo insinuada
    const la0 = latDe(H), la1 = latDe(0);
    for (let la = Math.ceil(la0 / paso) * paso; la <= la1; la += paso) {
      const y = Math.round(py(la)) + 0.5;
      ctx.globalAlpha = alfaLinea; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.globalAlpha = 1;
      if (y < H - 92) etiqueta(`${la.toFixed(paso < 1 ? 2 : 0)}°`, 4, y - 3, t, conFondo);
    }
    const lo0 = lonDe(0), lo1 = lonDe(W);
    for (let lo = Math.ceil(lo0 / paso) * paso; lo <= lo1; lo += paso) {
      const x = Math.round(px(lo)) + 0.5;
      ctx.globalAlpha = alfaLinea; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.globalAlpha = 1;
      etiqueta(`${lo.toFixed(paso < 1 ? 2 : 0)}°`, x + 3, H - 26, t, conFondo);
    }
  }

  /** Texto con contorno del color de fondo, legible también sobre imágenes. */
  function etiqueta(txt, x, y, t, conFondo) {
    if (conFondo) {
      ctx.strokeStyle = t.fondo;
      ctx.lineWidth = 2.5;
      ctx.strokeText(txt, x, y);
    }
    ctx.fillStyle = t.ink3;
    ctx.fillText(txt, x, y);
  }

  /** Crédito de la fuente cartográfica: obligatorio por licencia. */
  function avisarCredito(conFondo) {
    const el = document.getElementById('map-credito');
    if (!el) return;
    if (conFondo) {
      el.textContent = fondo.credito;
    } else if (fondo.url && fallos > 0 && aciertos === 0) {
      el.textContent = 'Sin fondo cartográfico: no hay acceso a las teselas';
    } else {
      el.textContent = '';
    }
    el.style.visibility = el.textContent ? 'visible' : 'hidden';
  }

  function escalaGrafica(t, conFondo) {
    const kmPorPx = (haversine(latDe(H / 2), lonDe(0), latDe(H / 2), lonDe(100))) / 100;
    const objetivo = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000]
      .find((k) => k / kmPorPx > 60) || 1000;
    const largo = objetivo / kmPorPx;
    const x = W - largo - 16, y = H - 30;       // el crédito ocupa el borde inferior
    ctx.lineWidth = conFondo ? 3.5 : 1.5;
    ctx.strokeStyle = conFondo ? t.fondo : t.ink;
    const trazo = () => {
      ctx.beginPath();
      ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + largo, y); ctx.lineTo(x + largo, y - 4);
      ctx.stroke();
    };
    if (conFondo) { trazo(); ctx.strokeStyle = t.ink; ctx.lineWidth = 1.5; }
    trazo();
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    const rotulo = objetivo < 1 ? `${objetivo * 1000} m` : `${objetivo} km`;
    if (conFondo) {
      ctx.strokeStyle = t.fondo; ctx.lineWidth = 3;
      ctx.strokeText(rotulo, x + largo / 2, y - 6);
    }
    ctx.fillStyle = t.ink;
    ctx.fillText(rotulo, x + largo / 2, y - 6);
    ctx.textAlign = 'left';
  }

  function pintar() {
    if (!listo) return;
    const t = tema();
    ctx.fillStyle = t.fondo;
    ctx.fillRect(0, 0, W, H);
    const conFondo = pintarFondo(t);
    grilla(t, conFondo);
    avisarCredito(conFondo);

    pintarCapasSubtel();

    /* sitios de red: intensidad por tecnología más alta presente */
    const r = escala > 900000 ? 2.6 : escala > 250000 ? 1.9 : 1.35;
    for (const s of RED) {
      const x = px(s.lon), y = py(s.lat);
      if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
      /* sobre cartografía los puntos necesitan más cuerpo para no perderse */
      ctx.globalAlpha = s.techMask & 8 ? 0.95 : s.techMask & 4 ? (conFondo ? 0.8 : 0.6) : (conFondo ? 0.55 : 0.34);
      ctx.fillStyle = s.techMask & 8 ? t.mw : t.ink3;
      ctx.beginPath();
      ctx.arc(x, y, conFondo ? r + 0.5 : r, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* enlaces evaluados: la fibra sigue su traza real cuando se pudo medir */
    capas.enlaces.forEach((e) => {
      ctx.strokeStyle = e.medio === 'fo' ? t.fo : t.mw;
      ctx.lineWidth = e.principal ? 2 : 1;
      ctx.globalAlpha = e.principal ? 0.95 : 0.42;
      const trazada = e.traza && e.traza.length > 1;
      if (e.medio === 'fo' && !trazada) ctx.setLineDash([5, 3]);
      ctx.beginPath();
      if (trazada) {
        e.traza.forEach(([la, lo], i) => {
          const x = px(lo), y = py(la);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
      } else {
        ctx.moveTo(px(e.a.lon), py(e.a.lat));
        ctx.lineTo(px(e.b.lon), py(e.b.lat));
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });
    ctx.globalAlpha = 1;

    /* nodos destacados */
    capas.nodos && capas.nodos.forEach((s) => {
      const x = px(s.lon), y = py(s.lat);
      ctx.strokeStyle = t.mw; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 5, 0, 6.2832); ctx.stroke();
    });

    /* candidatos */
    capas.candidatos.forEach((c) => {
      const x = px(c.lon), y = py(c.lat);
      const col = c.grade === 'ok' ? t.ok : c.grade === 'warn' ? t.warn : c.grade === 'bad' ? t.bad : t.ink;
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 6.2832); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 11, y); ctx.lineTo(x - 4, y);
      ctx.moveTo(x + 4, y); ctx.lineTo(x + 11, y);
      ctx.moveTo(x, y - 11); ctx.lineTo(x, y - 4);
      ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 11);
      ctx.stroke();
      if (c.nombre && escala > 60000) {
        ctx.fillStyle = t.ink;
        ctx.font = '600 10.5px ui-monospace, monospace';
        ctx.fillText(c.nombre, x + 12, y - 8);
      }
    });

    escalaGrafica(t, conFondo);

    if (hover) {
      const x = px(hover.lon), y = py(hover.lat);
      ctx.fillStyle = t.ink;
      ctx.strokeStyle = t.fondo; ctx.lineWidth = 3;
      ctx.font = '600 11px ui-monospace, monospace';
      const txt = `${hover.id} · ${hover.comuna || ''}`;
      ctx.strokeText(txt, x + 9, y + 4);
      ctx.fillText(txt, x + 9, y + 4);
      ctx.strokeStyle = t.ink; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 6.2832); ctx.stroke();
    }
  }

  function sitioEn(x, y) {
    let mejor = null, mejorD = 12;
    for (const s of RED) {
      const dx = px(s.lon) - x, dy = py(s.lat) - y;
      const d = Math.hypot(dx, dy);
      if (d < mejorD) { mejorD = d; mejor = s; }
    }
    return mejor;
  }

  function init(canvas, alHacerClic) {
    cv = canvas;
    ctx = cv.getContext('2d');
    listo = true;
    medir();
    encuadrar(RED);
    pintar();

    let arrastre = null;
    cv.addEventListener('pointerdown', (e) => {
      arrastre = { x: e.clientX, y: e.clientY, cx, cy, movido: false };
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      if (arrastre) {
        const dx = e.clientX - arrastre.x, dy = e.clientY - arrastre.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) arrastre.movido = true;
        cx = arrastre.cx - dx / escala;
        cy = arrastre.cy + dy / escala;
        pintar();
        return;
      }
      const s = sitioEn(mx, my);
      if (s !== hover) { hover = s; pintar(); }
      const out = document.getElementById('map-readout');
      if (out) {
        let extra = s ? `\n${s.id} · ${s.nombre}` : '';
        if (!s) {
          const a = antenaEn(mx, my);
          if (a) {
            const f = Capas.ficha(a.d, a.i);
            extra = `\n${f.marcas.join('/')} · ${f.nombre}` +
              `\n${f.soporte}${f.altura ? ` ${f.altura} m` : ''}` +
              `${f.tec.length ? ` · ${f.tec.join(' ')}` : ''}` +
              `${f.comuna ? `\n${f.comuna}` : ''}` +
              `${f.bandas.length ? `\n${f.bandas.join('/')} MHz` : ''}` +
              `\n${a.capa.nombre}`;
          }
        }
        out.textContent = `${latDe(my).toFixed(5)}°  ${lonDe(mx).toFixed(5)}°` + extra;
        out.style.visibility = 'visible';
      }
    });
    cv.addEventListener('pointerup', (e) => {
      const movido = arrastre && arrastre.movido;
      arrastre = null;
      if (movido) return;
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const s = sitioEn(mx, my);
      alHacerClic(s, latDe(my), lonDe(mx));
    });
    cv.addEventListener('pointerleave', () => {
      hover = null;
      const out = document.getElementById('map-readout');
      if (out) out.style.visibility = 'hidden';
      pintar();
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const laA = latDe(my), loA = lonDe(mx);
      const k = Math.exp(-e.deltaY * 0.0016);
      escala = Math.max(2000, Math.min(4e7, escala * k));
      cx += rad(loA) - (cx + (mx - W / 2) / escala);
      cy += mercY(laA) - (cy - (my - H / 2) / escala);
      pintar();
    }, { passive: false });

    new ResizeObserver(() => { medir(); pintar(); }).observe(cv);
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const alCambiarTema = () => {
      if (fondo.url && fondo.url.oscuro) limpiarTeselas();
      pintar();
    };
    mq.addEventListener && mq.addEventListener('change', alCambiarTema);
    new MutationObserver(alCambiarTema).observe(document.documentElement,
      { attributes: true, attributeFilter: ['data-theme'] });
  }

  return {
    init,
    pintar,
    async alternarCapa(id, encendida) {
      ESTADO.capas[id] = encendida;
      if (encendida) await Capas.activar(id);
      pintar();
      return Capas.info(id);
    },
    fijarMarcas(set) { ESTADO.marcas = set; pintar(); },
    fijarFondo(id) {
      const nuevo = fondoPorId(id);
      if (nuevo === fondo) return;
      fondo = nuevo;
      limpiarTeselas();
      pintar();
    },
    fijar(nuevas) { capas = Object.assign({ candidatos: [], enlaces: [], nodos: [] }, nuevas); pintar(); },
    encuadrarEn(puntos, margen) { if (listo) { encuadrar(puntos, margen); pintar(); } },
    verTodo() { if (listo) { encuadrar(RED); pintar(); } },
  };
})();

/* =========================== 8. Interfaz =========================== */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function fmt(n, d) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('es-CL', { minimumFractionDigits: d, maximumFractionDigits: d });
}
const fmtAnt = (d) => `${fmt(d, 1)} m`;
const fmtMiles = (n) => (n == null || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('es-CL'));

function fmtDisp(p) {
  if (p == null) return '—';
  if (p >= 99.9999) return '99,9999 %';
  return `${p.toLocaleString('es-CL', { minimumFractionDigits: 3, maximumFractionDigits: 4 })} %`;
}

const ETIQUETA = { ok: 'Factible', warn: 'Condicionada', bad: 'No factible', none: '—' };

/* ---- estado ---- */

const PARAMS_DEFECTO = {
  nNodos: 8,
  alturaCandidato: 30,
  alturaDefecto: 25,
  capacidad: 300,
  disponibilidad: 99.99,
  antenaMax: 1.8,
  polarizacion: 'V',
  xpic: false,
  perdidasFijas: 2,
  kRefraccion: 1.333,
  fraccionFresnel: 0.6,
  clutter: 3,
  fRef: 18,
  dN1: -300,
  R001: 24,
  autoLluvia: true,
  sinuosidadUrbana: 1.4,
  sinuosidadRural: 1.25,
  costoUrbano: 25000,
  costoRural: 12000,
  foVerdeKm: 3,
  foAmbarKm: 8,
  bandas: BANDAS.map((b) => b.id),
  fondo: 'carto',
  ruteo: true,
  altimetria: true,
};

const ESTADO = {
  params: Object.assign({}, PARAMS_DEFECTO),
  modo: 'sitio',
  resultados: [],
  nodosFO: new Set(),
  orden: { col: 'km', asc: true },
  seleccion: 0,
  capas: { servicio: false, autorizadas: false },
  marcas: new Set(),                 // vacío = todas las marcas
};

const LS = 'factibilidad.v1';
function guardar() {
  try {
    localStorage.setItem(LS, JSON.stringify({
      params: ESTADO.params, nodosFO: Array.from(ESTADO.nodosFO),
      capas: ESTADO.capas, marcas: Array.from(ESTADO.marcas),
    }));
  } catch (e) { /* almacenamiento no disponible */ }
}
function restaurar() {
  try {
    const raw = localStorage.getItem(LS);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (d.params) Object.assign(ESTADO.params, d.params);
    if (d.nodosFO) ESTADO.nodosFO = new Set(d.nodosFO);
    if (d.capas) Object.assign(ESTADO.capas, d.capas);
    if (d.marcas) ESTADO.marcas = new Set(d.marcas);
  } catch (e) { /* estado corrupto: se ignora */ }
}

let temporizadorToast;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(temporizadorToast);
  temporizadorToast = setTimeout(() => el.classList.remove('show'), 2600);
}

/* ---- construcción de parámetros efectivos ---- */

function paramsPara(lat, lon) {
  const P = Object.assign({}, ESTADO.params);
  if (P.autoLluvia) {
    const reg = regionDe(lat, lon);
    P.R001 = (REGIONES[reg] && REGIONES[reg].R) || P.R001;
    P.region = reg;
  }
  return P;
}

/* ---- ejecución del análisis ---- */

function leerCotas() {
  const v = (id) => {
    const el = $(id);
    if (!el || el.value.trim() === '') return null;
    const n = parseFloat(el.value);
    return Number.isFinite(n) ? n : null;
  };
  const cotaA = v('#cotaA'), cotaB = v('#cotaB'), cotaObs = v('#cotaObs'), dObs = v('#dObs');
  if (cotaA == null || cotaB == null || cotaObs == null) return null;
  return { cotaA, cotaB, cotaObs, dObsKm: dObs || 0 };
}

function ejecutar() {
  const modo = ESTADO.modo;
  ESTADO.resultados = [];

  if (modo === 'sitio') {
    const lat = parseCoord($('#lat').value), lon = parseCoord($('#lon').value);
    const orden = ordenarLatLon(lat, lon);
    if (!orden || !validar(orden)) { toast('Revisa las coordenadas del punto candidato.'); return; }
    const nombre = $('#nombre').value.trim() || 'Candidato';
    const P = paramsPara(orden.lat, orden.lon);
    const cand = {
      nombre, lat: orden.lat, lon: orden.lon,
      alt: parseFloat($('#alturaCand').value) || P.alturaCandidato,
    };
    const res = analizarSitio(cand, P);
    if (!res) { toast('No hay sitios de red en el radio de búsqueda.'); return; }
    ESTADO.resultados = [Object.assign(res, { P, tipo: 'sitio' })];
  }

  if (modo === 'enlace') {
    const A = ordenarLatLon(parseCoord($('#latA').value), parseCoord($('#lonA').value));
    const B = ordenarLatLon(parseCoord($('#latB').value), parseCoord($('#lonB').value));
    if (!A || !validar(A) || !B || !validar(B)) { toast('Revisa las coordenadas de los extremos A y B.'); return; }
    const P = paramsPara((A.lat + B.lat) / 2, (A.lon + B.lon) / 2);
    const cotas = leerCotas();
    const extA = { nombre: $('#nombreA').value.trim() || 'Extremo A', lat: A.lat, lon: A.lon,
                   alt: parseFloat($('#alturaA').value) || P.alturaCandidato };
    const extB = { nombre: $('#nombreB').value.trim() || 'Extremo B', lat: B.lat, lon: B.lon,
                   alt: parseFloat($('#alturaB').value) || P.alturaCandidato };
    const mw = analizarMMOO(extA, extB, P, cotas);
    const fo = analizarFO(extA.lat, extA.lon, extremoComoNodo(extB, P), P);
    ESTADO.resultados = [{ tipo: 'enlace', P, A: extA, B: extB, mw, fo,
                           alternativas: alternativasDeEnlace(extA, extB, P) }];
  }

  if (modo === 'lote') {
    const { filas, errores } = parsearLote($('#lote').value);
    if (!filas.length) {
      toast(errores.length ? errores[0] : 'No hay filas que analizar.');
      renderErrores(errores);
      return;
    }
    ESTADO.resultados = filas.map((f) => {
      const P = paramsPara(f.lat, f.lon);
      if (f.latB != null) {
        const A = { nombre: f.refA ? f.refA.id : `${f.nombre} · A`, lat: f.lat, lon: f.lon,
                    alt: f.alt || P.alturaCandidato, id: f.refA ? f.refA.id : null };
        const B = { nombre: f.refB ? f.refB.id : 'punto B', lat: f.latB, lon: f.lonB,
                    alt: f.altB || P.alturaCandidato, id: f.refB ? f.refB.id : null };
        const mw = analizarMMOO(A, B, P, null);
        return {
          tipo: 'enlace', nombre: f.nombre, P, A, B, mw,
          fo: analizarFO(A.lat, A.lon, extremoComoNodo(B, P), P),
          alternativas: alternativasDeEnlace(A, B, P),
        };
      }
      const cand = { nombre: f.nombre, lat: f.lat, lon: f.lon,
                     alt: f.alt || P.alturaCandidato, cotas: null, id: f.ref ? f.ref.id : null };
      const res = analizarSitio(cand, P);
      return res ? Object.assign(res, { P, tipo: 'sitio', nombre: f.nombre }) : null;
    }).filter(Boolean);
    renderErrores(errores);
    if (errores.length) toast(`${ESTADO.resultados.length} filas analizadas · ${errores.length} con problemas.`);
  }

  ESTADO.seleccion = 0;
  render();
  medirTendidos();
  medirPerfiles();
}

/* ---- controles de las capas SUBTEL ---- */

function montarControlesCapas() {
  const cont = $('#capas-toggles');
  cont.innerHTML = CAPAS.map((c) => `
    <label data-capa="${c.id}" data-activa="${ESTADO.capas[c.id] ? 1 : 0}">
      <input type="checkbox" ${ESTADO.capas[c.id] ? 'checked' : ''}>
      <span class="glifo">${c.forma === 'abajo' ? '▽' : '▲'}</span>${c.nombre}
    </label>`).join('');

  cont.querySelectorAll('label').forEach((lab) => {
    const id = lab.dataset.capa;
    lab.querySelector('input').addEventListener('change', async (e) => {
      const on = e.target.checked;
      lab.dataset.activa = on ? 1 : 0;
      if (on) avisarCapas('cargando');
      const info = await Mapa.alternarCapa(id, on);
      guardar();
      if (on && info && info.error) {
        e.target.checked = false;
        lab.dataset.activa = 0;
        ESTADO.capas[id] = false;
        Mapa.pintar();
        avisarCapas('error', info.error);
      } else {
        avisarCapas('listo');
      }
    });
  });

  const marcas = $('#capas-marcas');
  marcas.innerHTML = Object.keys(COLOR_MARCA)
    .filter((m) => m !== 'BORDER')
    .map((m) => `
      <label data-marca="${m}" data-activa="${ESTADO.marcas.has(m) ? 1 : 0}">
        <input type="checkbox" ${ESTADO.marcas.has(m) ? 'checked' : ''}>
        <span class="pip" style="background:${COLOR_MARCA[m]}"></span>${m}
      </label>`).join('');
  marcas.querySelectorAll('label').forEach((lab) => {
    lab.querySelector('input').addEventListener('change', (e) => {
      const m = lab.dataset.marca;
      e.target.checked ? ESTADO.marcas.add(m) : ESTADO.marcas.delete(m);
      lab.dataset.activa = e.target.checked ? 1 : 0;
      Mapa.fijarMarcas(ESTADO.marcas);
      avisarCapas('listo');
      guardar();
    });
  });
}

function avisarCapas(estado, detalle) {
  const el = $('#capas-estado');
  if (!el) return;
  if (estado === 'cargando') { el.textContent = 'cargando capa…'; return; }
  if (estado === 'error') {
    el.textContent = `capa no disponible (${detalle}). Se sirven desde el sitio publicado; ` +
      'abriendo el archivo desde el disco el navegador no permite leerlas.';
    return;
  }
  const partes = CAPAS.filter((c) => ESTADO.capas[c.id]).map((c) => {
    const d = Capas.datos(c.id);
    return d ? `${d.n.toLocaleString('es-CL')} ${c.nombre.toLowerCase()}` : null;
  }).filter(Boolean);
  el.textContent = partes.length
    ? `${partes.join(' · ')}${ESTADO.marcas.size ? ` · filtrado a ${ESTADO.marcas.size} marca(s)` : ''}`
    : 'sin marcas = todas';
}

/* ---- medición del tendido por la red viaria ---- */

/* Cada análisis lleva un testigo: si el usuario lanza otro mientras las rutas
   viajan, las respuestas viejas se descartan en vez de pisar la pantalla. */
let testigoRutas = 0;

async function enLotes(items, tamano, fn) {
  for (let i = 0; i < items.length; i += tamano) {
    await Promise.all(items.slice(i, i + tamano).map(fn));
  }
}

/**
 * Sustituye las longitudes estimadas por las medidas sobre calles. Corre
 * después de pintar, así el veredicto aparece de inmediato y se afina solo.
 */
async function medirTendidos() {
  if (!ESTADO.params.ruteo || !Ruteo.activo) return;
  const mio = ++testigoRutas;
  const pendientes = [];

  ESTADO.resultados.forEach((res) => {
    if (res.tipo === 'sitio') {
      /* el resultado en pantalla se mide entero; los demás, sólo su mejor nodo */
      const activo = res === ESTADO.resultados[Math.min(ESTADO.seleccion, ESTADO.resultados.length - 1)];
      const objetivo = activo ? res.filas : [res.mejorFO];
      objetivo.forEach((fila) => pendientes.push({
        a: res.cand, b: fila.sitio, P: res.P,
        aplicar: (r) => { fila.fo = analizarFO(res.cand.lat, res.cand.lon, fila.sitio, res.P, r); },
      }));
    } else {
      pendientes.push({
        a: res.A, b: res.B, P: res.P,
        aplicar: (r) => { res.fo = analizarFO(res.A.lat, res.A.lon, extremoComoNodo(res.B, res.P), res.P, r); },
      });
      (res.alternativas || []).forEach((alt) => pendientes.push({
        a: alt.desde, b: alt.sitio, P: res.P,
        aplicar: (r) => { alt.fo = analizarFO(alt.desde.lat, alt.desde.lon, alt.sitio, res.P, r); },
      }));
    }
  });

  if (!pendientes.length) return;
  let medidas = 0;
  await enLotes(pendientes, 3, async (t) => {
    const r = await Ruteo.ruta(t.a, t.b);
    if (mio !== testigoRutas) return;          // llegó tarde: otro análisis manda
    if (r) { t.aplicar(r); medidas++; }
  });
  if (mio !== testigoRutas) return;

  if (medidas) {
    /* medir puede cambiar cuál nodo es el mejor por fibra */
    ESTADO.resultados.forEach((res) => {
      if (res.tipo !== 'sitio') return;
      res.mejorFO = res.filas.reduce((a, b) =>
        PESO_GRADO[b.fo.grade] < PESO_GRADO[a.fo.grade] ||
        (b.fo.grade === a.fo.grade && b.fo.rutaKm < a.fo.rutaKm) ? b : a);
    });
    render();
  }
  avisarRuteo(medidas, pendientes.length);
}

/* ---- resolución del despeje con altimetría ---- */

let testigoPerfiles = 0;

/**
 * Pide el perfil del vano principal del resultado en pantalla y recalcula su
 * despeje. Sólo el vano mostrado: el servicio admite una llamada por segundo,
 * así que perfilar los ocho nodos de una vez tardaría ocho segundos sin que
 * nadie lo esté mirando. Los demás se perfilan al pinchar su fila.
 */
async function medirPerfiles() {
  if (!ESTADO.params.altimetria || !Altimetria.activo) return;
  const mio = ++testigoPerfiles;
  const res = ESTADO.resultados[Math.min(ESTADO.seleccion, ESTADO.resultados.length - 1)];
  if (!res) return;

  const vano = res.tipo === 'sitio'
    ? (res.mejorMW ? { A: res.cand, B: res.mejorMW.sitio, fila: res.mejorMW } : null)
    : { A: res.A, B: res.B, fila: null };
  if (!vano) return;

  avisarPerfil('midiendo');
  const p = await Altimetria.perfil(vano.A, vano.B);
  if (mio !== testigoPerfiles) return;
  if (!p) { avisarPerfil('sin servicio'); return; }

  aplicarPerfil(res, vano, p);
  render();
  avisarPerfil('listo', p);

  /* Si el nodo más conveniente no tiene línea de vista, la pregunta pasa a ser
     cuál sí la tiene: se siguen perfilando los siguientes por distancia, con
     tope, para no encadenar llamadas indefinidamente. */
  if (res.tipo === 'sitio' && res.mejorMW.mw.geo.los !== 'ok') {
    const cola = res.filas
      .filter((f) => !f.perfil && f.mw.recomendada)
      .sort((a, b) => a.km - b.km)
      .slice(0, 4);
    for (const fila of cola) {
      if (mio !== testigoPerfiles) return;
      avisarPerfil('buscando');
      const q = await Altimetria.perfil(res.cand, fila.sitio);
      if (mio !== testigoPerfiles) return;
      if (!q) break;
      aplicarPerfil(res, { A: res.cand, B: fila.sitio, fila }, q);
      render();
      if (res.mejorMW.mw.geo.los === 'ok') break;
    }
    avisarPerfil('listo', p);
  }
}

/** Recalcula el análisis de radio de un vano con su perfil ya medido. */
function aplicarPerfil(res, vano, p) {
  const P = res.P;
  if (res.tipo === 'sitio') {
    vano.fila.mw = analizarMMOO(
      { lat: res.cand.lat, lon: res.cand.lon, alt: res.cand.alt || P.alturaCandidato },
      vano.B, P, null, p);
    vano.fila.perfil = p;
    /* Reelegir comparando un vano con despeje resuelto contra otros que siguen
       en terreno plano sería comparar peras con manzanas, y además ocultaría el
       hallazgo: la elección se hace sólo entre los que ya tienen perfil. */
    const perfilados = res.filas.filter((f) => f.perfil);
    res.mejorMW = perfilados.reduce((a, b) => {
      const da = PESO_GRADO[a.mw.grade], db = PESO_GRADO[b.mw.grade];
      if (db !== da) return db < da ? b : a;
      return b.km < a.km ? b : a;
    });
  } else {
    res.mw = analizarMMOO(res.A, res.B, P, res.cotas || null, p);
    res.perfil = p;
  }
}

/** Perfil de un vano concreto, a pedido al pinchar su fila en la tabla. */
async function perfilarFila(res, fila) {
  if (!ESTADO.params.altimetria || !Altimetria.activo || fila.perfil) return;
  const mio = ++testigoPerfiles;
  avisarPerfil('midiendo');
  const p = await Altimetria.perfil(res.cand, fila.sitio);
  if (mio !== testigoPerfiles || !p) { avisarPerfil(p ? 'listo' : 'sin servicio'); return; }
  fila.mw = analizarMMOO(
    { lat: res.cand.lat, lon: res.cand.lon, alt: res.cand.alt || res.P.alturaCandidato },
    fila.sitio, res.P, null, p);
  fila.perfil = p;
  render();
  avisarPerfil('listo', p);
}

function avisarPerfil(estado, p) {
  const el = $('#estado-perfil');
  if (!el) return;
  el.textContent = {
    midiendo: 'midiendo perfil de terreno…',
    buscando: 'buscando un nodo con línea de vista…',
    'sin servicio': 'despeje sin perfil: no hubo respuesta del servicio de altimetría',
    listo: p ? `despeje resuelto sobre ${p.fuente}, ${p.muestras} muestras` : '',
  }[estado] || '';
}

function avisarRuteo(medidas, total) {
  const el = $('#estado-ruteo');
  if (!el) return;
  if (!ESTADO.params.ruteo) { el.textContent = 'Tendidos estimados por sinuosidad (ruteo desactivado).'; return; }
  if (!medidas) {
    el.textContent = 'Tendidos estimados por sinuosidad: no hubo respuesta del servicio de ruteo.';
  } else if (medidas < total) {
    el.textContent = `${medidas} de ${total} tendidos medidos por calles; el resto, estimados (*).`;
  } else {
    el.textContent = `${medidas} tendidos medidos sobre la red viaria.`;
  }
}

/* ---- render ---- */

function renderErrores(errores) {
  const box = $('#lote-errores');
  if (!box) return;
  if (!errores || !errores.length) { box.innerHTML = ''; box.style.display = 'none'; return; }
  box.style.display = 'block';
  box.innerHTML = `<div class="hint" style="color:var(--bad)">${errores.slice(0, 6)
    .map((e) => e.replace(/&/g, '&amp;').replace(/</g, '&lt;')).join('<br>')}${
    errores.length > 6 ? `<br>… y ${errores.length - 6} más.` : ''}</div>`;
}

function render() {
  const res = ESTADO.resultados;
  $('#resumen-lote').style.display = res.length > 1 ? 'block' : 'none';
  if (!res.length) {
    $('#veredictos').innerHTML = '';
    $('#detalle').innerHTML = '<div class="empty">Ingresa un punto y pulsa Analizar.</div>';
    Mapa.fijar({});
    return;
  }
  if (res.length > 1) renderResumenLote(res);
  const activo = res[Math.min(ESTADO.seleccion, res.length - 1)];
  if (activo.tipo === 'sitio') renderSitio(activo); else renderEnlace(activo);
}

function gradeChip(g) {
  return `<span class="grade" data-grade="${g}">${ETIQUETA[g] || g}</span>`;
}

function renderSitio(res) {
  const { cand, mejorFO, mejorMW, P } = res;
  const rec = recomendacion(res);
  const f = mejorFO.fo, m = mejorMW.mw;

  $('#veredictos').innerHTML = `
    <article class="verdict fo" data-grade="${f.grade}">
      <div class="verdict-head"><span class="medium">Fibra óptica</span>${gradeChip(f.grade)}</div>
      <div class="headline">${fmt(f.rutaKm, 2)} km de tendido → ${f.nodo.id}</div>
      <p class="because">${f.why}</p>
      <div class="kv">
        <div><span class="k">Línea recta</span><span class="v">${fmt(f.km, 2)} km</span></div>
        <div><span class="k">${f.medida ? 'Sinuosidad real' : 'Sinuosidad'}</span><span class="v">×${fmt(f.sinuosidad, 2)}</span></div>
        <div><span class="k">Costo estimado</span><span class="v">USD ${fmtMiles(f.costo)}</span></div>
        <div><span class="k">FO en nodo</span><span class="v">${f.fo.nivel} (${f.fo.score})</span></div>
      </div>
    </article>
    <article class="verdict mw" data-grade="${m.grade}">
      <div class="verdict-head"><span class="medium">Microondas</span>${gradeChip(m.grade)}</div>
      <div class="headline">${fmt(m.dKm, 2)} km → ${mejorMW.sitio.id}${
        m.recomendada ? ` · ${m.recomendada.banda.id}` : ''}</div>
      <p class="because">${m.why}</p>
      <div class="kv">
        <div><span class="k">Banda</span><span class="v">${m.recomendada ? m.recomendada.banda.id : '—'}</span></div>
        <div><span class="k">Antena</span><span class="v">${m.recomendada ? fmtAnt(m.recomendada.antena) : '—'}</span></div>
        <div><span class="k">Disponibilidad</span><span class="v">${m.recomendada ? fmtDisp(m.recomendada.disponibilidad) : '—'}</span></div>
        <div><span class="k">Despeje req.</span><span class="v">${fmt(m.geo.requerido, 1)} m</span></div>
      </div>
    </article>`;

  const filas = ordenarFilas(res.filas);
  $('#detalle').innerHTML = `
    <div class="panel">
      <div class="panel-head">
        <h3>Recomendación</h3>
        <div class="spacer"></div>
        ${gradeChip(rec.grade)}
      </div>
      <div class="panel-body" style="display:flex;flex-direction:column;gap:6px">
        <div style="font-family:var(--mono);font-size:var(--fs-lead);font-weight:600">${rec.medio}</div>
        <p style="margin:0;color:var(--ink-2);font-size:var(--fs-label)">${rec.texto}</p>
        <div class="kv" style="margin-top:4px">
          <div><span class="k">Candidato</span><span class="v">${esc(cand.nombre)}</span></div>
          <div><span class="k">Coordenadas</span><span class="v">${fmt(cand.lat, 5)}, ${fmt(cand.lon, 5)}</span></div>
          <div><span class="k">Torre asumida</span><span class="v">${fmt(cand.alt || P.alturaCandidato, 0)} m</span></div>
          <div><span class="k">Región / lluvia</span><span class="v">${P.region || '—'} · ${fmt(P.R001, 0)} mm/h</span></div>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head">
        <h3>Nodos de red evaluados</h3>
        <div class="spacer"></div>
        <span class="hint">${filas.length} más cercanos · clic para ver el vano</span>
        <span class="hint" id="estado-ruteo"></span>
        <span class="hint" id="estado-perfil"></span>
        <button class="ghost" id="csv-nodos">Exportar CSV</button>
      </div>
      <div class="tablewrap">
        <table class="dense">
          <thead><tr>
            ${th('km', 'km', 'num')}
            <th>Código</th><th>Nombre</th><th>Comuna</th>
            <th class="num">Az.</th><th class="num">Alt.</th><th>Tec.</th>
            ${th('fo', 'FO', '')}${th('foKm', 'FO km', 'num')}<th class="num">USD</th>
            ${th('mw', 'MMOO', '')}<th>Despeje</th><th>Banda</th><th class="num">Ant.</th>
            ${th('disp', 'Disp.', 'num')}<th class="num">Margen</th>
          </tr></thead>
          <tbody>${filas.map((r, i) => filaNodo(r, cand, i)).join('')}</tbody>
        </table>
      </div>
    </div>

    ${panelVano(cand, mejorMW.sitio, mejorMW.mw, P)}`;

  enlazarTabla(res);

  Mapa.fijar({
    candidatos: [{ lat: cand.lat, lon: cand.lon, nombre: cand.nombre, grade: rec.grade }],
    nodos: res.filas.map((r) => r.sitio),
    enlaces: [
      { a: cand, b: f.nodo, medio: 'fo', principal: true, traza: f.traza },
      { a: cand, b: mejorMW.sitio, medio: 'mw', principal: true },
      ...res.filas.filter((r) => r.sitio !== f.nodo && r.sitio !== mejorMW.sitio)
        .map((r) => ({ a: cand, b: r.sitio, medio: 'mw', principal: false })),
    ],
  });
  Mapa.encuadrarEn([cand, ...res.filas.map((r) => r.sitio)], 0.7);
}

function th(key, label, cls) {
  const act = ESTADO.orden.col === key;
  return `<th class="sortable ${cls}" data-sort="${key}">${label}${act ? (ESTADO.orden.asc ? ' ↑' : ' ↓') : ''}</th>`;
}

function ordenarFilas(filas) {
  const { col, asc } = ESTADO.orden;
  const val = (r) => ({
    km: r.km,
    fo: PESO_GRADO[r.fo.grade],
    foKm: r.fo.rutaKm,
    mw: PESO_GRADO[r.mw.grade],
    disp: r.mw.recomendada ? -r.mw.recomendada.disponibilidad : 1e9,
  }[col] ?? r.km);
  return filas.slice().sort((a, b) => (asc ? val(a) - val(b) : val(b) - val(a)));
}

/* El origen del despeje se declara en la tabla: comparar un vano resuelto sobre
   perfil con otro que sigue en terreno plano sin decirlo sería engañoso. */
const despejeTxt = (m) => {
  const g = m.geo;
  if (g.fuente === 'perfil') return `SRTM ${g.los}`;
  if (g.fuente === 'cotas') return `cotas ${g.los}`;
  return g.losPlano ? 'plano alcanza' : 'plano no alcanza';
};

function celdaDespeje(m) {
  const g = m.geo;
  const punto = { ok: 'ok', marginal: 'warn', insuficiente: 'bad' }[g.los] || 'none';
  const txt = g.fuente === 'cotas' ? { ok: 'cotas ok', marginal: 'cotas marginal', insuficiente: 'cotas corta' }[g.los]
            : g.fuente === 'perfil' ? { ok: 'SRTM ok', marginal: 'SRTM marginal', insuficiente: 'SRTM corta' }[g.los]
            : 'plano';
  return `<td><span class="dot ${punto}"></span>${txt}</td>`;
}

function filaNodo(r, cand, i) {
  const s = r.sitio, m = r.mw, f = r.fo;
  const az = azimut(cand.lat, cand.lon, s.lat, s.lon);
  const tecs = TECH_BITS.map(([t, b]) =>
    `<span class="${s.techMask & b ? 'on' : ''}">${t}</span>`).join('');
  return `<tr data-nodo="${esc(s.id)}" class="${i === 0 ? 'picked' : ''}">
    <td class="num strong">${fmt(r.km, 2)}</td>
    <td class="strong">${esc(s.id)}</td>
    <td class="name">${esc(s.nombre)}</td>
    <td>${esc(s.comuna || '—')}</td>
    <td class="num">${fmt(az, 0)}° ${rumbo(az)}</td>
    <td class="num">${s.alt ? fmt(s.alt, 0) : '—'}</td>
    <td><span class="techs">${tecs}</span></td>
    <td><span class="dot ${f.grade}"></span>${f.fo.nivel}</td>
    <td class="num">${fmt(f.rutaKm, 2)}${f.medida ? '' : '*'}</td>
    <td class="num">${fmtMiles(f.costo)}</td>
    <td><span class="dot ${m.grade}"></span>${ETIQUETA[m.grade]}</td>
    ${celdaDespeje(m)}
    <td>${m.recomendada ? m.recomendada.banda.id : '—'}</td>
    <td class="num">${m.recomendada ? fmtAnt(m.recomendada.antena) : '—'}</td>
    <td class="num">${m.recomendada ? fmtDisp(m.recomendada.disponibilidad) : '—'}</td>
    <td class="num">${m.recomendada ? `${fmt(m.recomendada.margen, 1)} dB` : '—'}</td>
  </tr>`;
}

/** Fila de la tabla de alternativas de un enlace. */
function filaAlternativa(r) {
  const s = r.sitio, m = r.mw, f = r.fo;
  const az = azimut(r.desde.lat, r.desde.lon, s.lat, s.lon);
  return `<tr>
    <td class="strong">${r.extremo}</td>
    <td class="num strong">${fmt(r.km, 2)}</td>
    <td class="strong">${esc(s.id)}</td>
    <td class="name">${esc(s.nombre)}</td>
    <td>${esc(s.comuna || '—')}</td>
    <td class="num">${fmt(az, 0)}° ${rumbo(az)}</td>
    <td class="num">${s.alt ? fmt(s.alt, 0) : '—'}</td>
    <td><span class="techs">${TECH_BITS.map(([t, b]) =>
      `<span class="${s.techMask & b ? 'on' : ''}">${t}</span>`).join('')}</span></td>
    <td><span class="dot ${f.grade}"></span>${f.fo.nivel}</td>
    <td class="num">${fmt(f.rutaKm, 2)}${f.medida ? '' : '*'}</td>
    <td class="num">${fmtMiles(f.costo)}</td>
    <td><span class="dot ${m.grade}"></span>${ETIQUETA[m.grade]}</td>
    ${celdaDespeje(m)}
    <td>${m.recomendada ? m.recomendada.banda.id : '—'}</td>
    <td class="num">${m.recomendada ? fmtAnt(m.recomendada.antena) : '—'}</td>
    <td class="num">${m.recomendada ? fmtDisp(m.recomendada.disponibilidad) : '—'}</td>
  </tr>`;
}

function exportarAlternativas(res, alts) {
  const cab = ['extremo', 'desde', 'nodo', 'nombre_nodo', 'comuna', 'region', 'dist_km', 'azimut',
    'alt_ant_nodo', 'tecnologias', 'fo_prob', 'fo_tendido_km', 'fo_ruta', 'fo_costo_usd',
    'fo_veredicto', 'mw_veredicto', 'mw_despeje', 'mw_banda', 'mw_antena_m', 'mw_disponibilidad_pct'];
  const filas = alts.map((r) => {
    const s = r.sitio, m = r.mw, f = r.fo, rec = m.recomendada;
    return [r.extremo, r.desde.nombre || r.desde.id, s.id, s.nombre, s.comuna, s.region,
      dec(r.km, 3), dec(azimut(r.desde.lat, r.desde.lon, s.lat, s.lon), 1), dec(s.alt, 0),
      techList(s.techMask).join('+'), f.fo.nivel, dec(f.rutaKm, 3),
      f.medida ? 'calles' : 'estimada', Math.round(f.costo), ETIQUETA[f.grade],
      ETIQUETA[m.grade], despejeTxt(m), rec ? rec.banda.id : '', rec ? dec(rec.antena, 1) : '',
      rec ? dec(rec.disponibilidad, 4) : ''];
  });
  bajar(`alternativas_${slug(res.nombre || res.A.nombre)}.csv`, csv([cab, ...filas]));
}

function enlazarTabla(res) {
  $$('#detalle th.sortable').forEach((el) => {
    el.addEventListener('click', () => {
      const k = el.dataset.sort;
      if (ESTADO.orden.col === k) ESTADO.orden.asc = !ESTADO.orden.asc;
      else ESTADO.orden = { col: k, asc: true };
      render();
    });
  });
  $$('#detalle tbody tr[data-nodo]').forEach((tr) => {
    tr.addEventListener('click', () => {
      const fila = res.filas.find((r) => r.sitio.id === tr.dataset.nodo);
      if (!fila) return;
      $$('#detalle tbody tr').forEach((x) => x.classList.remove('picked'));
      tr.classList.add('picked');
      $('#vano-slot').innerHTML = cuerpoVano(res.cand, fila.sitio, fila.mw, res.P);
      dibujarPerfil(fila.mw, res.cand, fila.sitio);
      perfilarFila(res, fila);
      Mapa.fijar({
        candidatos: [{ lat: res.cand.lat, lon: res.cand.lon, nombre: res.cand.nombre, grade: fila.mw.grade }],
        nodos: [fila.sitio],
        enlaces: [
          { a: res.cand, b: fila.sitio, medio: 'mw', principal: true },
          { a: res.cand, b: fila.sitio, medio: 'fo', principal: false, traza: fila.fo.traza },
        ],
      });
    });
  });
  const btn = $('#csv-nodos');
  if (btn) btn.addEventListener('click', () => exportarNodos(res));
  if (res.mejorMW) dibujarPerfil(res.mejorMW.mw, res.cand, res.mejorMW.sitio);
}

function panelVano(A, B, mw, P) {
  return `<div class="panel">
    <div class="panel-head"><h3>Vano seleccionado</h3><div class="spacer"></div>
      <span class="hint">geometría y balance por banda</span></div>
    <div class="panel-body" id="vano-slot">${cuerpoVano(A, B, mw, P)}</div>
  </div>`;
}

function cuerpoVano(A, B, mw, P) {
  const g = mw.geo;
  const losTxt = {
    ok: `<span class="dot ok"></span>Despeje verificado ${g.fuente === 'perfil' ? 'sobre perfil SRTM' : 'con cotas'}`,
    marginal: '<span class="dot warn"></span>Despeje marginal',
    insuficiente: '<span class="dot bad"></span>Despeje insuficiente',
    desconocido: `<span class="dot none"></span>Sin cotas: ${g.losPlano ? 'alcanza en terreno plano' : 'no alcanza ni en terreno plano'}`,
  }[g.los];

  const salto = JSON.stringify({
    an: A.nombre || A.id, al: A.lat, ao: A.lon, ah: mw.hA,
    bn: B.nombre || B.id, bl: B.lat, bo: B.lon, bh: mw.hB,
  });

  return `<div style="display:flex;flex-direction:column;gap:12px">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <div style="font-family:var(--mono);font-size:var(--fs-data);color:var(--ink-2)">
        ${esc(A.nombre || A.id)} → ${esc(B.nombre || B.id)} · ${fmt(mw.dKm, 2)} km ·
        azimut ${fmt(azimut(A.lat, A.lon, B.lat, B.lon), 1)}° / ${fmt(azimut(B.lat, B.lon, A.lat, A.lon), 1)}°
      </div>
      ${g.fuente === 'perfil'
        ? `<span class="hint">perfil ${esc(g.perfil.fuente)} · ${g.perfil.muestras} muestras</span>`
        : ''}
      ${g.los === 'desconocido'
        ? `<button class="ghost" data-abrir-enlace='${esc(salto)}'>Cargar cotas de este vano</button>`
        : ''}
    </div>
    <div class="kv">
      <div><span class="k">Abultamiento</span><span class="v">${fmt(g.bulge, 2)} m</span></div>
      <div><span class="k">Fresnel F1</span><span class="v">${fmt(g.F1, 2)} m</span></div>
      <div><span class="k">Despeje req.</span><span class="v">${fmt(g.requerido, 2)} m</span></div>
      <div><span class="k">Disponible</span><span class="v">${fmt(g.disponible, 2)} m</span></div>
      <div><span class="k">Holgura</span><span class="v" style="color:${g.holgura >= 0 ? 'var(--ok)' : 'var(--bad)'}">${fmt(g.holgura, 2)} m</span></div>
      <div><span class="k">Torres</span><span class="v">${fmt(mw.hA, 0)} / ${fmt(mw.hB, 0)} m</span></div>
    </div>
    <div style="font-family:var(--mono);font-size:var(--fs-label);color:var(--ink-2)">${losTxt}</div>
    <canvas id="profile" aria-label="Perfil geométrico del vano"></canvas>
    <div class="tablewrap">
      <table class="dense">
        <thead><tr>
          <th>Banda</th><th class="num">Antena</th><th>Modulación</th><th class="num">Capacidad</th>
          <th class="num">FSL</th><th class="num">Rx</th><th class="num">Margen</th>
          <th class="num">Lluvia 0,01 %</th><th class="num">Disponib.</th><th class="num">min/año</th><th></th>
        </tr></thead>
        <tbody>${mw.bandas.map((b) => filaBanda(b, mw.recomendada)).join('')}</tbody>
      </table>
    </div>
    <p class="hint">Capacidad objetivo ${P.capacidad} Mbps · disponibilidad objetivo ${fmt(P.disponibilidad, 3)} % ·
      lluvia R<sub>0,01</sub> ${fmt(P.R001, 0)} mm/h · polarización ${P.polarizacion} · antena máxima ${P.antenaMax} m.</p>
  </div>`;
}

function filaBanda(b, rec) {
  if (!b.mod) {
    return `<tr><td class="strong">${b.banda.id}</td><td colspan="10" style="color:var(--ink-3)">${b.motivo || '—'}</td></tr>`;
  }
  const esRec = rec && rec.banda.id === b.banda.id && rec.antena === b.antena;
  return `<tr${esRec ? ' class="picked"' : ''}>
    <td class="strong">${b.banda.id}${esRec ? ' ◂' : ''}</td>
    <td class="num">${fmtAnt(b.antena)}</td>
    <td>${b.mod.nombre}</td>
    <td class="num">${fmt(b.mod.cap, 0)} M</td>
    <td class="num">${fmt(b.fslDB, 1)}</td>
    <td class="num">${fmt(b.rx, 1)}</td>
    <td class="num">${fmt(b.margen, 1)} dB</td>
    <td class="num">${fmt(b.a001, 1)} dB</td>
    <td class="num"><span class="dot ${b.viable ? 'ok' : 'bad'}"></span>${fmtDisp(b.disponibilidad)}</td>
    <td class="num">${fmt(b.minutosAnio, 0)}</td>
    <td>${b.viable ? '' : `<span class="hint">${b.motivo || ''}</span>`}</td>
  </tr>`;
}

/** Perfil geométrico del vano: curvatura terrestre, rayo y zona de Fresnel. */
function dibujarPerfil(mw, A, B) {
  const cv = document.getElementById('profile');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const cs = getComputedStyle(document.documentElement);
  const c = (n) => cs.getPropertyValue(n).trim();
  ctx.fillStyle = c('--sunken'); ctx.fillRect(0, 0, W, H);

  const g = mw.geo, d = mw.dKm;
  const ml = 52, mr = 14, mt = 26, mb = 22;
  const pw = W - ml - mr, ph = H - mt - mb;
  const x = (km) => ml + (km / d) * pw;
  const k = ESTADO.params.kRefraccion;

  /* Un solo marco de referencia vertical. Con cotas cargadas se trabaja en msnm
     —así el obstáculo queda donde corresponde—; sin ellas, en metros sobre el
     suelo local asumiendo terreno plano. */
  const conCotas = g.cotaA != null && g.cotaB != null && g.cotaObs != null;
  const perfil = g.fuente === 'perfil' ? g.perfil : null;
  const sueloA = conCotas ? g.cotaA : 0;
  const sueloB = conCotas ? g.cotaB : 0;
  /* Con perfil medido el terreno viene del modelo digital, interpolando entre
     muestras; sin él se dibuja la recta entre cotas más el abultamiento. */
  const terreno = (km) => {
    if (!perfil) return sueloA + ((sueloB - sueloA) * km) / d;
    const pts = perfil.puntos;
    const t = Math.max(0, Math.min(1, km / d)) * (pts.length - 1);
    const i = Math.min(pts.length - 2, Math.floor(t));
    return pts[i].elev + (pts[i + 1].elev - pts[i].elev) * (t - i);
  };
  const suelo = (km) => terreno(km) + abultamiento(km, d - km, k);
  const topeA = sueloA + mw.hA;
  const topeB = sueloB + mw.hB;
  const rayoM = (km) => topeA + ((topeB - topeA) * km) / d;

  let vMin, vMax;
  if (perfil) {
    const elevs = perfil.puntos.map((q) => q.elev);
    const bulgeMax = abultamiento(d / 2, d / 2, k);
    vMin = Math.min(...elevs, topeA, topeB);
    vMax = Math.max(...elevs.map((e, i) => e + abultamiento((d * i) / (elevs.length - 1),
                    d - (d * i) / (elevs.length - 1), k)), topeA, topeB, vMin + bulgeMax);
  } else if (conCotas) {
    vMin = Math.min(sueloA, sueloB, g.cotaObs);
    vMax = Math.max(topeA, topeB, g.cotaObs);
  } else {
    vMin = 0;
    vMax = Math.max(mw.hA, mw.hB, g.requerido + 4, g.bulge + g.F1 + 4);
  }
  const aire = Math.max(6, (vMax - vMin) * 0.16);
  vMin -= (conCotas || perfil) ? aire : 0;
  vMax += aire;
  const y = (m) => mt + ph - ((m - vMin) / (vMax - vMin)) * ph;
  const escalaV = ph / (vMax - vMin);        // px por metro

  /* terreno con curvatura terrestre (representación clásica de perfil) */
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const km = (d * i) / 120;
    i ? ctx.lineTo(x(km), y(suelo(km))) : ctx.moveTo(x(km), y(suelo(km)));
  }
  ctx.strokeStyle = c('--ink-3'); ctx.lineWidth = 1.5; ctx.stroke();
  ctx.lineTo(x(d), mt + ph); ctx.lineTo(x(0), mt + ph); ctx.closePath();
  ctx.fillStyle = c('--panel-2'); ctx.globalAlpha = 0.8; ctx.fill(); ctx.globalAlpha = 1;

  /* punto crítico del perfil: el de menor holgura, que es el que decide */
  if (perfil && g.peor) {
    const xp = x(g.peor.km), yp = y(suelo(g.peor.km));
    ctx.strokeStyle = c(g.holgura >= 0 ? '--warn' : '--bad');
    ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(xp, mt); ctx.lineTo(xp, mt + ph); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = c(g.holgura >= 0 ? '--warn' : '--bad');
    ctx.beginPath(); ctx.arc(xp, yp, 3, 0, 6.2832); ctx.fill();
    ctx.font = '600 9.5px ui-monospace, monospace';
    /* el punto crítico puede caer pegado a un extremo: el rótulo se ancla al
       lado que tenga espacio y se dibuja junto al punto, no en la cabecera */
    const rot = `${fmt(g.peor.elev, 0)} m · km ${fmt(g.peor.km, 1)}`;
    const alRas = xp > W - mr - ctx.measureText(rot).width - 8;
    ctx.textAlign = alRas ? 'right' : 'left';
    ctx.strokeStyle = c('--sunken');
    ctx.lineWidth = 2.5;
    ctx.strokeText(rot, xp + (alRas ? -6 : 6), yp - 7);
    ctx.fillText(rot, xp + (alRas ? -6 : 6), yp - 7);
    ctx.textAlign = 'left';
  }

  /* obstáculo declarado, antes del rayo para que éste quede visible encima */
  if (conCotas && !perfil) {
    ctx.fillStyle = c('--bad'); ctx.globalAlpha = 0.55;
    const yObs = y(g.cotaObs);
    ctx.fillRect(x(g.dObsKm) - 3, yObs, 6, Math.max(2, mt + ph - yObs));
    ctx.globalAlpha = 1;
    ctx.fillStyle = c('--bad');
    ctx.font = '600 9.5px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`${fmt(g.cotaObs, 0)}`, x(g.dObsKm), yObs - 5);
    ctx.textAlign = 'left';
  }

  /* fracción de Fresnel exigida, colgando bajo el rayo */
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const km = (d * i) / 120;
    const f1 = fresnel1(Math.max(1e-6, km), Math.max(1e-6, d - km), ESTADO.params.fRef);
    const py = y(rayoM(km)) + f1 * ESTADO.params.fraccionFresnel * escalaV;
    i ? ctx.lineTo(x(km), py) : ctx.moveTo(x(km), py);
  }
  for (let i = 120; i >= 0; i--) {
    const km = (d * i) / 120;
    ctx.lineTo(x(km), y(rayoM(km)));
  }
  ctx.closePath();
  ctx.fillStyle = c('--mw'); ctx.globalAlpha = 0.18; ctx.fill();
  ctx.globalAlpha = 0.55; ctx.strokeStyle = c('--mw'); ctx.lineWidth = 1; ctx.stroke();
  ctx.globalAlpha = 1;

  /* rayo directo y torres */
  ctx.beginPath(); ctx.moveTo(x(0), y(topeA)); ctx.lineTo(x(d), y(topeB));
  ctx.strokeStyle = c('--mw'); ctx.lineWidth = 1.8; ctx.stroke();
  ctx.strokeStyle = c('--ink'); ctx.lineWidth = 2;
  ctx.font = '600 10px ui-monospace, monospace';
  [[0, sueloA, topeA, mw.hA, 'left'], [d, sueloB, topeB, mw.hB, 'right']]
    .forEach(([km, base, tope, h, lado]) => {
      ctx.beginPath(); ctx.moveTo(x(km), y(base)); ctx.lineTo(x(km), y(tope)); ctx.stroke();
      ctx.fillStyle = c('--ink');
      ctx.textAlign = lado === 'left' ? 'left' : 'right';
      ctx.fillText(`${fmt(h, 0)} m`, x(km) + (lado === 'left' ? 5 : -5), y(tope) - 5);
    });
  ctx.textAlign = 'left';

  /* ejes y rótulos */
  ctx.strokeStyle = c('--line'); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(ml, mt); ctx.lineTo(ml, mt + ph); ctx.lineTo(ml + pw, mt + ph); ctx.stroke();
  ctx.fillStyle = c('--ink-3'); ctx.font = '9.5px ui-monospace, monospace';
  ctx.fillText(`${Math.round(vMax)}`, 4, mt + 8);
  ctx.fillText(`${Math.round(vMin)}`, 4, mt + ph + 3);
  ctx.fillText(conCotas ? 'msnm' : 'm s/suelo', 4, mt - 14);
  ctx.fillText('A', ml, H - 6);
  ctx.textAlign = 'right'; ctx.fillText(`B · ${fmt(d, 2)} km`, ml + pw, H - 6); ctx.textAlign = 'left';
  ctx.fillStyle = c('--ink-2');
  ctx.fillText(`despeje requerido ${fmt(g.requerido, 1)} m en km ${fmt(g.dObsKm, 2)}` +
    (conCotas ? ` · holgura ${fmt(g.holgura, 1)} m` : ' · terreno asumido plano'), ml, mt - 14);
}

/* ---- modo enlace ---- */

function renderEnlace(res) {
  const { A, B, mw, fo, P } = res;
  $('#veredictos').innerHTML = `
    <article class="verdict mw" data-grade="${mw.grade}">
      <div class="verdict-head"><span class="medium">Microondas A–B</span>${gradeChip(mw.grade)}</div>
      <div class="headline">${fmt(mw.dKm, 2)} km${mw.recomendada ? ` · ${mw.recomendada.banda.id}` : ''}</div>
      <p class="because">${mw.why}</p>
      <div class="kv">
        <div><span class="k">Antena</span><span class="v">${mw.recomendada ? fmtAnt(mw.recomendada.antena) : '—'}</span></div>
        <div><span class="k">Modulación</span><span class="v">${mw.recomendada ? mw.recomendada.mod.nombre : '—'}</span></div>
        <div><span class="k">Disponibilidad</span><span class="v">${mw.recomendada ? fmtDisp(mw.recomendada.disponibilidad) : '—'}</span></div>
        <div><span class="k">Margen</span><span class="v">${mw.recomendada ? `${fmt(mw.recomendada.margen, 1)} dB` : '—'}</span></div>
      </div>
    </article>
    <article class="verdict fo" data-grade="${fo.grade}">
      <div class="verdict-head"><span class="medium">Fibra A–B</span>${gradeChip(fo.grade)}</div>
      <div class="headline">${fmt(fo.rutaKm, 2)} km de tendido</div>
      <p class="because">Tendido directo entre extremos, sinuosidad ×${fmt(fo.sinuosidad, 2)}. ${fo.why}</p>
      <div class="kv">
        <div><span class="k">Línea recta</span><span class="v">${fmt(fo.km, 2)} km</span></div>
        <div><span class="k">Costo estimado</span><span class="v">USD ${fmtMiles(fo.costo)}</span></div>
        <div><span class="k">Costo por km</span><span class="v">USD ${fmtMiles(fo.costoKm)}</span></div>
        <div><span class="k">Umbral ámbar</span><span class="v">${P.foAmbarKm} km</span></div>
      </div>
    </article>`;

  const alts = res.alternativas || alternativasDeEnlace(A, B, P);
  const viables = alts.filter((x) => x.fo.grade !== 'bad' || x.mw.grade !== 'bad');
  $('#detalle').innerHTML = `
    ${panelVano(A, B, mw, P)}
    <div class="panel">
      <div class="panel-head"><h3>Alternativas al vano directo</h3>
        <div class="spacer"></div>
        <span class="hint">${viables.length} de ${alts.length} con algún medio viable</span>
        <span class="hint" id="estado-ruteo"></span>
        <button class="ghost" id="csv-alternativas">Exportar CSV</button>
      </div>
      <div class="tablewrap"><table class="dense">
        <thead><tr>
          <th>Extremo</th><th class="num">km</th><th>Código</th><th>Nombre</th><th>Comuna</th>
          <th class="num">Az.</th><th class="num">Alt.</th><th>Tec.</th>
          <th>FO</th><th class="num">FO km</th><th class="num">USD</th>
          <th>MMOO</th><th>Despeje</th><th>Banda</th><th class="num">Ant.</th><th class="num">Disp.</th>
        </tr></thead>
        <tbody>${alts.slice().sort((a, b) => (a.extremo === b.extremo ? a.km - b.km
          : a.extremo.localeCompare(b.extremo))).map(filaAlternativa).join('')}</tbody>
      </table></div>
    </div>`;
  const btnAlt = $('#csv-alternativas');
  if (btnAlt) btnAlt.addEventListener('click', () => exportarAlternativas(res, alts));

  dibujarPerfil(mw, A, B);
  Mapa.fijar({
    candidatos: [{ lat: A.lat, lon: A.lon, nombre: A.nombre, grade: mw.grade },
                 { lat: B.lat, lon: B.lon, nombre: B.nombre, grade: mw.grade }],
    nodos: alts.map((x) => x.sitio),
    enlaces: [
      { a: A, b: B, medio: 'mw', principal: true },
      { a: A, b: B, medio: 'fo', principal: false, traza: fo.traza },
      ...alts.filter((x) => x.mw.grade !== 'bad')
        .map((x) => ({ a: x.desde, b: x.sitio, medio: 'mw', principal: false })),
    ],
  });
  Mapa.encuadrarEn([A, B], 0.6);
}

/* ---- resumen de lote ---- */

function renderResumenLote(res) {
  const cuenta = { ok: 0, warn: 0, bad: 0 };
  res.forEach((r) => {
    const g = r.tipo === 'sitio' ? recomendacion(r).grade : r.mw.grade;
    cuenta[g] = (cuenta[g] || 0) + 1;
  });
  $('#resumen-lote').innerHTML = `
    <div class="panel">
      <div class="panel-head"><h3>Lote · ${res.length} entradas</h3><div class="spacer"></div>
        <span class="chip"><span class="dot ok"></span><b>${cuenta.ok}</b> factibles</span>
        <span class="chip"><span class="dot warn"></span><b>${cuenta.warn}</b> condicionadas</span>
        <span class="chip"><span class="dot bad"></span><b>${cuenta.bad}</b> no factibles</span>
        <button class="ghost" id="csv-lote">Exportar CSV</button>
      </div>
      <div class="tablewrap"><table>
        <thead><tr><th class="num">#</th><th>Entrada</th><th>Coordenadas</th><th>Medio</th>
          <th>Veredicto</th><th>Nodo</th><th class="num">Dist.</th><th>Banda</th>
          <th class="num">Disponib.</th><th class="num">Tendido</th></tr></thead>
        <tbody>${res.map((r, i) => filaLote(r, i)).join('')}</tbody>
      </table></div>
    </div>`;
  $('#csv-lote').addEventListener('click', () => exportarLote(res));
  $$('#resumen-lote tbody tr').forEach((tr) => tr.addEventListener('click', () => {
    ESTADO.seleccion = Number(tr.dataset.i);
    render();
    $('#veredictos').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }));
}

function filaLote(r, i) {
  const sel = i === Math.min(ESTADO.seleccion, ESTADO.resultados.length - 1);
  if (r.tipo === 'enlace') {
    return `<tr data-i="${i}" class="${sel ? 'picked' : ''}">
      <td class="num">${i + 1}</td><td class="strong">${esc(r.nombre || r.A.nombre)}</td>
      <td>${fmt(r.A.lat, 4)}, ${fmt(r.A.lon, 4)} → ${fmt(r.B.lat, 4)}, ${fmt(r.B.lon, 4)}</td>
      <td>Enlace A–B</td>
      <td><span class="dot ${r.mw.grade}"></span>${ETIQUETA[r.mw.grade]}</td>
      <td>${esc(r.B.nombre)}</td><td class="num">${fmt(r.mw.dKm, 2)}</td>
      <td>${r.mw.recomendada ? r.mw.recomendada.banda.id : '—'}</td>
      <td class="num">${r.mw.recomendada ? fmtDisp(r.mw.recomendada.disponibilidad) : '—'}</td>
      <td class="num">${fmt(r.fo.rutaKm, 2)}</td></tr>`;
  }
  const rec = recomendacion(r);
  const esFO = rec.medio === 'Fibra óptica';
  const nodo = esFO ? r.mejorFO : r.mejorMW;
  return `<tr data-i="${i}" class="${sel ? 'picked' : ''}">
    <td class="num">${i + 1}</td><td class="strong">${esc(r.cand.nombre)}</td>
    <td>${fmt(r.cand.lat, 5)}, ${fmt(r.cand.lon, 5)}</td>
    <td>${rec.medio}</td>
    <td><span class="dot ${rec.grade}"></span>${ETIQUETA[rec.grade]}</td>
    <td class="strong">${esc(nodo.sitio.id)}</td>
    <td class="num">${fmt(nodo.km, 2)}</td>
    <td>${r.mejorMW.mw.recomendada ? r.mejorMW.mw.recomendada.banda.id : '—'}</td>
    <td class="num">${r.mejorMW.mw.recomendada ? fmtDisp(r.mejorMW.mw.recomendada.disponibilidad) : '—'}</td>
    <td class="num">${fmt(r.mejorFO.fo.rutaKm, 2)}</td></tr>`;
}

/* ---- exportación ---- */

/** Decimal con coma: Excel en es-CL lee el punto como texto. */
const dec = (n, d) => (n == null || !Number.isFinite(Number(n)) ? '' : Number(n).toFixed(d).replace('.', ','));

function csv(filas) {
  return filas.map((f) => f.map((c) => {
    const s = c == null ? '' : String(c);
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(';')).join('\r\n');
}

function bajar(nombre, texto) {
  const blob = new Blob(['﻿' + texto], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  toast(`${nombre} descargado.`);
}

function exportarNodos(res) {
  const cab = ['candidato', 'lat_cand', 'lon_cand', 'nodo', 'nombre_nodo', 'comuna', 'region',
    'dist_km', 'azimut', 'alt_ant_nodo', 'tecnologias', 'fo_prob', 'fo_tendido_km', 'fo_ruta', 'fo_costo_usd',
    'fo_veredicto', 'mw_veredicto', 'mw_despeje', 'mw_banda', 'mw_antena_m', 'mw_modulacion', 'mw_margen_db',
    'mw_disponibilidad_pct', 'mw_min_ano', 'despeje_req_m', 'despeje_disp_m'];
  const filas = res.filas.map((r) => {
    const m = r.mw, f = r.fo, s = r.sitio, rec = m.recomendada;
    return [res.cand.nombre, dec(res.cand.lat, 6), dec(res.cand.lon, 6), s.id, s.nombre, s.comuna, s.region,
      dec(r.km, 3), dec(azimut(res.cand.lat, res.cand.lon, s.lat, s.lon), 1), dec(s.alt, 0),
      techList(s.techMask).join('+'), f.fo.nivel, dec(f.rutaKm, 3),
      f.medida ? 'calles' : 'estimada', Math.round(f.costo),
      ETIQUETA[f.grade], ETIQUETA[m.grade], despejeTxt(m), rec ? rec.banda.id : '', rec ? dec(rec.antena, 1) : '',
      rec ? rec.mod.nombre : '', rec ? dec(rec.margen, 1) : '',
      rec ? dec(rec.disponibilidad, 4) : '', rec ? Math.round(rec.minutosAnio) : '',
      dec(m.geo.requerido, 2), dec(m.geo.disponible, 2)];
  });
  bajar(`factibilidad_${slug(res.cand.nombre)}.csv`, csv([cab, ...filas]));
}

function exportarLote(res) {
  const cab = ['n', 'entrada', 'tipo', 'lat', 'lon', 'lat_b', 'lon_b', 'medio_recomendado', 'veredicto',
    'nodo', 'dist_km', 'mw_veredicto', 'mw_despeje', 'mw_banda', 'mw_antena_m', 'mw_disponibilidad_pct',
    'fo_veredicto', 'fo_tendido_km', 'fo_costo_usd', 'observacion'];
  const filas = res.map((r, i) => {
    if (r.tipo === 'enlace') {
      const rec = r.mw.recomendada;
      return [i + 1, r.nombre || r.A.nombre, 'enlace', dec(r.A.lat, 6), dec(r.A.lon, 6), dec(r.B.lat, 6), dec(r.B.lon, 6),
        'Microondas A–B', ETIQUETA[r.mw.grade], r.B.nombre, dec(r.mw.dKm, 3),
        ETIQUETA[r.mw.grade], rec ? rec.banda.id : '', rec ? dec(rec.antena, 1) : '',
        rec ? dec(rec.disponibilidad, 4) : '', ETIQUETA[r.fo.grade], dec(r.fo.rutaKm, 3),
        Math.round(r.fo.costo), r.mw.why];
    }
    const rec2 = recomendacion(r);
    const m = r.mejorMW.mw, f = r.mejorFO.fo, recB = m.recomendada;
    return [i + 1, r.cand.nombre, 'sitio', dec(r.cand.lat, 6), dec(r.cand.lon, 6), '', '', rec2.medio, ETIQUETA[rec2.grade],
      rec2.medio === 'Fibra óptica' ? f.nodo.id : r.mejorMW.sitio.id,
      dec(rec2.medio === 'Fibra óptica' ? r.mejorFO.km : m.dKm, 3),
      ETIQUETA[m.grade], despejeTxt(m), recB ? recB.banda.id : '', recB ? dec(recB.antena, 1) : '',
      recB ? dec(recB.disponibilidad, 4) : '', ETIQUETA[f.grade], dec(f.rutaKm, 3),
      Math.round(f.costo), rec2.texto];
  });
  bajar('factibilidad_lote.csv', csv([cab, ...filas]));
}

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '').toLowerCase() || 'punto';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* ---- pestaña Base de red ---- */

function renderBase() {
  const q = $('#buscar-red').value.trim().toUpperCase();
  const reg = $('#filtro-region').value;
  const tec = $('#filtro-tec').value;
  const bit = { '2G': 1, '3G': 2, LTE: 4, '5G': 8 }[tec];
  let lista = RED;
  if (reg) lista = lista.filter((s) => s.region === reg);
  if (bit) lista = lista.filter((s) => s.techMask & bit);
  if (q) lista = lista.filter((s) =>
    s.id.includes(q) || (s.nombre || '').toUpperCase().includes(q) ||
    (s.comuna || '').toUpperCase().includes(q));
  const total = lista.length;
  const vista = lista.slice(0, 400);
  $('#conteo-red').textContent = `${total.toLocaleString('es-CL')} sitios${total > 400 ? ' · se muestran 400' : ''}`;
  $('#tabla-red').innerHTML = `<table>
    <thead><tr><th>Código</th><th>Nombre</th><th>Comuna</th><th>Región</th>
      <th class="num">Lat</th><th class="num">Lon</th><th class="num">Alt.</th>
      <th>Tec.</th><th class="num">Celdas</th><th>Morfología</th><th>FO probable</th><th>Usar</th></tr></thead>
    <tbody>${vista.map((s) => {
      const p = probabilidadFO(s);
      return `<tr><td class="strong">${esc(s.id)}</td><td class="name">${esc(s.nombre)}</td>
        <td>${esc(s.comuna || '—')}</td><td>${esc(s.region || '—')}</td>
        <td class="num">${fmt(s.lat, 5)}</td><td class="num">${fmt(s.lon, 5)}</td>
        <td class="num">${s.alt ? fmt(s.alt, 0) : '—'}</td>
        <td><span class="techs">${TECH_BITS.map(([t, b]) =>
          `<span class="${s.techMask & b ? 'on' : ''}">${t}</span>`).join('')}</span></td>
        <td class="num">${s.celdas}</td><td>${esc(s.morfologia || '—')}</td>
        <td><span class="dot ${p.score >= 60 ? 'ok' : p.score >= 35 ? 'warn' : 'bad'}"></span>${p.nivel}</td>
        <td><button class="ghost" data-usar="${esc(s.id)}">como A</button></td></tr>`;
    }).join('')}</tbody></table>`;
  $$('#tabla-red button[data-usar]').forEach((b) => b.addEventListener('click', () => {
    const s = byId.get(b.dataset.usar);
    usarComoPunto(s);
  }));
}

function usarComoPunto(s) {
  if (!s) return;
  if (ESTADO.modo === 'enlace') {
    $('#nombreA').value = s.id; $('#latA').value = s.lat; $('#lonA').value = s.lon;
    if (s.alt) $('#alturaA').value = s.alt;
  } else {
    setModo('sitio');
    $('#nombre').value = s.id; $('#lat').value = s.lat; $('#lon').value = s.lon;
    if (s.alt) $('#alturaCand').value = s.alt;
  }
  irA('analizar');
  toast(`${s.id} cargado como punto de análisis.`);
}

/* ---- pestaña Parámetros ---- */

const CAMPOS_PARAM = [
  ['Búsqueda', [
    ['nNodos', 'Nodos a evaluar', 'number', { min: 1, max: 30, step: 1 }],
    ['alturaCandidato', 'Altura de torre asumida (m)', 'number', { min: 3, max: 150, step: 1 }],
    ['alturaDefecto', 'Altura por defecto si el nodo no la trae (m)', 'number', { min: 3, max: 150, step: 1 }],
  ]],
  ['Microondas', [
    ['capacidad', 'Capacidad requerida (Mbps)', 'number', { min: 10, max: 10000, step: 10 }],
    ['disponibilidad', 'Disponibilidad objetivo (%)', 'select',
      { opciones: [[99.9, '99,9 %'], [99.95, '99,95 %'], [99.99, '99,99 %'], [99.995, '99,995 %'], [99.999, '99,999 %']] }],
    ['antenaMax', 'Antena máxima admitida (m)', 'select',
      { opciones: [[0.6, '0,6 m'], [1.2, '1,2 m'], [1.8, '1,8 m'], [2.4, '2,4 m'], [3, '3,0 m']] }],
    ['polarizacion', 'Polarización', 'select', { opciones: [['V', 'Vertical'], ['H', 'Horizontal']] }],
    ['xpic', 'Doble polarización (XPIC)', 'check', {}],
    ['perdidasFijas', 'Pérdidas fijas de ramificación (dB)', 'number', { min: 0, max: 10, step: 0.5 }],
  ]],
  ['Geometría y propagación', [
    ['kRefraccion', 'Factor k de refracción', 'number', { min: 0.5, max: 2, step: 0.01 }],
    ['fraccionFresnel', 'Fracción de F1 exigida', 'number', { min: 0.1, max: 1.2, step: 0.1 }],
    ['altimetria', 'Resolver despeje con perfil SRTM', 'check', {}],
    ['clutter', 'Margen por clutter/vegetación (m)', 'number', { min: 0, max: 30, step: 1 }],
    ['fRef', 'Frecuencia de referencia para F1 (GHz)', 'number', { min: 5, max: 90, step: 1 }],
    ['dN1', 'Gradiente de refractividad dN1', 'number', { min: -600, max: -50, step: 10 }],
    ['autoLluvia', 'Tasa de lluvia según región del nodo más cercano', 'check', {}],
    ['R001', 'Tasa de lluvia R0,01 manual (mm/h)', 'number', { min: 0, max: 120, step: 1 }],
  ]],
  ['Fibra óptica', [
    ['ruteo', 'Medir el tendido por calles (OSRM)', 'check', {}],
    ['sinuosidadUrbana', 'Sinuosidad urbana (si no hay ruteo)', 'number', { min: 1, max: 2.5, step: 0.05 }],
    ['sinuosidadRural', 'Sinuosidad rural', 'number', { min: 1, max: 2.5, step: 0.05 }],
    ['costoUrbano', 'Costo urbano (USD/km)', 'number', { min: 0, max: 500000, step: 1000 }],
    ['costoRural', 'Costo rural (USD/km)', 'number', { min: 0, max: 500000, step: 1000 }],
    ['foVerdeKm', 'Umbral factible (km)', 'number', { min: 0.1, max: 50, step: 0.5 }],
    ['foAmbarKm', 'Umbral condicionado (km)', 'number', { min: 0.5, max: 100, step: 0.5 }],
  ]],
];

function renderParams() {
  const cont = $('#params');
  cont.innerHTML = CAMPOS_PARAM.map(([grupo, campos]) => `
    <div class="panel"><div class="panel-head"><h3>${grupo}</h3></div>
      <div class="panel-body" style="display:flex;flex-direction:column;gap:9px">
        ${campos.map(([k, etiqueta, tipo, o]) => {
          const v = ESTADO.params[k];
          if (tipo === 'check') {
            return `<label class="field" style="flex-direction:row;align-items:center;gap:8px">
              <input type="checkbox" data-param="${k}" ${v ? 'checked' : ''} style="width:auto">
              <span>${etiqueta}</span></label>`;
          }
          if (tipo === 'select') {
            return `<label class="field"><span>${etiqueta}</span>
              <select data-param="${k}">${o.opciones.map(([val, txt]) =>
                `<option value="${val}" ${String(val) === String(v) ? 'selected' : ''}>${txt}</option>`).join('')}
              </select></label>`;
          }
          return `<label class="field"><span>${etiqueta}</span>
            <input type="number" data-param="${k}" value="${v}"
              min="${o.min}" max="${o.max}" step="${o.step}"></label>`;
        }).join('')}
      </div></div>`).join('') + `
    <div class="panel"><div class="panel-head"><h3>Bandas disponibles</h3></div>
      <div class="panel-body" style="display:flex;flex-direction:column;gap:9px">
        <p class="hint">Sólo se recomiendan bandas marcadas. Desmarca las que no tengas
          licenciadas o sin equipamiento: la recomendación es la banda más alta que cierra el
          vano, así que dejar E-band activa hará que los saltos cortos se resuelvan ahí.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:6px">
          ${BANDAS.map((b) => `<label class="field" style="flex-direction:row;align-items:center;gap:6px">
            <input type="checkbox" data-banda="${b.id}" style="width:auto"
              ${(ESTADO.params.bandas || []).includes(b.id) ? 'checked' : ''}>
            <span>${b.id}</span></label>`).join('')}
        </div>
      </div></div>

    <div class="panel"><div class="panel-head"><h3>Inventario de nodos con fibra</h3></div>
      <div class="panel-body" style="display:flex;flex-direction:column;gap:9px">
        <p class="hint">La base CGI no trae el medio de transmisión, así que la probabilidad de
          fibra se infiere del perfil radio de cada sitio. Si pegas aquí los códigos de los nodos
          que sí tienen fibra (uno por línea), ese dato reemplaza la heurística.</p>
        <textarea id="nodos-fo" placeholder="01_404&#10;02_208&#10;13I_184">${Array.from(ESTADO.nodosFO).join('\n')}</textarea>
        <div class="btnrow">
          <button class="ghost" id="guardar-fo">Aplicar inventario</button>
          <button class="ghost" id="limpiar-fo">Volver a la heurística</button>
        </div>
        <p class="hint" id="estado-fo">${ESTADO.nodosFO.size
          ? `${ESTADO.nodosFO.size} nodos marcados con fibra.` : 'Sin inventario: se usa la heurística.'}</p>
      </div></div>
    <div class="panel"><div class="panel-head"><h3>Tasas de lluvia por región</h3></div>
      <div class="panel-body"><div class="tablewrap"><table>
        <thead><tr><th>Región</th><th>Nombre</th><th class="num">R0,01 mm/h</th><th class="num">Sitios</th></tr></thead>
        <tbody>${Object.entries(REGIONES).map(([k, r]) => `<tr><td class="strong">${k}</td><td>${r.nombre}</td>
          <td class="num"><input type="number" data-lluvia="${k}" value="${r.R}" min="0" max="120"
            style="width:74px"></td><td class="num">${(META.por_region[k] || 0).toLocaleString('es-CL')}</td></tr>`).join('')}
        </tbody></table></div></div></div>
    <div class="panel"><div class="panel-head"><h3>Restablecer</h3></div>
      <div class="panel-body"><button class="ghost" id="reset-params">Volver a los valores por defecto</button></div>
    </div>`;

  $$('#params [data-param]').forEach((el) => {
    el.addEventListener('change', () => {
      const k = el.dataset.param;
      ESTADO.params[k] = el.type === 'checkbox' ? el.checked
        : (typeof PARAMS_DEFECTO[k] === 'string' ? el.value : parseFloat(el.value));
      guardar();
      if (ESTADO.resultados.length) { ejecutarSilencioso(); }
    });
  });
  $$('#params [data-banda]').forEach((el) => el.addEventListener('change', () => {
    const activas = $$('#params [data-banda]').filter((x) => x.checked).map((x) => x.dataset.banda);
    if (!activas.length) { el.checked = true; toast('Debe quedar al menos una banda activa.'); return; }
    ESTADO.params.bandas = activas;
    guardar();
    if (ESTADO.resultados.length) ejecutarSilencioso();
  }));
  $$('#params [data-lluvia]').forEach((el) => el.addEventListener('change', () => {
    const v = parseFloat(el.value);
    if (Number.isFinite(v)) { REGIONES[el.dataset.lluvia].R = v; if (ESTADO.resultados.length) ejecutarSilencioso(); }
  }));
  $('#guardar-fo').addEventListener('click', () => {
    const cods = $('#nodos-fo').value.split(/[\s,;]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
    const validos = cods.filter((c) => byId.has(c));
    ESTADO.nodosFO = new Set(validos);
    guardar();
    $('#estado-fo').textContent = `${validos.length} nodos marcados con fibra` +
      (cods.length - validos.length ? ` · ${cods.length - validos.length} códigos no existen en la red.` : '.');
    if (ESTADO.resultados.length) ejecutarSilencioso();
    toast('Inventario de fibra aplicado.');
  });
  $('#limpiar-fo').addEventListener('click', () => {
    ESTADO.nodosFO = new Set();
    $('#nodos-fo').value = '';
    $('#estado-fo').textContent = 'Sin inventario: se usa la heurística.';
    guardar();
    if (ESTADO.resultados.length) ejecutarSilencioso();
  });
  $('#reset-params').addEventListener('click', () => {
    ESTADO.params = Object.assign({}, PARAMS_DEFECTO);
    guardar(); renderParams();
    if (ESTADO.resultados.length) ejecutarSilencioso();
    toast('Parámetros restablecidos.');
  });
}

/** Recalcula con los parámetros nuevos sin volver a leer el formulario del modo. */
function ejecutarSilencioso() {
  const previos = ESTADO.resultados.slice();
  ESTADO.resultados = previos.map((r) => {
    if (r.tipo === 'enlace') {
      const P = paramsPara((r.A.lat + r.B.lat) / 2, (r.A.lon + r.B.lon) / 2);
      const mw = analizarMMOO(r.A, r.B, P, null);
      return Object.assign({}, r, { P, mw,
        fo: analizarFO(r.A.lat, r.A.lon, extremoComoNodo(r.B, P), P),
        alternativas: alternativasDeEnlace(r.A, r.B, P) });
    }
    const P = paramsPara(r.cand.lat, r.cand.lon);
    const nuevo = analizarSitio(r.cand, P);
    return nuevo ? Object.assign(nuevo, { P, tipo: 'sitio', nombre: r.nombre }) : r;
  });
  render();
}

/* ---- navegación y arranque ---- */

function irA(id) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${id}`));
  $$('.tab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === id)));
  if (id === 'red') renderBase();
  if (id === 'parametros') renderParams();
  if (id === 'analizar') Mapa.pintar();
}

const HINT_MODO = {
  sitio: 'Un punto nuevo: busca en la red el mejor nodo de agregación por fibra y por radio.',
  enlace: 'Un vano concreto entre dos extremos: balance completo por banda y despeje con cotas.',
  lote: 'Muchas entradas de una vez: una tabla con el veredicto de cada una, exportable.',
};

function setModo(m) {
  ESTADO.modo = m;
  $$('#modo button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modo === m)));
  $$('[data-panel-modo]').forEach((p) => {
    p.style.display = p.dataset.panelModo === m ? 'flex' : 'none';
  });
  $('#modo-hint').textContent = HINT_MODO[m];
}

function buscadorSitios(inputSel, listaSel, alElegir) {
  const input = $(inputSel), lista = $(listaSel);
  const cerrar = () => lista.classList.remove('open');
  input.addEventListener('input', () => {
    const q = input.value.trim().toUpperCase();
    if (q.length < 2) return cerrar();
    const hits = [];
    for (const s of RED) {
      if (s.id.includes(q) || (s.nombre || '').toUpperCase().includes(q) ||
          (s.comuna || '').toUpperCase().includes(q)) hits.push(s);
      if (hits.length >= 40) break;
    }
    if (!hits.length) return cerrar();
    lista.innerHTML = hits.map((s) => `<button type="button" data-id="${esc(s.id)}">
      ${esc(s.id)} <span class="meta">· ${esc(s.nombre)} · ${esc(s.comuna || '')}</span></button>`).join('');
    lista.classList.add('open');
    $$(`${listaSel} button`).forEach((b) => b.addEventListener('click', () => {
      alElegir(byId.get(b.dataset.id));
      cerrar();
    }));
  });
  input.addEventListener('blur', () => setTimeout(cerrar, 160));
}

function arrancar() {
  restaurar();

  /* cabecera */
  $('#chips').innerHTML = [
    `<span class="chip">Base <b>${META.sitios_total.toLocaleString('es-CL')}</b> sitios</span>`,
    `<span class="chip"><b>${Object.keys(META.por_region).length}</b> regiones</span>`,
    ...TECH_BITS.map(([t]) => `<span class="chip">${t} <b>${(META.por_tecnologia[t] || 0).toLocaleString('es-CL')}</b></span>`),
  ].join('');
  $('#fuente').textContent = META.archivos.join(' + ');
  $('#meta-sitios').textContent = META.sitios_total.toLocaleString('es-CL');

  $$('.tab').forEach((t) => t.addEventListener('click', () => irA(t.dataset.view)));
  $$('#modo button').forEach((b) => b.addEventListener('click', () => setModo(b.dataset.modo)));
  $('#analizar').addEventListener('click', ejecutar);
  $('#limpiar').addEventListener('click', () => {
    ESTADO.resultados = [];
    ['#nombre', '#lat', '#lon', '#lote', '#cotaA', '#cotaB', '#cotaObs', '#dObs'].forEach((s) => {
      const el = $(s); if (el) el.value = '';
    });
    renderErrores([]);
    render();
    Mapa.verTodo();
  });
  $('#ver-todo').addEventListener('click', () => Mapa.verTodo());
  $('#ejemplo').addEventListener('click', () => {
    setModo('lote');
    $('#lote').value = [
      '06_109-06_331',
      '13_272 - 23_503',
      'Bodega Lampa; -33.28617; -70.87233; 24',
      'Radio Base Curacaví; -33.40560; -71.14210; 36',
      'Cliente Chicureo; -33.29850; -70.66800; 18',
      'Faena Los Bronces; -33.14400; -70.28600; 40',
      'Enlace Puerto Montt; -41.46930; -72.94240; -41.32180; -72.98600',
      '06_109; -34.60000; -71.15000',
    ].join('\n');
    ejecutar();
  });

  /* pasar de un vano tamizado al modo Enlace, para cargarle las cotas */
  $('#detalle').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-abrir-enlace]');
    if (!btn) return;
    const v = JSON.parse(btn.dataset.abrirEnlace);
    setModo('enlace');
    $('#nombreA').value = v.an; $('#latA').value = v.al; $('#lonA').value = v.ao; $('#alturaA').value = v.ah;
    $('#nombreB').value = v.bn; $('#latB').value = v.bl; $('#lonB').value = v.bo; $('#alturaB').value = v.bh;
    $('#cotaA').focus();
    toast('Vano cargado. Ingresa las cotas y vuelve a analizar.');
  });

  buscadorSitios('#lookup', '#lookup-list', (s) => usarComoPunto(s));
  buscadorSitios('#lookupB', '#lookupB-list', (s) => {
    if (!s) return;
    $('#nombreB').value = s.id; $('#latB').value = s.lat; $('#lonB').value = s.lon;
    if (s.alt) $('#alturaB').value = s.alt;
  });

  ['#buscar-red', '#filtro-region', '#filtro-tec'].forEach((s) =>
    $(s).addEventListener('input', renderBase));
  $('#filtro-region').innerHTML = '<option value="">Todas las regiones</option>' +
    Object.entries(META.por_region).map(([k, n]) =>
      `<option value="${k}">${k} · ${(REGIONES[k] ? REGIONES[k].nombre : k)} (${n})</option>`).join('');

  montarControlesCapas();

  $('#fondo').innerHTML = FONDOS.map((f) =>
    `<option value="${f.id}" ${f.id === ESTADO.params.fondo ? 'selected' : ''}>${f.nombre}</option>`).join('');
  $('#fondo').addEventListener('change', (e) => {
    ESTADO.params.fondo = e.target.value;
    guardar();
    Mapa.fijarFondo(e.target.value);
  });

  Mapa.init($('#map'), (sitio, lat, lon) => {
    if (sitio) { usarComoPunto(sitio); return; }
    if (ESTADO.modo === 'enlace') {
      const objetivo = !$('#latA').value ? 'A' : 'B';
      $(`#lat${objetivo}`).value = lat.toFixed(6);
      $(`#lon${objetivo}`).value = lon.toFixed(6);
      toast(`Extremo ${objetivo} fijado en el mapa.`);
    } else {
      setModo('sitio');
      $('#lat').value = lat.toFixed(6);
      $('#lon').value = lon.toFixed(6);
      toast('Punto candidato fijado en el mapa. Pulsa Analizar.');
    }
  });

  Mapa.fijarFondo(ESTADO.params.fondo || 'carto');
  setModo('sitio');
  irA('analizar');
  render();
}

document.addEventListener('DOMContentLoaded', arrancar);
