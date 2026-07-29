#!/usr/bin/env python3
"""Extrae el inventario de sitios de la RED desde los dumps CGI (Nokia + Huawei).

Lee las hojas 2G / 3G / LTE / 5G de cada workbook, consolida por codigo de sitio
y emite un JSON compacto con una fila por sitio (coordenadas, comuna, region,
tecnologias presentes, sectores, altura de antenas y proveedor).

Uso:  python3 tools/extract_sites.py <xlsx> [<xlsx> ...] -o data/sites.json
"""
import argparse, collections, json, os, re, statistics, sys, zipfile
import xml.etree.ElementTree as ET

NS = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'

# Nombres alternativos por campo logico -> cabeceras vistas en los dumps.
FIELD_ALIASES = {
    'site':      ['Codigo Sitio', 'SITE', 'Site'],
    'name':      ['Site Name', 'Nodebname', 'gNodeB', 'BTS name', 'WBTS name'],
    'lat':       ['Latitud', 'Latitude', 'Lat'],
    'lon':       ['Longitud', 'Longitude', 'Long'],
    'height':    ['Altura Antenas', 'altura'],
    'azimuth':   ['Azimuth'],
    'region':    ['Region'],
    'comuna':    ['Comuna'],
    'com_code':  ['Codigo Comuna'],
    'address':   ['Direccion'],
    'city':      ['Ciudad', 'CIUDAD'],
    'status':    ['Status On Air', 'Status ON AIR'],
    'morpho':    ['EMPLAZAMIENTO SUBTEL', 'Emplazamiento Subtel', 'Emplazamiento_Subtel'],
    'urbanity':  ['Urbano - rural o suburbano'],
    'position':  ['Clasificacion', 'Position Type (Outdoor/Indoor)', 'PositionType'],
    'sector':    ['SectorType', 'Sector Type (Macro/Micro/DAS/Pico)'],
    'vendor':    ['Proveedor', 'PROVEEDOR'],
    'band':      ['FrequencyBand'],
    'earfcn':    ['EARFCN', 'nrarfcn'],
    'controller':['BSC', 'RNC', 'BSC/RNC/MME', 'gNodeB'],
    'ip':        ['SIGIP1V4', 'IP'],
}

TECH_ORDER = ['2G', '3G', 'LTE', '5G']


def sheet_tech(sheet_name):
    s = sheet_name.upper()
    for t in TECH_ORDER:
        if s.startswith(t):
            return t
    if s.startswith('4G'):
        return 'LTE'
    if s.startswith('NR'):
        return '5G'
    return sheet_name


def load_shared_strings(z):
    out = []
    if 'xl/sharedStrings.xml' not in z.namelist():
        return out
    with z.open('xl/sharedStrings.xml') as fh:
        for _, el in ET.iterparse(fh, events=('end',)):
            if el.tag == NS + 'si':
                out.append(''.join(t.text or '' for t in el.iter(NS + 't')))
                el.clear()
    return out


def col_letters(ref):
    return ''.join(c for c in ref if c.isalpha())


def iter_rows(z, sheet_path, shared):
    """Streaming row reader: dict {columna -> valor}."""
    with z.open(sheet_path) as fh:
        for _, el in ET.iterparse(fh, events=('end',)):
            if el.tag != NS + 'row':
                continue
            row = {}
            for c in el.iter(NS + 'c'):
                v = c.find(NS + 'v')
                if v is None or v.text is None:
                    continue
                if c.get('t') == 's':
                    try:
                        row[col_letters(c.get('r'))] = shared[int(v.text)]
                    except (ValueError, IndexError):
                        row[col_letters(c.get('r'))] = v.text
                else:
                    row[col_letters(c.get('r'))] = v.text
            yield row
            el.clear()


def sheet_index(z):
    """[(nombre, ruta)] respetando el orden del workbook."""
    wb = z.read('xl/workbook.xml').decode('utf-8', 'replace')
    rels = z.read('xl/_rels/workbook.xml.rels').decode('utf-8', 'replace')
    rid2target = dict(re.findall(r'Id="([^"]+)"[^>]*Target="([^"]+)"', rels))
    out = []
    for m in re.finditer(r'<sheet\b[^>]*>', wb):
        tag = m.group(0)
        name = re.search(r'name="([^"]+)"', tag)
        rid = re.search(r'r:id="([^"]+)"', tag)
        if not (name and rid):
            continue
        target = rid2target.get(rid.group(1), '')
        if not target:
            continue
        path = target if target.startswith('xl/') else 'xl/' + target.lstrip('/')
        if path in z.namelist():
            out.append((name.group(1), path))
    return out


def num(val):
    if val is None:
        return None
    try:
        f = float(str(val).strip().replace(',', '.'))
    except (TypeError, ValueError):
        return None
    return f if f == f and abs(f) != float('inf') else None


def clean(val):
    if val is None:
        return None
    s = str(val).strip()
    return s or None


class Site:
    __slots__ = ('code', 'names', 'lats', 'lons', 'heights', 'techs', 'vendors',
                 'region', 'comuna', 'com_code', 'address', 'city', 'status',
                 'morpho', 'urbanity', 'position', 'sector', 'bands', 'sources',
                 'azimuths', 'has_ip')

    def __init__(self, code):
        self.code = code
        self.names = collections.Counter()
        self.lats, self.lons, self.heights = [], [], []
        self.techs = collections.Counter()
        self.vendors = collections.Counter()
        self.bands = collections.Counter()
        self.sources = set()
        self.azimuths = set()
        self.has_ip = False
        for f in ('region', 'comuna', 'com_code', 'address', 'city', 'status',
                  'morpho', 'urbanity', 'position', 'sector'):
            setattr(self, f, collections.Counter())


def mode(counter):
    return counter.most_common(1)[0][0] if counter else None


def process_workbook(path, sites, stats):
    z = zipfile.ZipFile(path)
    shared = load_shared_strings(z)
    label = nombre_limpio(path)
    vendor_hint = 'HUAWEI' if 'HUAWEI' in label.upper() else 'NOKIA'
    for sheet_name, sheet_path in sheet_index(z):
        tech = sheet_tech(sheet_name)
        it = iter_rows(z, sheet_path, shared)
        try:
            header = next(it)
        except StopIteration:
            continue
        # cabecera -> columna, y campo logico -> columna
        by_header = {}
        for colref, val in header.items():
            h = clean(val)
            if h:
                by_header.setdefault(h.strip(), colref)
        cmap = {}
        for field, aliases in FIELD_ALIASES.items():
            for a in aliases:
                if a in by_header:
                    cmap[field] = by_header[a]
                    break
        if 'site' not in cmap:
            stats['sheets_skipped'].append(f'{label}:{sheet_name} (sin columna de sitio)')
            continue
        n_rows = n_used = 0
        for row in it:
            n_rows += 1
            code = clean(row.get(cmap['site']))
            if not code:
                continue
            code = code.upper()
            lat = num(row.get(cmap.get('lat'))) if 'lat' in cmap else None
            lon = num(row.get(cmap.get('lon'))) if 'lon' in cmap else None
            s = sites.get(code)
            if s is None:
                s = sites[code] = Site(code)
            n_used += 1
            s.techs[tech] += 1
            s.sources.add(vendor_hint)
            if lat is not None and -90 <= lat <= 90 and lat != 0:
                s.lats.append(lat)
            if lon is not None and -180 <= lon <= 180 and lon != 0:
                s.lons.append(lon)
            h = num(row.get(cmap.get('height'))) if 'height' in cmap else None
            if h is not None and 0 < h < 200:
                s.heights.append(h)
            az = num(row.get(cmap.get('azimuth'))) if 'azimuth' in cmap else None
            if az is not None and 0 <= az <= 360:
                s.azimuths.add(int(round(az)) % 360)
            nm = clean(row.get(cmap.get('name'))) if 'name' in cmap else None
            if nm:
                s.names[nm] += 1
            vd = clean(row.get(cmap.get('vendor'))) if 'vendor' in cmap else None
            s.vendors[(vd or vendor_hint).upper()] += 1
            bd = clean(row.get(cmap.get('band'))) if 'band' in cmap else None
            if bd:
                s.bands[bd] += 1
            if 'ip' in cmap and clean(row.get(cmap['ip'])):
                s.has_ip = True
            for f in ('region', 'comuna', 'com_code', 'address', 'city', 'status',
                      'morpho', 'urbanity', 'position', 'sector'):
                if f in cmap:
                    v = clean(row.get(cmap[f]))
                    if v:
                        getattr(s, f)[v] += 1
        stats['sheets'].append({'file': label, 'sheet': sheet_name, 'tech': tech,
                                'rows': n_rows, 'cells_usadas': n_used,
                                'columnas_mapeadas': len(cmap)})


def nombre_limpio(path):
    """Nombre del archivo sin el hash que agregan las subidas."""
    return re.sub(r'^[0-9a-f]{6,}-', '', os.path.basename(path))


def build(paths, out_path):
    sites = {}
    stats = {'sheets': [], 'sheets_skipped': [], 'archivos': [nombre_limpio(p) for p in paths]}
    for p in paths:
        process_workbook(p, sites, stats)

    records, sin_coords = [], 0
    for code, s in sites.items():
        if not s.lats or not s.lons:
            sin_coords += 1
            continue
        lat = round(statistics.median(s.lats), 6)
        lon = round(statistics.median(s.lons), 6)
        rec = {
            'id': code,
            'nombre': mode(s.names) or code,
            'lat': lat,
            'lon': lon,
            'alt_ant': round(statistics.median(s.heights), 1) if s.heights else None,
            'region': mode(s.region),
            'comuna': mode(s.comuna),
            'ciudad': mode(s.city),
            'direccion': mode(s.address),
            'morfologia': (mode(s.morpho) or '').upper() or None,
            'urbanidad': mode(s.urbanity),
            'posicion': (mode(s.position) or '').upper() or None,
            'sector': mode(s.sector),
            'estado': mode(s.status),
            'proveedor': '/'.join(sorted({v for v in s.vendors})[:2]),
            'techs': [t for t in TECH_ORDER if s.techs.get(t)],
            'celdas': {t: s.techs[t] for t in TECH_ORDER if s.techs.get(t)},
            'sectores': len(s.azimuths) or None,
            'ip': s.has_ip,
            'disp_coord_m': None,
        }
        # dispersion de coordenadas entre hojas (control de calidad del dato)
        if len(s.lats) > 1:
            spread_lat = (max(s.lats) - min(s.lats)) * 111320
            spread_lon = (max(s.lons) - min(s.lons)) * 111320 * 0.83
            rec['disp_coord_m'] = round(max(spread_lat, spread_lon), 1)
        records.append(rec)

    records.sort(key=lambda r: r['id'])
    stats['sitios_total'] = len(records)
    stats['sitios_sin_coordenadas'] = sin_coords
    stats['por_tecnologia'] = {t: sum(1 for r in records if t in r['techs']) for t in TECH_ORDER}
    stats['por_region'] = dict(collections.Counter(r['region'] for r in records if r['region']).most_common())

    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    with open(out_path, 'w', encoding='utf-8') as fh:
        json.dump({'meta': stats, 'sitios': records}, fh, ensure_ascii=False, separators=(',', ':'))
    return stats


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('xlsx', nargs='+')
    ap.add_argument('-o', '--out', default='data/sites.json')
    a = ap.parse_args()
    st = build(a.xlsx, a.out)
    print(json.dumps(st, ensure_ascii=False, indent=2)[:4000])
