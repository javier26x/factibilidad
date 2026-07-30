#!/usr/bin/env python3
"""Empaqueta la web de factibilidad en un solo archivo autocontenido.

Toma data/sites.json y las fuentes de web/ y produce:
  dist/index.html     documento completo, para abrir localmente o publicar
  dist/artifact.html  el mismo contenido sin <html>/<head>/<body>, para Artifacts

El inventario de sitios se comprime a arreglos paralelos con diccionarios de
cadenas repetidas: baja el payload de ~1,9 MB a un tercio sin perder campos.

Uso:  python3 tools/build_web.py
"""
import argparse, json, os, shutil

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TECH_BITS = {'2G': 1, '3G': 2, 'LTE': 4, '5G': 8}


def empacar(sitios, meta):
    """Convierte la lista de sitios en arreglos paralelos + diccionarios."""
    dic = {'reg': [], 'com': [], 'ciu': [], 'morf': [], 'pos': [], 'est': [], 'prov': [], 'sect': []}
    idx = {k: {} for k in dic}

    def clave(campo, valor):
        v = valor or ''
        tabla = idx[campo]
        if v not in tabla:
            tabla[v] = len(dic[campo])
            dic[campo].append(v)
        return tabla[v]

    cols = {k: [] for k in ('id', 'nom', 'lat', 'lon', 'alt', 'reg', 'com', 'ciu', 'dir',
                            'morf', 'pos', 'est', 'prov', 'sect', 'tech', 'cel', 'celL', 'sec')}
    for s in sitios:
        cols['id'].append(s['id'])
        # el nombre suele repetir el código: se omite cuando no aporta
        cols['nom'].append('' if (s.get('nombre') or '') == s['id'] else (s.get('nombre') or ''))
        cols['lat'].append(round(s['lat'], 6))
        cols['lon'].append(round(s['lon'], 6))
        cols['alt'].append(s.get('alt_ant') or 0)
        cols['reg'].append(clave('reg', s.get('region')))
        cols['com'].append(clave('com', s.get('comuna')))
        cols['ciu'].append(clave('ciu', s.get('ciudad')))
        cols['dir'].append(s.get('direccion') or '')
        cols['morf'].append(clave('morf', s.get('morfologia')))
        cols['pos'].append(clave('pos', s.get('posicion')))
        cols['est'].append(clave('est', s.get('estado')))
        cols['prov'].append(clave('prov', s.get('proveedor')))
        cols['sect'].append(clave('sect', s.get('sector')))
        cols['tech'].append(sum(TECH_BITS[t] for t in s.get('techs', []) if t in TECH_BITS))
        celdas = s.get('celdas') or {}
        cols['cel'].append(sum(celdas.values()))
        cols['celL'].append(celdas.get('LTE', 0))
        cols['sec'].append(s.get('sectores') or 0)

    meta_min = {
        'archivos': meta.get('archivos', []),
        'sitios_total': meta.get('sitios_total', len(sitios)),
        'por_tecnologia': meta.get('por_tecnologia', {}),
        'por_region': meta.get('por_region', {}),
        'sitios_sin_coordenadas': meta.get('sitios_sin_coordenadas', 0),
    }
    payload = {'meta': meta_min, 'n': len(sitios), 'dic': dic}
    payload.update(cols)
    return payload


def leer(*partes):
    with open(os.path.join(RAIZ, *partes), encoding='utf-8') as fh:
        return fh.read()


def construir(datos_json, salida_dir):
    with open(datos_json, encoding='utf-8') as fh:
        base = json.load(fh)
    payload = empacar(base['sitios'], base['meta'])
    datos = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))

    css = leer('web', 'app.css')
    js = leer('web', 'app.js')
    cuerpo = leer('web', 'body.html')

    # el bloque de datos va antes que la app: app.js lee window.__RED__ al cargar
    contenido = (
        f'<style>\n{css}\n</style>\n'
        f'{cuerpo}\n'
        f'<script>window.__RED__={datos};</script>\n'
        f'<script>\n{js}\n</script>\n'
    )

    os.makedirs(salida_dir, exist_ok=True)
    art = os.path.join(salida_dir, 'artifact.html')
    with open(art, 'w', encoding='utf-8') as fh:
        fh.write(contenido)

    completo = (
        '<!doctype html>\n<html lang="es">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        '<meta name="description" content="Factibilidad de enlaces de fibra óptica y '
        'microondas contra la red móvil existente.">\n'
        '</head>\n<body>\n' + contenido + '</body>\n</html>\n'
    )
    idx = os.path.join(salida_dir, 'index.html')
    with open(idx, 'w', encoding='utf-8') as fh:
        fh.write(completo)

    capas = copiar_capas(salida_dir)

    return {
        'sitios': payload['n'],
        'datos_kb': round(len(datos.encode()) / 1024, 1),
        'artifact_kb': round(os.path.getsize(art) / 1024, 1),
        'index_kb': round(os.path.getsize(idx) / 1024, 1),
        'capas_kb': capas,
    }


# Las capas SUBTEL no se incrustan: son ~1,8 MB de JSON entre las dos y sólo
# hacen falta si el usuario las enciende, así que viajan como archivos aparte
# que la web pide bajo demanda.
CAPAS_SUBTEL = {
    'capas/servicio.json': 'capa_servicio.json',
    'capas/autorizadas.json': 'capa_autorizadas.json',
    'capas/ooii.json': 'capa_ooii.json',
    'capas/torrecom.json': 'capa_torrecom.json',
}


def copiar_capas(salida_dir):
    info = {}
    for destino_rel, origen_nombre in CAPAS_SUBTEL.items():
        origen = os.path.join(RAIZ, 'data', origen_nombre)
        if not os.path.exists(origen):
            info[destino_rel] = 'ausente'
            continue
        destino = os.path.join(salida_dir, destino_rel)
        os.makedirs(os.path.dirname(destino), exist_ok=True)
        shutil.copyfile(origen, destino)
        info[destino_rel] = round(os.path.getsize(destino) / 1024, 1)
    return info


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--datos', default=os.path.join(RAIZ, 'data', 'sites.json'))
    ap.add_argument('--salida', default=os.path.join(RAIZ, 'dist'))
    a = ap.parse_args()
    print(json.dumps(construir(a.datos, a.salida), ensure_ascii=False, indent=2))
