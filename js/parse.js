/* parse.js - lee la lista de sitios/enlaces que pega el usuario.
   Formatos aceptados (una entrada por linea):
     Nombre; -33.4433; -70.6512                    -> sitio candidato
     Nombre  -33.4433  -70.6512  h=30              -> con altura de torre
     Nombre  33°26'12.5"S 70°39'02.1"W             -> sexagesimal
     Nombre  19S 345678 6298765                    -> UTM 19S
     13_1234                                       -> sitio de la red por codigo
     Cliente X -33.44,-70.65 -> 13_1234            -> enlace punto A -> punto B
   Tambien acepta pegar una tabla con cabecera (Excel/CSV): detecta las columnas
   nombre / lat / lon / altura. Lineas con # se ignoran. */
(function (global) {
  'use strict';

  var SEP_ENLACE = /\s*(?:->|=>|-->|==>)\s*/;
  var RE_ALTURA = /(?:^|[\s;,|])(?:h|alt|altura|torre)\s*[=:]\s*(\d{1,3}(?:[.,]\d+)?)\s*m?\b/i;
  var RE_ALTURA_AT = /@\s*(\d{1,3}(?:[.,]\d+)?)\s*m?\b/;

  function detectarSeparador(linea) {
    var cands = ['\t', ';', '|', ','];
    var mejor = null;
    for (var i = 0; i < cands.length; i++) {
      var n = linea.split(cands[i]).length - 1;
      if (n > 0 && (!mejor || n > mejor.n)) mejor = { sep: cands[i], n: n };
    }
    return mejor ? mejor.sep : null;
  }

  function esCabecera(linea) {
    var t = linea.toLowerCase();
    return /\blat/.test(t) && /\blon|\blong/.test(t);
  }

  function mapaCabecera(campos) {
    var m = { nombre: -1, lat: -1, lon: -1, altura: -1 };
    for (var i = 0; i < campos.length; i++) {
      var c = campos[i].toLowerCase().trim();
      if (m.lat < 0 && /^lat|latitud/.test(c)) m.lat = i;
      else if (m.lon < 0 && /^lon|^long|longitud/.test(c)) m.lon = i;
      else if (m.altura < 0 && /alt|torre|height|mastil/.test(c)) m.altura = i;
      else if (m.nombre < 0 && /nombre|sitio|site|codigo|id|candidato|punto|cliente|enlace/.test(c)) m.nombre = i;
    }
    if (m.nombre < 0) m.nombre = 0;
    return m;
  }

  function num(v) {
    if (v == null) return null;
    var f = parseFloat(String(v).replace(',', '.').replace(/[^\d.\-]/g, ''));
    return isFinite(f) ? f : null;
  }

  function extraerAltura(txt) {
    var m = RE_ALTURA.exec(txt) || RE_ALTURA_AT.exec(txt);
    if (!m) return { altura: null, resto: txt };
    var h = num(m[1]);
    return { altura: (h != null && h > 0 && h < 200) ? h : null, resto: txt.replace(m[0], ' ') };
  }

  function limpiarNombre(txt) {
    return String(txt || '')
      .replace(/^[\s;,|:\-]+|[\s;,|:\-]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /* Resuelve un extremo del enlace: codigo de la red o coordenadas libres. */
  function parseExtremo(txt, inv) {
    var t = String(txt || '').trim();
    if (!t) return null;

    var a = extraerAltura(t);
    t = a.resto;

    // 1) referencia a un sitio de la red
    var soloRef = limpiarNombre(t);
    if (inv && soloRef) {
      var s = inv.buscarId(soloRef);
      if (s) {
        return {
          nombre: s.id + ' - ' + s.nombre, lat: s.lat, lon: s.lon,
          altura: a.altura || s.altura || null, deRed: true, sitio: s, formato: 'red'
        };
      }
    }

    // 2) coordenadas dentro del texto
    var c = Geo.parseCoords(t);
    if (!c) {
      // ultimo intento: quizas el nombre incluye el codigo entre otras palabras
      if (inv) {
        var tok = soloRef.split(/[\s;,|]+/);
        for (var i = 0; i < tok.length; i++) {
          if (tok[i].length < 4) continue;
          var s2 = inv.buscarId(tok[i]);
          if (s2) {
            return {
              nombre: s2.id + ' - ' + s2.nombre, lat: s2.lat, lon: s2.lon,
              altura: a.altura || s2.altura || null, deRed: true, sitio: s2, formato: 'red'
            };
          }
        }
      }
      return null;
    }
    return {
      nombre: limpiarNombre(c.resto) || null, lat: c.lat, lon: c.lon,
      altura: a.altura, deRed: false, formato: c.formato
    };
  }

  /* Devuelve { entradas: [...], errores: [{linea, texto, motivo}] } */
  function parseEntrada(texto, inv) {
    var lineas = String(texto || '').split(/\r?\n/);
    var entradas = [], errores = [], cab = null, sepCab = null;

    for (var li = 0; li < lineas.length; li++) {
      var cruda = lineas[li];
      var linea = cruda.replace(/^﻿/, '').trim();
      if (!linea || linea.charAt(0) === '#') continue;

      // cabecera de tabla: fija el mapeo de columnas para las siguientes lineas
      if (!cab && esCabecera(linea)) {
        sepCab = detectarSeparador(linea) || '\t';
        cab = mapaCabecera(linea.split(sepCab));
        continue;
      }

      var res = null, motivo = '';

      // A -> B (enlace explicito)
      if (SEP_ENLACE.test(linea)) {
        var partes = linea.split(SEP_ENLACE);
        if (partes.length >= 2) {
          var A = parseExtremo(partes[0], inv), B = parseExtremo(partes[1], inv);
          if (A && B) {
            res = {
              tipo: 'enlace', nombre: (A.nombre || 'A') + ' → ' + (B.nombre || 'B'),
              a: A, b: B, crudo: linea, linea: li + 1
            };
          } else {
            motivo = !A ? 'no se pudo leer el extremo A' : 'no se pudo leer el extremo B';
          }
        }
      }

      // tabla con cabecera
      if (!res && cab) {
        var campos = linea.split(sepCab);
        var lat = num(campos[cab.lat]), lon = num(campos[cab.lon]);
        if (lat != null && lon != null) {
          if (!Geo.enChile(lat, lon) && Geo.enChile(lon, lat)) { var tmp = lat; lat = lon; lon = tmp; }
          if (Geo.enChile(lat, lon)) {
            res = {
              tipo: 'sitio', nombre: limpiarNombre(campos[cab.nombre]) || ('Punto ' + (entradas.length + 1)),
              lat: lat, lon: lon,
              altura: cab.altura >= 0 ? num(campos[cab.altura]) : null,
              crudo: linea, linea: li + 1, formato: 'tabla'
            };
          } else motivo = 'coordenadas fuera de Chile (' + lat + ', ' + lon + ')';
        }
      }

      // sitio suelto
      if (!res && !motivo) {
        var P = parseExtremo(linea, inv);
        if (P) {
          res = {
            tipo: 'sitio', nombre: P.nombre || ('Punto ' + (entradas.length + 1)),
            lat: P.lat, lon: P.lon, altura: P.altura,
            deRed: P.deRed, sitio: P.sitio, crudo: linea, linea: li + 1, formato: P.formato
          };
        } else {
          motivo = 'sin coordenadas reconocibles ni codigo de sitio de la red';
        }
      }

      if (res) entradas.push(res);
      else errores.push({ linea: li + 1, texto: linea, motivo: motivo || 'formato no reconocido' });
    }
    return { entradas: entradas, errores: errores };
  }

  global.Parse = { parseEntrada: parseEntrada, parseExtremo: parseExtremo };
})(window);
