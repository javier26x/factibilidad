# Factibilidad FO / MMOO

Herramienta web para decidir si un sitio o un enlace nuevo se resuelve con **fibra óptica**
o con un **vano de microondas** contra la red móvil que ya existe.

La base son los dumps CGI de la red (`CGI_20260713.xlsx` de Nokia y `CGI_HUAWEI_20260713.xlsx`
de Huawei): 8 hojas de celdas 2G / 3G / LTE / 5G que se consolidan en **4.532 sitios** con
coordenadas, comuna, región, altura de antenas y tecnologías presentes, desde Arica hasta
Magallanes.

Todo corre en el navegador, sin servidor ni dependencias externas: `dist/index.html` es un
único archivo autocontenido con los datos incrustados.

## Dónde está publicado

**https://javier26x.github.io/factibilidad/**

El workflow `.github/workflows/pages.yml` reconstruye `dist/` desde las fuentes y lo publica
en GitHub Pages en cada push a la rama por defecto. No hay build step que instalar: sólo
Python de la biblioteca estándar.

Requiere habilitar Pages una vez: **Settings › Pages › Source: GitHub Actions**. El
`GITHUB_TOKEN` de Actions no puede crear el sitio por API —ese endpoint exige permiso de
administración del repositorio, que no se concede desde el bloque `permissions:`—, así que
ese primer clic es manual. Después de eso cada push despliega solo.

Para servirlo en Firebase Hosting en su lugar, el repo ya trae `firebase.json` apuntando a
`dist/`:

```sh
firebase login
firebase use --add                    # elegir el proyecto una vez
python3 tools/build_web.py && firebase deploy --only hosting
```

## Uso

También sirve abrir `dist/index.html` directo en el navegador, sin servidor. Tres modos de
trabajo:

| Modo | Entrada | Qué responde |
| --- | --- | --- |
| **Sitio** | un punto (lat/lon o código de un sitio de la red) | los nodos de red más cercanos, ordenados, con veredicto de fibra y de radio para cada uno |
| **Enlace A–B** | dos extremos y, si se tienen, las cotas del terreno | balance completo del vano banda por banda y despeje resuelto con holgura numérica |
| **Lote** | filas pegadas desde una planilla | una tabla con el veredicto de cada entrada, exportable a CSV |

El formato de lote acepta `nombre; lat; lon [; altura]`, cuatro coordenadas en una fila para
un enlace A–B, o una sola columna con el código de un sitio ya existente. Las coordenadas
pueden ir en grados decimales o en grados/minutos/segundos (`18°28'23.3"S`).

En el mapa: clic en un sitio para cargarlo como punto de análisis, clic en vacío para fijar
un candidato, rueda para acercar, arrastrar para desplazar.

### Fondos cartográficos

Cinco opciones, todas gratuitas y sin clave de API:

| Fondo | Fuente | Para qué |
| --- | --- | --- |
| Mapa claro/oscuro | CARTO sobre OpenStreetMap | por defecto; sigue el tema y deja que los vanos resalten |
| Calles | OpenStreetMap | callejero con más detalle de nombres |
| Topográfico | OpenTopoMap | curvas de nivel y relieve, para ver si un vano cruza un cordón |
| Satélite | Esri World Imagery | edificación y vegetación, lo que obstruye los saltos urbanos |
| Sin fondo | — | sólo retícula y sitios |

La capa de teselas está escrita sobre el mismo canvas que el resto del mapa, sin Leaflet ni
otra dependencia: el lienzo ya trabaja en Web Mercator, así que basta convertir la escala al
nivel de zoom del esquema estándar de teselas. Si las teselas no se pueden cargar —por
ejemplo bajo una política que bloquee hosts externos— el mapa cae solo a la vista de retícula
y lo indica, sin perder ninguna de las capas de análisis.

El crédito de la fuente se muestra siempre sobre el mapa, como exigen las licencias de
OpenStreetMap, CARTO, OpenTopoMap y Esri.

## Qué calcula

**Fibra óptica.** Distancia al nodo multiplicada por un factor de sinuosidad, con costo por
kilómetro distinto según morfología urbana o rural. Los umbrales de kilómetros y los costos
son parámetros editables; los valores por defecto son órdenes de magnitud de planificación,
no cotizaciones.

**Microondas.** Para cada banda de 7 a 38 GHz y para E-band: pérdida en espacio libre,
absorción atmosférica, ganancia de antena y umbral de recepción según la modulación mínima
que entrega la capacidad pedida. La atenuación por lluvia sigue ITU-R P.530 con los
coeficientes de P.838-3, con la tasa `R₀,₀₁` de la región del nodo más cercano (de 8 mm/h en
el norte a 35 mm/h en Los Lagos, editable región por región). Se suma el desvanecimiento
multitrayecto de P.530 en forma simplificada. La banda recomendada es la de antena más
pequeña que cumple la disponibilidad objetivo y, a igualdad de antena, la frecuencia más
alta, para no consumir las bandas bajas en saltos que se resuelven arriba.

**Despeje.** Abultamiento terrestre con factor `k = 4/3`, más una fracción de la primera zona
de Fresnel, más un margen por clutter. Sin cotas de terreno sólo se verifica si las alturas
declaradas alcanzarían en terreno plano y el veredicto queda condicionado a perfil; con las
tres cotas cargadas (extremo A, extremo B y obstáculo) el despeje se resuelve numéricamente.

## Dos límites del dato de origen

Los dumps CGI no traen el medio de transmisión de cada sitio ni la altimetría del terreno.

- **Medio de transmisión**: la probabilidad de que un nodo ya tenga fibra se infiere de su
  perfil radio (presencia de 5G, cantidad de celdas LTE, morfología, indoor/outdoor). Es una
  heurística declarada como tal. Pegando el inventario real de nodos con fibra en la pestaña
  Parámetros, ese dato la reemplaza por completo.
- **Terreno**: la línea de vista no se puede cerrar sin altimetría. Se resuelve cargando las
  cotas del vano en el modo Enlace A–B.

## Regenerar

```sh
# 1. consolidar los sitios desde los workbooks CGI
python3 tools/extract_sites.py CGI_20260713.xlsx CGI_HUAWEI_20260713.xlsx -o data/sites.json

# 2. empaquetar la web en un solo archivo
python3 tools/build_web.py
```

`extract_sites.py` lee los `.xlsx` en streaming (la hoja LTE de Huawei son 210 MB de XML sin
comprimir), mapea las cabeceras por nombre —así tolera que cambie el orden de columnas entre
volcados— y consolida por código de sitio tomando la mediana de coordenadas y alturas.
`build_web.py` comprime el inventario a arreglos paralelos con diccionarios de cadenas
repetidas (1,9 MB → 531 KB) y lo incrusta en el HTML.

## Estructura

```
data/sites.json      inventario consolidado de sitios
web/app.js           motor de cálculo e interfaz
web/app.css          hoja de estilos (tema claro y oscuro)
web/body.html        estructura de la página
tools/extract_sites.py   xlsx CGI  →  sites.json
tools/build_web.py       sites.json + web/  →  dist/
dist/index.html      documento completo, listo para abrir
dist/artifact.html    mismo contenido sin <html>/<head>/<body>
```
