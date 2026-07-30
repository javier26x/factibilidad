/* inventory.js - expande el inventario columnar y resuelve consultas espaciales.
   Con 4.5k sitios una grilla simple de 0.1 grados basta para responder los
   vecinos mas cercanos sin recorrer todo el arreglo en cada consulta. */
(function (global) {
  'use strict';

  var CELDA = 0.1;   // grados (~11 km en latitud)

  function expandir(inv) {
    if (!inv || !inv.cols) return [];
    var cols = inv.cols, dic = inv.dict || {}, data = inv.data, n = data[0] ? data[0].length : 0;
    var sitios = new Array(n);
    for (var r = 0; r < n; r++) {
      var o = {};
      for (var c = 0; c < cols.length; c++) {
        var nombre = cols[c], v = data[c] ? data[c][r] : null;
        o[nombre] = dic[nombre] ? dic[nombre][v] : v;
      }
      sitios[r] = o;
    }
    return sitios;
  }

  function Inventario(inv, meta) {
    this.sitios = expandir(inv);
    this.meta = meta || {};
    this.porId = Object.create(null);
    this.grilla = Object.create(null);
    for (var i = 0; i < this.sitios.length; i++) {
      var s = this.sitios[i];
      s.idx = i;
      this.porId[claveId(s.id)] = s;
      var k = clave(s.lat, s.lon);
      (this.grilla[k] || (this.grilla[k] = [])).push(i);
    }
  }

  function clave(lat, lon) {
    return Math.floor(lat / CELDA) + ':' + Math.floor(lon / CELDA);
  }
  function claveId(id) {
    return String(id || '').trim().toUpperCase().replace(/\s+/g, '');
  }

  Inventario.prototype.buscarId = function (id) {
    var k = claveId(id);
    if (this.porId[k]) return this.porId[k];
    // tolera variantes: 01-001 / 01001 / 01_001_4G
    var alt = k.replace(/[-\s.]/g, '_').replace(/_(2G|3G|4G|5G)$/, '');
    if (this.porId[alt]) return this.porId[alt];
    var soloNum = k.replace(/[^0-9A-Z]/g, '');
    for (var kk in this.porId) {
      if (kk.replace(/[^0-9A-Z]/g, '') === soloNum) return this.porId[kk];
    }
    return null;
  };

  /* Busqueda libre por codigo, nombre, comuna o direccion (para el buscador) */
  Inventario.prototype.buscarTexto = function (q, limite) {
    var t = String(q || '').trim().toUpperCase();
    if (t.length < 2) return [];
    var out = [], lim = limite || 20;
    for (var i = 0; i < this.sitios.length && out.length < lim; i++) {
      var s = this.sitios[i];
      if ((s.id + ' ' + s.nombre + ' ' + s.comuna + ' ' + s.direccion).toUpperCase().indexOf(t) >= 0) out.push(s);
    }
    return out;
  };

  /* Sitios dentro de radioKm, ordenados por distancia. filtro: fn(sitio)->bool */
  Inventario.prototype.cercanos = function (lat, lon, radioKm, filtro, limite) {
    var pasos = Math.max(1, Math.ceil(radioKm / (CELDA * 111.32 * Math.cos(lat * Math.PI / 180) || 1)));
    var pasosLat = Math.max(1, Math.ceil(radioKm / (CELDA * 110.57)));
    var baseLat = Math.floor(lat / CELDA), baseLon = Math.floor(lon / CELDA);
    var vistos = [], i, j, k, lista, s, d;
    for (i = -pasosLat; i <= pasosLat; i++) {
      for (j = -pasos; j <= pasos; j++) {
        lista = this.grilla[(baseLat + i) + ':' + (baseLon + j)];
        if (!lista) continue;
        for (k = 0; k < lista.length; k++) {
          s = this.sitios[lista[k]];
          if (filtro && !filtro(s)) continue;
          d = Geo.haversine(lat, lon, s.lat, s.lon);
          if (d <= radioKm) vistos.push({ sitio: s, distKm: d, az: Geo.azimut(lat, lon, s.lat, s.lon) });
        }
      }
    }
    vistos.sort(function (a, b) { return a.distKm - b.distKm; });
    return limite ? vistos.slice(0, limite) : vistos;
  };

  /* Filtro configurable desde la interfaz */
  function construirFiltro(cfg) {
    return function (s) {
      if (cfg.soloEnServicio && !/EN SERVICIO|EN O&M/.test(s.estado || '')) return false;
      if (cfg.excluirIndoor && (s.emplaz === 'INDOOR')) return false;
      if (cfg.tecRequerida && cfg.tecRequerida.length) {
        for (var i = 0; i < cfg.tecRequerida.length; i++) {
          if ((s.tec || []).indexOf(cfg.tecRequerida[i]) < 0) return false;
        }
      }
      if (cfg.alturaMin && !(s.altura >= cfg.alturaMin)) return false;
      if (cfg.proveedor && (s.prov || []).indexOf(cfg.proveedor) < 0) return false;
      return true;
    };
  }

  /* Resumen para la cabecera */
  Inventario.prototype.resumen = function () {
    var r = { total: this.sitios.length, tec: {}, region: {}, estado: {}, prov: {} };
    for (var i = 0; i < this.sitios.length; i++) {
      var s = this.sitios[i];
      (s.tec || []).forEach(function (t) { r.tec[t] = (r.tec[t] || 0) + 1; });
      r.region[s.region] = (r.region[s.region] || 0) + 1;
      r.estado[s.estado] = (r.estado[s.estado] || 0) + 1;
      (s.prov || []).forEach(function (p) { r.prov[p] = (r.prov[p] || 0) + 1; });
    }
    return r;
  };

  global.Inv = { Inventario: Inventario, construirFiltro: construirFiltro, expandir: expandir };
})(window);
