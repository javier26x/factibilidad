# Factibilidad FO / MMOO

Herramienta web para decidir si un sitio o un enlace nuevo se resuelve con **fibra óptica**
o con un **vano de microondas** contra la red móvil que ya existe.

La base son los dumps CGI de la red (`CGI_20260713.xlsx` de Nokia y `CGI_HUAWEI_20260713.xlsx`
de Huawei): 8 hojas de celdas 2G / 3G / LTE / 5G que se consolidan en **4.532 sitios** con
coordenadas, comuna, región, altura de antenas y tecnologías presentes, desde Arica hasta
Magallanes.

Todo el cálculo corre en el navegador y el inventario de red va incrustado: `dist/index.html`
se abre sin servidor. Tres servicios externos gratuitos y sin clave mejoran el resultado cuando
hay red —ruteo por calles, altimetría y fondos cartográficos—, y la herramienta funciona sin
ellos declarando en cada caso qué quedó estimado. Los fondos de Google son opcionales y sí
requieren clave propia con facturación.

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

También sirve abrir `dist/index.html` directo en el navegador, sin servidor.

### Sitios cercanos

La pestaña de entrada. Sin veredictos: se pega un listado de sitios y responde **qué hay
alrededor de cada uno y a qué distancia** —red propia, los dos registros de SUBTEL y las dos
capas de infraestructura— en una sola lista ordenada, con metros bajo el kilómetro. Cada fila
trae registro de procedencia, operador, tipo de soporte con su altura, estado de obra donde lo
haya, tecnologías y bandas. Exportable a CSV.

Acepta los mismos formatos que el lote; una fila `A-B` consulta el entorno de **ambos**
extremos. Las consultas repetidas se colapsan.

Dos decisiones que cambian el resultado:

- El tope de resultados es **por fuente**, no del total. Con un tope global, en zona urbana las
  decenas de antenas de terceros desplazan a los sitios propios fuera del listado, y OOII con
  sus 16.846 puntos haría lo mismo con las demás capas.
- Una antena en servicio casi siempre está también autorizada, así que las dos entradas se
  **fusionan** en una fila que declara ambos registros. Una fila marcada sólo `autorizada` es
  obra permitida y no instalada, que para coubicación no es lo mismo.

Desde cada fila se salta a la factibilidad: el botón del encabezado analiza el punto como
sitio, y el botón «vano» lo carga como enlace A–B contra ese vecino.

### Factibilidad

Tres modos de trabajo:

| Modo | Entrada | Qué responde |
| --- | --- | --- |
| **Sitio** | un punto (lat/lon o código de un sitio de la red) | los nodos de red más cercanos, ordenados, con veredicto de fibra y de radio para cada uno |
| **Enlace A–B** | dos extremos, con cotas propias si se tienen | balance completo del vano banda por banda, despeje sobre perfil de terreno y alternativas a cada extremo |
| **Lote** | filas pegadas desde una planilla | una tabla con el veredicto de cada entrada, exportable a CSV |

El formato de lote —y también el de la pestaña de cercanos— acepta, una fila por sitio o por
enlace:

| Se pega | Se interpreta |
| --- | --- |
| `06_109-06_331` | enlace entre dos sitios de la red (también con espacios, `–`, `→` o `/`) |
| `06_109; -34.60; -71.15` | enlace de un sitio de la red a un punto nuevo |
| `nombre; lat; lon; altura` | sitio candidato |
| `nombre; latA; lonA; latB; lonB` | enlace A–B libre |
| `01_404` | un sitio de la red |

Ningún código del inventario contiene guiones, así que el separador de `A-B` no es ambiguo.
Las coordenadas pueden ir en grados decimales o en grados/minutos/segundos (`18°28'23.3"S`).

Cada enlace se evalúa con sus **alternativas**: los nodos de la red que podrían servir a cada
extremo, con veredicto propio de fibra y de radio, excluidos los dos extremos del vano.

En el mapa: clic en un sitio para cargarlo como punto de análisis, clic en vacío para fijar
un candidato, rueda para acercar, arrastrar para desplazar.

### Capas externas

Cuatro capas encendibles sobre el mapa, con filtro por marca, y disponibles también como
fuentes en la búsqueda de cercanos:

| Capa | Emplazamientos | Marcador | Qué aporta |
| --- | --- | --- | --- |
| SUBTEL en servicio | 12.568 | ▲ | antenas operando, por operador |
| SUBTEL autorizadas | 16.901 | ▽ | antenas con permiso, instaladas o no |
| Infraestructura OOII | 16.846 | ■ | torres de ATC, PTI, SBA, QMC, ATP, Entel, WOM y Torrecom |
| Portafolio Torrecom | 179 | ◆ | estado de obra, tipo de sitio, zonificación y altura validada |

Los formatos de origen son distintos y `extract_kmz.py` maneja los dos: SUBTEL trae los campos
como HTML dentro de `<description>` y repite cada antena por tecnología y banda —52.432 y
29.877 placemarks para 16.953 y 12.590 posiciones—; OOII y Torrecom los traen como esquema
`SimpleData`. En ambos casos se consolida por coordenada.

Cada punto trae lo que su fuente tenga: operador o empresa de torres, tecnologías, bandas, tipo
de soporte con su altura, comuna, código, y en Torrecom el estado de obra (`On air`,
`Construido`, `Landbanking`, `RFC`, `En proceso Permiso/Aviso DOM`) con su zonificación. Se ven
al pasar el cursor y en el listado de cercanos.

Las máscaras de marca se resuelven contra el diccionario **de cada capa**: los operadores
móviles y las empresas de torres son universos distintos y no comparten numeración.

A diferencia del inventario de red, estas capas **no van incrustadas**: son 2,5 MB de JSON
entre las cuatro y se piden al encenderlas, así quien no las usa no las descarga. Con
`dist/index.html` abierto desde el disco, el navegador prohíbe `fetch()` sobre `file://` y la
capa queda no disponible; la interfaz lo explica. Desde el sitio publicado funcionan.

Torrecom aparece en las dos capas de infraestructura —167 puntos dentro de OOII y 179 en su
portafolio propio— y no se fusionan: son dos volcados de distinta fecha, y ver ambos permite
contrastarlos. Sólo los dos registros de SUBTEL se fusionan entre sí, porque describen la
misma antena desde dos trámites; una capa de infraestructura describe la estructura, no la
antena, y coincidir en posición no prueba que sea el mismo soporte.

### Fondos cartográficos

Cinco opciones gratuitas y sin clave de API:

| Fondo | Fuente | Para qué |
| --- | --- | --- |
| Mapa claro/oscuro | CARTO sobre OpenStreetMap | por defecto; sigue el tema y deja que los vanos resalten |
| Calles | OpenStreetMap | callejero con más detalle de nombres |
| Topográfico | OpenTopoMap | curvas de nivel y relieve, para ver si un vano cruza un cordón |
| Satélite | Esri World Imagery | edificación y vegetación, lo que obstruye los saltos urbanos |
| Sin fondo | — | sólo retícula y sitios |

Y tres fondos de **Google**, que requieren clave propia: `Google satélite`,
`Google satélite + rótulos` y `Google callejero`.

#### Usar Google

Google Maps no tiene nivel gratuito sin registro: hace falta una clave de Google Maps Platform
con **facturación habilitada** y la **Map Tiles API** activada. Consultá los precios vigentes
antes de encenderlo, porque el cobro es por tesela servida.

Se pega en **Parámetros › Mapa › Clave de Google Maps Platform**. Queda guardada sólo en ese
navegador: no se versiona, no viaja al repositorio y no aparece en ninguna exportación. Sin
clave, esos tres fondos quedan inertes y el mapa lo dice, sin hacer ninguna llamada.

Se usa la vía licenciada: `createSession` para obtener un token —que dura unas dos semanas y se
guarda con su vencimiento, así no se pide uno por sesión de trabajo— y luego las teselas de
`2dtiles`. **No** se piden teselas a los servidores internos de Google Maps: eso infringe sus
términos de servicio y puede costar la cuenta, así que no está implementado y no conviene
pedirlo.

Dos advertencias que valen más que la comodidad:

- En un sitio estático la clave viaja al navegador y **queda a la vista de cualquiera**.
  Restringila por referente HTTP a tu dominio y limitala a la Map Tiles API, o alguien te
  factura las teselas.
- La atribución que muestro es el texto «Google». Los requisitos de marca de Google para
  imagen satelital son más extensos y las atribuciones por viewport se piden a otro endpoint
  que no llamo. Si esto va a uso comercial, revisá esos requisitos: no puedo garantizarlos
  desde acá.

Si no querés habilitar facturación, `Satélite` (Esri World Imagery) ya está disponible sin
clave y cubre Chile completo.

La capa de teselas está escrita sobre el mismo canvas que el resto del mapa, sin Leaflet ni
otra dependencia: el lienzo ya trabaja en Web Mercator, así que basta convertir la escala al
nivel de zoom del esquema estándar de teselas. Si las teselas no se pueden cargar —por
ejemplo bajo una política que bloquee hosts externos— el mapa cae solo a la vista de retícula
y lo indica, sin perder ninguna de las capas de análisis.

El crédito de la fuente se muestra siempre sobre el mapa, como exigen las licencias de
OpenStreetMap, CARTO, OpenTopoMap, Esri y Google.

## Qué calcula

**Fibra óptica.** El tendido se mide por el recorrido real sobre calles, pidiéndolo al
servicio de ruteo de OSRM, y se dibuja su traza en el mapa. Si el servicio no responde se cae
a la estimación clásica —recta por un factor de sinuosidad— y se marca con asterisco en la
tabla. Sobre la longitud se aplica un costo por kilómetro según morfología urbana o rural.
Umbrales y costos son parámetros editables; los valores por defecto son órdenes de magnitud
de planificación, no cotizaciones.

El ruteo usa el servidor público de demostración de OSRM, gratuito y sin clave, pensado para
uso razonable. Para volumen alto, apuntar la constante `RUTEO_URL` de `web/app.js` a una
instancia propia de OSRM o Valhalla. Se puede desactivar en Parámetros.

**Microondas.** Para cada banda de 7 a 38 GHz y para E-band: pérdida en espacio libre,
absorción atmosférica, ganancia de antena y umbral de recepción según la modulación mínima
que entrega la capacidad pedida. La atenuación por lluvia sigue ITU-R P.530 con los
coeficientes de P.838-3, con la tasa `R₀,₀₁` de la región del nodo más cercano (de 8 mm/h en
el norte a 35 mm/h en Los Lagos, editable región por región). Se suma el desvanecimiento
multitrayecto de P.530 en forma simplificada. La banda recomendada es la de antena más
pequeña que cumple la disponibilidad objetivo y, a igualdad de antena, la frecuencia más
alta, para no consumir las bandas bajas en saltos que se resuelven arriba.

**Despeje.** Se resuelve sobre altimetría real: 100 muestras sobre el círculo máximo del
vano, cotas del modelo digital SRTM de 30 m vía OpenTopoData, y despeje evaluado en cada punto
contra abultamiento terrestre (`k = 4/3`) más una fracción de la primera zona de Fresnel más un
margen por clutter. El punto crítico es el de menor holgura, no el medio del vano.

La columna **Despeje** de las tablas declara siempre el origen del resultado:

| Valor | Significa |
| --- | --- |
| `SRTM ok` / `SRTM marginal` / `SRTM corta` | resuelto sobre perfil medido |
| `cotas ok` / … | resuelto con las cotas que cargó el usuario, que tienen precedencia |
| `plano` | sin perfil ni cotas: sólo se tamizó en terreno plano |

Un vano en `plano` puede cerrar el presupuesto de enlace y no ver el otro extremo.

Se perfila el vano que se está mirando, no los ocho candidatos: el servicio admite una llamada
por segundo. Si el nodo más conveniente no tiene línea de vista, se siguen perfilando los
siguientes por distancia hasta hallar uno que sí, con tope. La reelección del mejor vano se
hace sólo entre los perfilados, para no comparar terreno medido contra terreno plano supuesto.

Dos límites: SRTM es radar, así que en zonas con vegetación su retorno cae en algún punto del
dosel —incluye algo de los árboles, de forma poco confiable—, y para árboles y edificios
medidos haría falta un modelo de superficie LiDAR, que no existe gratuito para todo Chile. El
clutter sigue siendo un margen, sólo que ahora sobre terreno medido. El servicio se puede
desactivar en Parámetros y `ELEVACION_URL` apunta a una instancia propia de OpenTopoData.

## Dos límites del dato de origen

Los dumps CGI no traen el medio de transmisión de cada sitio ni la altimetría del terreno.

- **Medio de transmisión**: la probabilidad de que un nodo ya tenga fibra se infiere de su
  perfil radio (presencia de 5G, cantidad de celdas LTE, morfología, indoor/outdoor). Es una
  heurística declarada como tal. Pegando el inventario real de nodos con fibra en la pestaña
  Parámetros, ese dato la reemplaza por completo.
- **Terreno**: los dumps no traen altimetría, pero ya no hace falta cargarla a mano. El
  despeje se resuelve contra el modelo digital SRTM de 30 m; las cotas manuales siguen
  disponibles y tienen precedencia cuando se cargan.

## Regenerar

```sh
# 1. consolidar los sitios desde los workbooks CGI
python3 tools/extract_sites.py CGI_20260713.xlsx CGI_HUAWEI_20260713.xlsx -o data/sites.json

# 2. consolidar las capas externas (acepta .kmz y .kml)
python3 tools/extract_kmz.py antenas_servicio_chile.kmz    -o data/capa_servicio.json
python3 tools/extract_kmz.py antenas_autorizadas_chile.kmz -o data/capa_autorizadas.json
python3 tools/extract_kmz.py Consolidado_OOII_Mar_2026.kml -o data/capa_ooii.json \
    --titulo "Infraestructura OOII (consolidado mar 2026)"
python3 tools/extract_kmz.py Portafolio_Torrecom_2026.kmz  -o data/capa_torrecom.json \
    --titulo "Portafolio Torrecom 2026"

# 3. empaquetar la web y copiar las capas a dist/
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
data/capa_*.json     capas externas: SUBTEL, OOII, Torrecom (servidas aparte)
web/app.js           motor de cálculo e interfaz
web/app.css          hoja de estilos (tema claro y oscuro)
web/body.html        estructura de la página
tools/extract_sites.py   xlsx CGI  →  sites.json
tools/extract_kmz.py     kmz/kml externos →  capa_*.json
tools/build_web.py       sites.json + web/  →  dist/
dist/index.html      documento completo, listo para abrir
dist/artifact.html    mismo contenido sin <html>/<head>/<body>
```
