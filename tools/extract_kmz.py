#!/usr/bin/env python3
"""Convierte KML/KMZ de antenas e infraestructura en capas compactas para la web.

Maneja los dos modos en que llegan estos archivos:

* **descripción HTML** (SUBTEL): cada placemark trae los campos dentro de
  ``<description>`` como ``<b>Campo:</b> valor``. Cada antena aparece repetida
  una vez por tecnología y banda —52.432 placemarks para 16.953 coordenadas—,
  así que se consolida por posición.
* **esquema SimpleData** (OOII, Torrecom): los campos vienen en
  ``<ExtendedData><SchemaData><SimpleData name="...">``. El juego de nombres
  identifica la fuente y se traduce con los perfiles de abajo.

Uso:
    python3 tools/extract_kmz.py antenas_servicio_chile.kmz -o data/capa_servicio.json
    python3 tools/extract_kmz.py Consolidado_OOII_Mar_2026.kml -o data/capa_ooii.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

RE_PM = re.compile(r'<Placemark\b.*?</Placemark>', re.S)
RE_NOMBRE = re.compile(r'<name>(.*?)</name>', re.S)
RE_COORD = re.compile(r'<coordinates>\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)')
RE_SIMPLE = re.compile(r'<SimpleData name="([^"]+)">(.*?)</SimpleData>', re.S)
RE_ALTURA = re.compile(r'altura\s+([\d.]+)\s*m')
RE_MHZ = re.compile(r'(\d{3,4})\s*MHz')
RE_DESC = {
    'operador': re.compile(r'<b>Operador:</b>\s*([^<]*)'),
    'id': re.compile(r'<b>ID sitio:</b>\s*([^<]*)'),
    'tecnologia': re.compile(r'<b>Tecnologia:</b>\s*([^<]*)'),
    'banda': re.compile(r'<b>Banda:</b>\s*([^<]*)'),
    'soporte': re.compile(r'<b>Soporte:</b>\s*([^<]*)'),
    'direccion': re.compile(r'<b>Direccion:</b>\s*([^<]*)'),
    'comuna': re.compile(r'<b>Comuna:</b>\s*([^<]*)'),
}

TECNOLOGIAS = ['2G', '3G', '4G', '5G']

# Marcas de operador móvil, para el modo descripción de SUBTEL.
MARCAS_MOVIL = [
    ('CLARO', ('CLARO',)),
    ('ENTEL', ('ENTEL',)),
    ('MOVISTAR', ('MOVISTAR', 'TELEFÓNICA', 'TELEFONICA')),
    ('WOM', ('WOM', 'NEXTEL')),
    ('WILL', ('WILL',)),
    ('VTR', ('VTR',)),
    ('BORDER', ('BORDER',)),
]

# Perfiles del modo esquema: se elige el primero cuyos campos «detectar» estén
# todos presentes. Cada destino apunta al nombre del SimpleData de origen.
PERFILES = [
    {
        'nombre': 'ooii',
        'detectar': ['layer_name'],
        'campos': {'marca_cruda': 'layer_name'},
        'usa_name': True,
    },
    {
        'nombre': 'torrecom',
        'detectar': ['ID_TORRECOM'],
        'campos': {
            'id': 'ID_TORRECOM', 'nombre': 'Nombre_Sitio_Torrecom', 'comuna': 'Comuna',
            'soporte': 'Tipo_Sitio', 'altura': 'Altura_validada',
            'estado': 'STATUS', 'zona': 'Zonificacion',
        },
        'marca_fija': 'TORRECOM',
        'usa_name': False,
    },
]


def marca_movil(operador: str) -> str:
    o = operador.upper()
    for marca, claves in MARCAS_MOVIL:
        if any(k in o for k in claves):
            return marca
    return 'OTROS'


def marca_infra(layer_name: str) -> str:
    """«ATC 2025» → ATC. El rótulo crudo se conserva aparte, porque a veces
    lleva una advertencia como «WOM incompleto» que no conviene perder."""
    t = re.sub(r'\b(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic|'
               r'enero|marzo|abril|junio|julio|agosto|20\d\d)\b', '',
               layer_name, flags=re.I)
    t = re.sub(r'\bincompleto\b', '', t, flags=re.I)
    return (t.strip(' -_.').upper() or 'OTROS')


def desescapar(s: str) -> str:
    return (s.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
             .replace('&quot;', '"').replace('&#39;', "'").strip())


def leer(ruta: Path) -> str:
    """Acepta .kmz (zip con un .kml adentro) o .kml suelto."""
    if zipfile.is_zipfile(ruta):
        with zipfile.ZipFile(ruta) as z:
            nombre = next((n for n in z.namelist() if n.lower().endswith('.kml')), None)
            if not nombre:
                raise SystemExit(f'{ruta}: el KMZ no contiene ningún .kml')
            return z.read(nombre).decode('utf-8', 'replace')
    return ruta.read_text(encoding='utf-8', errors='replace')


def elegir_perfil(texto: str):
    campos = set(RE_SIMPLE.findall(texto[:200000]))
    nombres = {n for n, _ in campos}
    for p in PERFILES:
        if all(c in nombres for c in p['detectar']):
            return p
    return None


def extraer(ruta: Path, titulo_cli: str | None) -> dict:
    texto = leer(ruta)
    m = RE_NOMBRE.search(texto)
    titulo = titulo_cli or (desescapar(m.group(1)) if m else ruta.stem)
    perfil = elegir_perfil(texto)

    puntos: dict[tuple[int, int], dict] = {}
    descartes = Counter()
    total = 0

    for pm in RE_PM.finditer(texto):
        bloque = pm.group(0)
        total += 1
        c = RE_COORD.search(bloque)
        if not c:
            descartes['sin coordenadas'] += 1
            continue
        lon, lat = float(c.group(1)), float(c.group(2))
        if not (-56.5 <= lat <= -17.0 and -110.0 <= lon <= -66.0):
            descartes['fuera de Chile'] += 1
            continue

        nom = RE_NOMBRE.search(bloque)
        nombre = desescapar(nom.group(1)) if nom else ''
        d = {'nombre': nombre, 'id': '', 'marca': 'OTROS', 'estado': '',
             'soporte': '', 'altura': 0.0, 'comuna': '', 'tec': set(), 'bandas': set()}

        if perfil:
            campos = {k: desescapar(v) for k, v in RE_SIMPLE.findall(bloque)}
            g = perfil['campos']
            if 'marca_cruda' in g:
                crudo = campos.get(g['marca_cruda'], '')
                d['marca'] = marca_infra(crudo)
                d['estado'] = crudo
            else:
                d['marca'] = perfil.get('marca_fija', 'OTROS')
            for destino in ('id', 'comuna', 'soporte'):
                if destino in g:
                    d[destino] = campos.get(g[destino], '')
            if 'nombre' in g and campos.get(g['nombre']):
                d['nombre'] = campos[g['nombre']]
            if 'altura' in g:
                try:
                    d['altura'] = float(campos.get(g['altura'], '') or 0)
                except ValueError:
                    d['altura'] = 0.0
            if 'estado' in g:
                partes = [campos.get(g['estado'], ''), campos.get(g.get('zona', ''), '')]
                d['estado'] = ' · '.join(x for x in partes if x)
        else:
            campos = {}
            for k, rx in RE_DESC.items():
                mm = rx.search(bloque)
                campos[k] = desescapar(mm.group(1)) if mm else ''
            if not campos['operador'] and not campos['id']:
                descartes['sin campos reconocibles'] += 1
                continue
            d['id'] = campos['id']
            d['marca'] = marca_movil(campos['operador'])
            d['comuna'] = campos['comuna'].split('/')[0].strip()
            if campos['soporte']:
                d['soporte'] = campos['soporte'].split(' - ')[0].strip()
                a = RE_ALTURA.search(campos['soporte'])
                if a:
                    d['altura'] = float(a.group(1))
            d['tec'] = {t for t in TECNOLOGIAS if t in campos['tecnologia']}
            d['bandas'] = {int(x) for x in RE_MHZ.findall(campos['banda'])}

        # 5 decimales ≈ 1 m: suficiente para identificar el emplazamiento
        clave = (round(lat * 1e5), round(lon * 1e5))
        p = puntos.get(clave)
        if p is None:
            p = puntos[clave] = {
                'lat': lat, 'lon': lon, 'nombre': d['nombre'], 'ids': set(), 'marcas': set(),
                'tec': set(), 'bandas': set(), 'soportes': set(), 'altura': 0.0,
                'comuna': '', 'estados': set(), 'elementos': 0,
            }
        p['elementos'] += 1
        if d['id']:
            p['ids'].add(d['id'])
        p['marcas'].add(d['marca'])
        p['tec'] |= d['tec']
        p['bandas'] |= d['bandas']
        if d['soporte']:
            p['soportes'].add(d['soporte'])
        if d['estado']:
            p['estados'].add(d['estado'])
        p['altura'] = max(p['altura'], d['altura'])
        if d['comuna'] and not p['comuna']:
            p['comuna'] = d['comuna']
        if len(d['nombre']) > len(p['nombre']):
            p['nombre'] = d['nombre']

    return {'titulo': titulo, 'puntos': puntos, 'total': total,
            'descartes': descartes, 'perfil': perfil['nombre'] if perfil else 'descripcion'}


def empaquetar(datos: dict) -> dict:
    """Arreglos paralelos con diccionarios: mismo criterio que build_web.py.

    Las máscaras de marca se arman contra el diccionario *de esta capa*, no
    contra una lista global: las capas de infraestructura tienen su propio
    universo de empresas y no comparten el de los operadores móviles.
    """
    puntos = sorted(datos['puntos'].values(), key=lambda p: (p['lat'], p['lon']))

    marcas = sorted({m for p in puntos for m in p['marcas']})
    soportes = sorted({s for p in puntos for s in p['soportes']})
    comunas = sorted({p['comuna'] for p in puntos if p['comuna']})
    bandas = sorted({b for p in puntos for b in p['bandas']})
    estados = sorted({e for p in puntos for e in p['estados']})
    idx = lambda lst: {v: i for i, v in enumerate(lst)}
    i_sop, i_com, i_ban, i_est = idx(soportes), idx(comunas), idx(bandas), idx(estados)

    lat, lon = [], []
    ant_lat = ant_lon = 0
    for p in puntos:
        # delta sobre enteros de 1e5: los puntos van ordenados, así que los
        # incrementos son pequeños y el JSON queda mucho más corto
        la, lo = round(p['lat'] * 1e5), round(p['lon'] * 1e5)
        lat.append(la - ant_lat)
        lon.append(lo - ant_lon)
        ant_lat, ant_lon = la, lo

    def mascara(vals, universo):
        return sum(1 << universo.index(v) for v in vals if v in universo)

    return {
        'titulo': datos['titulo'],
        'perfil': datos['perfil'],
        'n': len(puntos),
        'dic': {'marcas': marcas, 'soportes': soportes, 'comunas': comunas,
                'bandas': bandas, 'estados': estados},
        'lat': lat,
        'lon': lon,
        'marca': [mascara(p['marcas'], marcas) for p in puntos],
        'tec': [mascara(p['tec'], TECNOLOGIAS) for p in puntos],
        'sop': [i_sop.get(next(iter(sorted(p['soportes'])), ''), -1) for p in puntos],
        'alt': [round(p['altura']) for p in puntos],
        'com': [i_com.get(p['comuna'], -1) for p in puntos],
        'ban': [sorted(i_ban[b] for b in p['bandas']) for p in puntos],
        # sólo las capas que traen estado de obra pagan este arreglo
        **({'est': [i_est.get(next(iter(sorted(p['estados'])), ''), -1) for p in puntos]}
           if estados else {}),
        'nom': [p['nombre'] for p in puntos],
        'sid': [sorted(p['ids'])[0] if p['ids'] else '' for p in puntos],
        'el': [p['elementos'] for p in puntos],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('fuente', type=Path, help='archivo .kmz o .kml')
    ap.add_argument('-o', '--salida', type=Path, required=True)
    ap.add_argument('--titulo', default=None, help='rótulo de la capa')
    args = ap.parse_args()

    datos = extraer(args.fuente, args.titulo)
    paquete = empaquetar(datos)
    args.salida.parent.mkdir(parents=True, exist_ok=True)
    args.salida.write_text(json.dumps(paquete, ensure_ascii=False, separators=(',', ':')),
                           encoding='utf-8')

    print(json.dumps({
        'archivo': args.fuente.name,
        'titulo': paquete['titulo'],
        'perfil': paquete['perfil'],
        'placemarks': datos['total'],
        'emplazamientos': paquete['n'],
        'marcas': paquete['dic']['marcas'],
        'descartes': dict(datos['descartes']),
        'kb': round(args.salida.stat().st_size / 1024, 1),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
