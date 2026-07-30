#!/usr/bin/env python3
"""
Empaqueta la web en un unico archivo HTML autocontenido (CSS, JS y datos en
linea). Sirve para enviarla por correo, dejarla en un pendrive o publicarla:
no necesita servidor ni acceso a internet.

Uso:
    python3 tools/build_single.py                      -> dist/factibilidad.html
    python3 tools/build_single.py --cuerpo -o frag.html -> solo el contenido,
        sin <!doctype>/<html>/<head>/<body>, para incrustar en otra pagina.
"""
import argparse, os, re, sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def leer(rel):
    with open(os.path.join(RAIZ, rel), encoding='utf-8') as f:
        return f.read()


def blindar(js):
    """Evita que un </script> dentro del JS cierre la etiqueta antes de tiempo."""
    return js.replace('</script', '<\\/script')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('-o', '--out', default='dist/factibilidad.html')
    ap.add_argument('--cuerpo', action='store_true',
                    help='emitir solo el contenido, sin doctype/html/head/body')
    a = ap.parse_args()

    html = leer('index.html')

    # CSS en linea
    def css(m):
        return '<style>\n' + leer(m.group(1)) + '\n</style>'
    html, n_css = re.subn(r'<link rel="stylesheet" href="([^"]+)">', css, html)

    # JS en linea, respetando el orden de carga original
    def js(m):
        ruta = m.group(1)
        return '<script>\n/* ==== ' + ruta + ' ==== */\n' + blindar(leer(ruta)) + '\n</script>'
    html, n_js = re.subn(r'<script src="([^"]+)"></script>', js, html)

    if n_css != 1 or n_js < 6:
        print('AVISO: se incrustaron %d hojas de estilo y %d scripts; '
              'revisar index.html' % (n_css, n_js), file=sys.stderr)

    if a.cuerpo:
        # se conserva el <title> (la plataforma lo sube al <head>)
        titulo = re.search(r'<title>.*?</title>', html, re.S)
        cuerpo = re.search(r'<body>(.*)</body>', html, re.S)
        estilo = re.search(r'<style>.*?</style>', html, re.S)
        if not (cuerpo and estilo):
            print('ERROR: no se pudo aislar el cuerpo', file=sys.stderr)
            return 1
        html = (titulo.group(0) if titulo else '') + '\n' + estilo.group(0) + '\n' + cuerpo.group(1).strip()

    destino = os.path.join(RAIZ, a.out)
    os.makedirs(os.path.dirname(destino), exist_ok=True)
    with open(destino, 'w', encoding='utf-8') as f:
        f.write(html)

    kb = os.path.getsize(destino) / 1024
    print('%s  (%.0f KB, %d hojas de estilo, %d scripts)' % (a.out, kb, n_css, n_js))
    return 0


if __name__ == '__main__':
    sys.exit(main())
