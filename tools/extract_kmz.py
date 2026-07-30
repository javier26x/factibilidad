#!/usr/bin/env python3
"""Convierte los KMZ de antenas de SUBTEL en capas compactas para la web.

Cada antena física aparece repetida en el KML una vez por tecnología y banda
—52.432 placemarks para 16.953 coordenadas—, así que aquí se consolida por
coordenada: un punto por emplazamiento, con el conjunto de operadores,
tecnologías y bandas que conviven en él.

Uso:
    python3 tools/extract_kmz.py antenas_autorizadas_chile.kmz -o data/capa_autorizadas.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from collections import Counter
from pathlib import Path

# Un placemark por vez, sin cargar árbol XML: el doc.kml llega a 32 MB.
RE_PM = re.compile(r'<Placemark>(.*?)</Placemark>', re.S)
RE_NOMBRE = re.compile(r'<name>(.*?)</name>', re.S)
RE_COORD = re.compile(r'<coordinates>\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)')
RE_CAMPO = {
    'operador': re.compile(r'<b>Operador:</b>\s*([^<]*)'),
    'id': re.compile(r'<b>ID sitio:</b>\s*([^<]*)'),
    'tecnologia': re.compile(r'<b>Tecnologia:</b>\s*([^<]*)'),
    'banda': re.compile(r'<b>Banda:</b>\s*([^<]*)'),
    'soporte': re.compile(r'<b>Soporte:</b>\s*([^<]*)'),
    'direccion': re.compile(r'<b>Direccion:</b>\s*([^<]*)'),
    'comuna': re.compile(r'<b>Comuna:</b>\s*([^<]*)'),
}
RE_ALTURA = re.compile(r'altura\s+([\d.]+)\s*m')
RE_MHZ = re.compile(r'(\d{3,4})\s*MHz')

TECNOLOGIAS = ['2G', '3G', '4G', '5G']

# Las marcas llegan con varias razones sociales por operador; se consolidan para
# que la leyenda del mapa tenga una entrada por marca y no ocho.
MARCAS = [
    ('CLARO', ('CLARO',)),
    ('ENTEL', ('ENTEL',)),
    ('MOVISTAR', ('MOVISTAR', 'TELEFÓNICA', 'TELEFONICA')),
    ('WOM', ('WOM', 'NEXTEL')),
    ('WILL', ('WILL',)),
    ('VTR', ('VTR',)),
    ('BORDER', ('BORDER',)),
]


def marca_de(operador: str) -> str:
    o = operador.upper()
    for marca, claves in MARCAS:
        if any(k in o for k in claves):
            return marca
    return 'OTROS'


def desescapar(s: str) -> str:
    return (s.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
             .replace('&quot;', '"').replace('&#39;', "'").strip())


def leer_kmz(ruta: Path) -> str:
    with zipfile.ZipFile(ruta) as z:
        nombre = next((n for n in z.namelist() if n.lower().endswith('.kml')), None)
        if not nombre:
            raise SystemExit(f'{ruta}: el KMZ no contiene ningún .kml')
        return z.read(nombre).decode('utf-8', 'replace')


def extraer(ruta: Path) -> dict:
    texto = leer_kmz(ruta)
    titulo = (RE_NOMBRE.search(texto).group(1) if RE_NOMBRE.search(texto) else ruta.stem)

    puntos: dict[tuple[int, int], dict] = {}
    descartes = Counter()
    total = 0

    for m in RE_PM.finditer(texto):
        bloque = m.group(1)
        total += 1
        c = RE_COORD.search(bloque)
        if not c:
            descartes['sin coordenadas'] += 1
            continue
        lon, lat = float(c.group(1)), float(c.group(2))
        # Chile continental e insular; descarta ceros y coordenadas invertidas
        if not (-56.5 <= lat <= -17.0 and -110.0 <= lon <= -66.0):
            descartes['fuera de Chile'] += 1
            continue

        campos = {}
        for k, rx in RE_CAMPO.items():
            g = rx.search(bloque)
            campos[k] = desescapar(g.group(1)) if g else ''

        nom = RE_NOMBRE.search(bloque)
        nombre = desescapar(nom.group(1)) if nom else ''

        # 5 decimales ≈ 1 m: suficiente para identificar el emplazamiento
        clave = (round(lat * 1e5), round(lon * 1e5))
        p = puntos.get(clave)
        if p is None:
            p = puntos[clave] = {
                'lat': lat, 'lon': lon, 'nombre': nombre, 'ids': set(), 'marcas': set(),
                'tec': set(), 'bandas': set(), 'soportes': set(), 'altura': 0.0,
                'comuna': '', 'direccion': '', 'elementos': 0,
            }
        p['elementos'] += 1
        if campos['id']:
            p['ids'].add(campos['id'])
        if campos['operador']:
            p['marcas'].add(marca_de(campos['operador']))
        for t in TECNOLOGIAS:
            if t in campos['tecnologia']:
                p['tec'].add(t)
        for mhz in RE_MHZ.findall(campos['banda']):
            p['bandas'].add(int(mhz))
        if campos['soporte']:
            p['soportes'].add(campos['soporte'].split(' - ')[0].strip())
            a = RE_ALTURA.search(campos['soporte'])
            if a:
                p['altura'] = max(p['altura'], float(a.group(1)))
        if campos['comuna'] and not p['comuna']:
            p['comuna'] = campos['comuna'].split('/')[0].strip()
        if campos['direccion'] and not p['direccion']:
            p['direccion'] = campos['direccion']
        # el nombre más largo suele ser el más descriptivo
        if len(nombre) > len(p['nombre']):
            p['nombre'] = nombre

    return {'titulo': titulo, 'puntos': puntos, 'total': total, 'descartes': descartes}


def empaquetar(datos: dict) -> dict:
    """Arreglos paralelos con diccionarios: mismo criterio que build_web.py."""
    puntos = sorted(datos['puntos'].values(), key=lambda p: (p['lat'], p['lon']))

    marcas = [m for m, _ in MARCAS] + ['OTROS']
    soportes = sorted({s for p in puntos for s in p['soportes']})
    comunas = sorted({p['comuna'] for p in puntos if p['comuna']})
    bandas = sorted({b for p in puntos for b in p['bandas']})
    idx_sop = {s: i for i, s in enumerate(soportes)}
    idx_com = {c: i for i, c in enumerate(comunas)}
    idx_ban = {b: i for i, b in enumerate(bandas)}

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
        'n': len(puntos),
        'dic': {'marcas': marcas, 'soportes': soportes, 'comunas': comunas, 'bandas': bandas},
        'lat': lat,
        'lon': lon,
        'marca': [mascara(p['marcas'], marcas) for p in puntos],
        'tec': [mascara(p['tec'], TECNOLOGIAS) for p in puntos],
        'sop': [idx_sop.get(next(iter(sorted(p['soportes'])), ''), -1) for p in puntos],
        'alt': [round(p['altura']) for p in puntos],
        'com': [idx_com.get(p['comuna'], -1) for p in puntos],
        'ban': [sorted(idx_ban[b] for b in p['bandas']) for p in puntos],
        'nom': [p['nombre'] for p in puntos],
        'sid': [sorted(p['ids'])[0] if p['ids'] else '' for p in puntos],
        'el': [p['elementos'] for p in puntos],
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('kmz', type=Path)
    ap.add_argument('-o', '--salida', type=Path, required=True)
    args = ap.parse_args()

    datos = extraer(args.kmz)
    paquete = empaquetar(datos)
    args.salida.parent.mkdir(parents=True, exist_ok=True)
    args.salida.write_text(json.dumps(paquete, ensure_ascii=False, separators=(',', ':')),
                           encoding='utf-8')

    print(json.dumps({
        'archivo': args.kmz.name,
        'titulo': paquete['titulo'],
        'placemarks': datos['total'],
        'emplazamientos': paquete['n'],
        'descartes': dict(datos['descartes']),
        'kb': round(args.salida.stat().st_size / 1024, 1),
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
