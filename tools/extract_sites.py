#!/usr/bin/env python3
"""
Consolida los inventarios CGI (Nokia + Huawei) en un unico inventario de SITIOS
para la web de factibilidad de enlaces.

Uso:
    python3 tools/extract_sites.py CGI_20260713.xlsx CGI_HUAWEI_20260713.xlsx -o data/sites.js

Cada archivo debe tener las hojas 2G / 2G_FLEXI, 3G, LTE y 5G con las cabeceras
originales del reporte CGI. La salida es un archivo JS con la variable global
RED_SITIOS (asi la web funciona abriendo index.html directo, sin servidor).
"""
import argparse, json, math, os, re, sys, warnings
from collections import defaultdict

warnings.filterwarnings("ignore")
import openpyxl

# hoja -> (tecnologia, campo_lat, campo_lon)
SHEETS = {
    "2G":       ("2G", "Latitud", "Longitud"),
    "2G_FLEXI": ("2G", "Latitud", "Longitud"),
    "3G":       ("3G", "Latitud", "Longitud"),
    "LTE":      ("4G", "Latitude", "Longitude"),
    "5G":       ("5G", "Lat", "Long"),
}
# Orden importante: la hoja LTE trae 'Codigo Sitio' (01i_006) y tambien 'Site'
# (01i_006_4G / 01iM564), que es el nombre del nodo y no el codigo de sitio.
SITE_KEYS = ["Codigo Sitio", "SITE", "Site"]
TECH_SUFFIX = re.compile(r"_(2G|3G|4G|5G)$", re.I)
CHILE = dict(lat_min=-56.5, lat_max=-17.0, lon_min=-110.0, lon_max=-66.0)


def norm(s):
    return re.sub(r"\s+", " ", str(s)).strip() if s is not None else ""


def num(v):
    if v is None or v == "":
        return None
    try:
        f = float(str(v).replace(",", "."))
        return f if math.isfinite(f) else None
    except (TypeError, ValueError):
        return None


def pick(row, hdr, *names):
    for n in names:
        if n in hdr:
            v = row[hdr[n]]
            if v is not None and norm(v) != "":
                return v
    return None


def read_sheet(ws, tech, lat_f, lon_f, vendor_default, sites, stats):
    ws.reset_dimensions()
    rows = ws.iter_rows(values_only=True)
    try:
        header = next(rows)
    except StopIteration:
        return
    hdr = {norm(h): i for i, h in enumerate(header) if norm(h)}
    site_col = next((hdr[k] for k in SITE_KEYS if k in hdr), None)
    if site_col is None:
        stats["hojas_sin_sitio"].append(ws.title)
        return

    for row in rows:
        if row is None or len(row) <= site_col:
            continue
        code = TECH_SUFFIX.sub("", norm(row[site_col]))
        if not code or code in SITE_KEYS:
            continue
        stats["celdas"][tech] += 1

        lat, lon = num(pick(row, hdr, lat_f)), num(pick(row, hdr, lon_f))
        # algunos reportes traen lat/lon invertidas: corregir por rango
        if lat is not None and lon is not None and not (CHILE["lat_min"] <= lat <= CHILE["lat_max"]):
            if CHILE["lat_min"] <= lon <= CHILE["lat_max"]:
                lat, lon = lon, lat

        s = sites[code]
        s["codigo"] = code
        s.setdefault("tec", {})
        s["tec"][tech] = s["tec"].get(tech, 0) + 1

        if lat is not None and lon is not None and \
           CHILE["lat_min"] <= lat <= CHILE["lat_max"] and CHILE["lon_min"] <= lon <= CHILE["lon_max"]:
            s.setdefault("_lat", []).append(lat)
            s.setdefault("_lon", []).append(lon)

        for key, cols in (
            ("nombre",    ("Site Name",)),
            ("region",    ("Region",)),
            ("comuna",    ("Comuna",)),
            ("ciudad",    ("Ciudad", "CIUDAD")),
            ("direccion", ("Direccion",)),
            ("estado",    ("Status On Air", "Status ON AIR")),
            ("entorno",   ("Urbano - rural o suburbano",)),
            ("subtel",    ("Emplazamiento Subtel", "EMPLAZAMIENTO SUBTEL", "Emplazamiento_Subtel")),
            ("emplaz",    ("Clasificacion", "Position Type (Outdoor/Indoor)", "PositionType")),
            ("uso",       ("Uso Acceso",)),
            ("cluster",   ("Cluster Calidad",)),
        ):
            if not s.get(key):
                v = pick(row, hdr, *cols)
                if v is not None:
                    s[key] = norm(v)

        for key, cols in (("cod_comuna", ("Codigo Comuna",)), ("localidad", ("Localidad",))):
            if not s.get(key):
                v = num(pick(row, hdr, *cols))
                if v is not None:
                    s[key] = int(v)

        h = num(pick(row, hdr, "Altura Antenas", "altura"))
        if h is not None and 0 < h < 200:
            s["altura"] = max(s.get("altura") or 0, h)

        prov = norm(pick(row, hdr, "Proveedor", "PROVEEDOR") or "") or vendor_default
        s.setdefault("_prov", set()).add(prov.upper())

        # banda: EARFCN (4G) / FrequencyBand (5G)
        if tech == "4G":
            e = num(pick(row, hdr, "EARFCN"))
            if e is not None:
                s.setdefault("_earfcn", set()).add(int(e))
        elif tech == "5G":
            b = norm(pick(row, hdr, "FrequencyBand") or "")
            if b:
                s.setdefault("_nr", set()).add(b.upper())


# EARFCN -> banda LTE (rangos DL 3GPP usados en Chile)
EARFCN_BANDS = [(0, 599, "B1 2100"), (1200, 1949, "B3 1800"), (2400, 2649, "B5 850"),
                (2750, 3449, "B7 2600"), (3450, 3799, "B8 900"), (5010, 5179, "B13 700"),
                (5180, 5279, "B14 700"), (5730, 5849, "B20 800"), (6150, 6449, "B28 700"),
                (9210, 9659, "B28 700"), (9870, 9919, "B32 1500"), (36000, 36199, "B33"),
                (37750, 38249, "B38 2600"), (38650, 39649, "B40 2300"), (39650, 41589, "B41 2500")]


def earfcn_band(e):
    for lo, hi, name in EARFCN_BANDS:
        if lo <= e <= hi:
            return name
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx", nargs="+")
    ap.add_argument("-o", "--out", default="data/sites.js")
    a = ap.parse_args()

    sites = defaultdict(dict)
    stats = {"celdas": defaultdict(int), "hojas_sin_sitio": [], "archivos": []}

    for path in a.xlsx:
        vendor = "HUAWEI" if "HUAWEI" in os.path.basename(path).upper() else "NOKIA"
        print(f"-> {os.path.basename(path)} ({vendor})", file=sys.stderr)
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        for ws in wb.worksheets:
            cfg = SHEETS.get(ws.title.strip())
            if not cfg:
                print(f"   hoja ignorada: {ws.title}", file=sys.stderr)
                continue
            read_sheet(ws, *cfg, vendor, sites, stats)
            print(f"   hoja {ws.title} ok", file=sys.stderr)
        wb.close()
        stats["archivos"].append(os.path.basename(path))

    # valores que el reporte trae con casing inconsistente (u/U, iNDOOR/INDOOR...)
    UPPER = ("region", "comuna", "ciudad", "estado", "entorno", "emplaz", "subtel", "cluster")

    out, sin_coord = [], []
    for code, s in sites.items():
        lats, lons = s.pop("_lat", []), s.pop("_lon", [])
        prov = sorted(p for p in s.pop("_prov", set()) if p)
        earfcn = s.pop("_earfcn", set())
        nr = s.pop("_nr", set())
        if not lats:
            sin_coord.append(code)
            continue
        # mediana: robusta ante celdas con coordenada mal cargada
        lats, lons = sorted(lats), sorted(lons)
        mid = len(lats) // 2
        rec = {
            "id": code,
            "nombre": s.get("nombre") or code,
            "lat": round(lats[mid], 6),
            "lon": round(lons[mid], 6),
            "tec": sorted(s.get("tec", {}).keys(), key=lambda t: ["2G", "3G", "4G", "5G"].index(t)),
            "celdas": {k: v for k, v in sorted(s.get("tec", {}).items())},
            "prov": prov,
            "region": s.get("region", ""),
            "comuna": s.get("comuna", ""),
            "ciudad": s.get("ciudad", ""),
            "direccion": s.get("direccion", ""),
            "estado": s.get("estado", ""),
            "entorno": s.get("entorno", ""),
            "emplaz": s.get("emplaz", ""),
            "subtel": s.get("subtel", ""),
            "altura": s.get("altura") or None,
            "cluster": s.get("cluster", ""),
            "cod_comuna": s.get("cod_comuna"),
            "localidad": s.get("localidad"),
        }
        rec["bandas"] = sorted({b for b in (earfcn_band(e) for e in earfcn) if b}) + sorted(nr)
        for k in UPPER:
            rec[k] = (rec.get(k) or "").upper()
        out.append(rec)

    out.sort(key=lambda r: r["id"])
    meta = {
        "archivos": stats["archivos"],
        "sitios": len(out),
        "sitios_sin_coordenada": len(sin_coord),
        "celdas": dict(stats["celdas"]),
    }

    # --- serializacion columnar + diccionario -----------------------------
    # Las claves JSON repetidas 8.5k veces pesaban ~1 MB; en formato columnar
    # se escriben una sola vez y los campos de baja cardinalidad se internan.
    COLS = ["id", "nombre", "lat", "lon", "tec", "celdas", "prov", "region", "comuna",
            "ciudad", "direccion", "estado", "entorno", "emplaz", "subtel", "altura",
            "cluster", "bandas", "cod_comuna", "localidad"]
    INTERN = {"tec", "celdas", "prov", "region", "comuna", "ciudad", "estado",
              "entorno", "emplaz", "subtel", "cluster", "bandas"}
    dic, data = {}, []
    for col in COLS:
        if col in INTERN:
            idx, vals = {}, []
            column = []
            for r in out:
                k = json.dumps(r.get(col), ensure_ascii=False, sort_keys=True)
                if k not in idx:
                    idx[k] = len(vals)
                    vals.append(r.get(col))
                column.append(idx[k])
            dic[col] = vals
            data.append(column)
        else:
            data.append([r.get(col) for r in out])

    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    j = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"))
    with open(a.out, "w", encoding="utf-8") as f:
        f.write("// Generado por tools/extract_sites.py - no editar a mano.\n")
        f.write("window.RED_META = " + j(meta) + ";\n")
        f.write("window.RED_INV = " + j({"cols": COLS, "dict": dic, "data": data}) + ";\n")

    meta["dict_keys"] = {k: len(v) for k, v in dic.items()}
    print(json.dumps(meta, ensure_ascii=False, indent=2), file=sys.stderr)
    if sin_coord:
        print(f"sin coordenada ({len(sin_coord)}):", sin_coord[:10], file=sys.stderr)


if __name__ == "__main__":
    main()
