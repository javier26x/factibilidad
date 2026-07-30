/* geo.js - geodesia y parseo de coordenadas (WGS84).
   Sin dependencias: todo corre offline. */
(function (global) {
  'use strict';

  var R_TIERRA = 6371.0088;           // radio medio, km
  var RAD = Math.PI / 180;

  function haversine(lat1, lon1, lat2, lon2) {
    var dLat = (lat2 - lat1) * RAD, dLon = (lon2 - lon1) * RAD;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R_TIERRA * Math.asin(Math.min(1, Math.sqrt(a)));
  }

  function azimut(lat1, lon1, lat2, lon2) {
    var f1 = lat1 * RAD, f2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
    var y = Math.sin(dl) * Math.cos(f2);
    var x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
    return (Math.atan2(y, x) / RAD + 360) % 360;
  }

  /* punto a distancia/azimut dados (para dibujar la traza del enlace) */
  function destino(lat, lon, distKm, azGrados) {
    var d = distKm / R_TIERRA, br = azGrados * RAD, f1 = lat * RAD, l1 = lon * RAD;
    var f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(br));
    var l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(f1),
                             Math.cos(d) - Math.sin(f1) * Math.sin(f2));
    return { lat: f2 / RAD, lon: ((l2 / RAD + 540) % 360) - 180 };
  }

  /* interpolacion sobre el gran circulo, frac en [0,1] */
  function intermedio(lat1, lon1, lat2, lon2, frac) {
    var d = haversine(lat1, lon1, lat2, lon2) / R_TIERRA;
    if (d < 1e-12) return { lat: lat1, lon: lon1 };
    var A = Math.sin((1 - frac) * d) / Math.sin(d), B = Math.sin(frac * d) / Math.sin(d);
    var f1 = lat1 * RAD, l1 = lon1 * RAD, f2 = lat2 * RAD, l2 = lon2 * RAD;
    var x = A * Math.cos(f1) * Math.cos(l1) + B * Math.cos(f2) * Math.cos(l2);
    var y = A * Math.cos(f1) * Math.sin(l1) + B * Math.cos(f2) * Math.sin(l2);
    var z = A * Math.sin(f1) + B * Math.sin(f2);
    return { lat: Math.atan2(z, Math.sqrt(x * x + y * y)) / RAD, lon: Math.atan2(y, x) / RAD };
  }

  function rumboCardinal(az) {
    var p = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return p[Math.round(az / 22.5) % 16];
  }

  /* --- UTM (Snyder, inversa transversa de Mercator) -> WGS84 -------------- */
  function utmALatLon(este, norte, zona, hemisferio) {
    var a = 6378137.0, f = 1 / 298.257223563, e2 = f * (2 - f), k0 = 0.9996;
    var x = este - 500000;
    var y = (String(hemisferio).toUpperCase() === 'S') ? norte - 10000000 : norte;
    var e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
    var M = y / k0;
    var mu = M / (a * (1 - e2 / 4 - 3 * e2 * e2 / 64 - 5 * Math.pow(e2, 3) / 256));
    var phi1 = mu +
      (3 * e1 / 2 - 27 * Math.pow(e1, 3) / 32) * Math.sin(2 * mu) +
      (21 * e1 * e1 / 16 - 55 * Math.pow(e1, 4) / 32) * Math.sin(4 * mu) +
      (151 * Math.pow(e1, 3) / 96) * Math.sin(6 * mu) +
      (1097 * Math.pow(e1, 4) / 512) * Math.sin(8 * mu);
    var ep2 = e2 / (1 - e2);
    var C1 = ep2 * Math.pow(Math.cos(phi1), 2);
    var T1 = Math.pow(Math.tan(phi1), 2);
    var s = Math.sin(phi1);
    var N1 = a / Math.sqrt(1 - e2 * s * s);
    var R1 = a * (1 - e2) / Math.pow(1 - e2 * s * s, 1.5);
    var D = x / (N1 * k0);
    var lat = phi1 - (N1 * Math.tan(phi1) / R1) * (
      D * D / 2 -
      (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * Math.pow(D, 4) / 24 +
      (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * Math.pow(D, 6) / 720);
    var lon0 = ((zona - 1) * 6 - 180 + 3) * RAD;
    var lon = lon0 + (
      D -
      (1 + 2 * T1 + C1) * Math.pow(D, 3) / 6 +
      (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * Math.pow(D, 5) / 120) / Math.cos(phi1);
    return { lat: lat / RAD, lon: lon / RAD };
  }

  /* --- parseo de coordenadas --------------------------------------------- */
  /* Chile continental + insular: usado para decidir cual numero es lat y cual lon,
     y para inferir el signo cuando el texto viene sin el (-). */
  var CL = { latMin: -56.6, latMax: -17.4, lonMin: -110.0, lonMax: -66.3 };

  function enChile(lat, lon) {
    return lat >= CL.latMin && lat <= CL.latMax && lon >= CL.lonMin && lon <= CL.lonMax;
  }

  /* "33 26 12.5 S" / 33°26'12.5"S / -33 26 12.5 */
  var RE_DMS = /(-?\d{1,3})\s*[°º:\s]\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:['´’′:\s]\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:["“”″]?)\s*)?([NSEWO])?/i;

  function dmsAGrados(txt) {
    var m = RE_DMS.exec(txt);
    if (!m) return null;
    var g = parseFloat(m[1]), min = parseFloat(String(m[2]).replace(',', '.'));
    var seg = m[3] ? parseFloat(String(m[3]).replace(',', '.')) : 0;
    if (!isFinite(g) || !isFinite(min) || min >= 60 || seg >= 60) return null;
    var sg = (g < 0 ? -1 : 1);
    var dec = Math.abs(g) + min / 60 + seg / 3600;
    var hemi = m[4] ? m[4].toUpperCase() : '';
    if (hemi === 'S' || hemi === 'W' || hemi === 'O') sg = -1;
    return { valor: sg * dec, hemi: hemi, texto: m[0] };
  }

  /* Extrae un par (lat,lon) de texto libre. Devuelve {lat,lon,resto,formato} o null. */
  function parseCoords(texto) {
    var t = String(texto == null ? '' : texto).trim();
    if (!t) return null;

    // 1) UTM explicito: "19S 345678 6298765" | "UTM 19 345678 6298765 S"
    var u = /(?:^|\b)(?:utm\s*)?(1[7-9])\s*([snSN])?\s*[,;: ]\s*(\d{5,7}(?:[.,]\d+)?)\s*[,;: ]\s*(\d{6,8}(?:[.,]\d+)?)/.exec(t);
    if (u) {
      var este = parseFloat(u[3].replace(',', '.')), norte = parseFloat(u[4].replace(',', '.'));
      var r = utmALatLon(este, norte, parseInt(u[1], 10), u[2] || 'S');
      if (enChile(r.lat, r.lon)) {
        return { lat: r.lat, lon: r.lon, resto: t.replace(u[0], ' ').trim(), formato: 'UTM ' + u[1] + (u[2] || 'S') };
      }
    }

    // 2) DMS: dos grupos sexagesimales
    var restoDms = t, dms = [], guard = 0;
    while (dms.length < 2 && guard++ < 4) {
      var d = dmsAGrados(restoDms);
      if (!d) break;
      dms.push(d);
      restoDms = restoDms.replace(d.texto, ' ');
    }
    if (dms.length === 2) {
      var par = evaluarPar(dms[0], dms[1]);
      if (par) return { lat: par.lat, lon: par.lon, resto: restoDms.trim(), formato: 'DMS' };
    }

    // 3) grados decimales. Se puntuan todos los pares contiguos y gana el mejor:
    //    asi una columna final de altura ("...,-33.44,-70.65,30.5") no se
    //    confunde con una latitud.
    var nums = [], re = /-?\d{1,3}[.,]\d+|-?\d{1,3}/g, m;
    while ((m = re.exec(t))) nums.push({ v: parseFloat(m[0].replace(',', '.')), s: m[0], i: m.index });
    var dec = nums.filter(function (n) { return /[.,]/.test(n.s); });
    var cand = dec.length >= 2 ? dec : nums;
    var mejor = null;
    for (var i = 0; i + 1 < cand.length; i++) {
      var p = evaluarPar({ valor: cand[i].v, hemi: '' }, { valor: cand[i + 1].v, hemi: '' });
      if (!p) continue;
      // a igual puntaje gana el par que aparece antes en la linea
      p.score += (cand.length - i) * 0.01;
      p.i = i;
      if (!mejor || p.score > mejor.score) mejor = p;
    }
    if (mejor) {
      var resto = t.replace(cand[mejor.i].s, ' ').replace(cand[mejor.i + 1].s, ' ');
      return { lat: mejor.lat, lon: mejor.lon, resto: resto.replace(/[,;|]+/g, ' ').trim(), formato: 'decimal' };
    }
    return null;
  }

  /* Decide cual valor es latitud y cual longitud e infiere el signo para Chile.
     Puntaje mayor = interpretacion mas confiable (sin inventar signos ni invertir
     el orden natural lat/lon). */
  function evaluarPar(A, B) {
    var mejor = null;
    var ordenes = [[A, B, true], [B, A, false]];
    var signos = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
    for (var k = 0; k < 2; k++) {
      var la = ordenes[k][0], lo = ordenes[k][1], natural = ordenes[k][2];
      // respeta el hemisferio cuando viene explicito
      if (la.hemi === 'E' || la.hemi === 'W' || la.hemi === 'O') continue;
      if (lo.hemi === 'N' || lo.hemi === 'S') continue;
      for (var s = 0; s < 4; s++) {
        // no invertir un signo que ya venia en el texto
        if (la.valor < 0 && signos[s][0] === -1) continue;
        if (lo.valor < 0 && signos[s][1] === -1) continue;
        var lat = la.valor * signos[s][0], lon = lo.valor * signos[s][1];
        if (!enChile(lat, lon)) continue;
        var score = (signos[s][0] === 1 && signos[s][1] === 1 ? 4 : 0) +
                    (natural ? 2 : 0) + ((la.hemi || lo.hemi) ? 2 : 0);
        if (!mejor || score > mejor.score) mejor = { lat: lat, lon: lon, score: score };
      }
    }
    return mejor;
  }

  function fmtCoord(lat, lon, dec) {
    var d = dec == null ? 6 : dec;
    return lat.toFixed(d) + ', ' + lon.toFixed(d);
  }

  function aDMS(v, esLat) {
    var hemi = esLat ? (v < 0 ? 'S' : 'N') : (v < 0 ? 'W' : 'E');
    // se redondea a decimas de segundo y se arrastra el acarreo: sin esto el error
    // de punto flotante produce salidas como 72°35'60.0"
    var total = Math.round(Math.abs(v) * 36000);   // decimas de segundo
    var seg = (total % 600) / 10;
    var mi = Math.floor(total / 600) % 60;
    var g = Math.floor(total / 36000);
    return g + '°' + String(mi).padStart(2, '0') + "'" +
           (seg < 10 ? '0' : '') + seg.toFixed(1) + '"' + hemi;
  }

  global.Geo = {
    R_TIERRA: R_TIERRA, CL: CL,
    haversine: haversine, azimut: azimut, destino: destino, intermedio: intermedio,
    rumboCardinal: rumboCardinal, utmALatLon: utmALatLon, parseCoords: parseCoords,
    enChile: enChile, fmtCoord: fmtCoord, aDMS: aDMS
  };
})(window);
