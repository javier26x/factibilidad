# Factibilidad de enlaces FO / MMOO

Herramienta web para evaluar, contra el inventario de la red móvil, si un sitio o
un enlace nuevo tiene factibilidad de **fibra óptica (FO)** o de **microondas
(MMOO)**.

La red existente se usa como **base**: se pega una lista de sitios o enlaces
candidatos y la herramienta busca los sitios más cercanos, calcula la ruta de
fibra estimada, evalúa el salto de microondas (despeje, banda, presupuesto de
enlace y disponibilidad) y entrega un veredicto por cada opción.

Todo corre en el navegador. **No requiere servidor ni conexión a internet**: no
hay dependencias externas, y los datos de la red viajan en el propio archivo.

---

## Cómo abrirla

| Opción | Qué hacer |
|---|---|
| Repositorio | Abrir `index.html` con doble clic (funciona sobre `file://`). |
| Archivo único | Abrir `dist/factibilidad.html`. Es autocontenido (713 KB): se puede enviar por correo o dejar en un pendrive. |

Para regenerar el archivo único después de cambiar el código:

```bash
python3 tools/build_single.py
```

---

## Uso

1. Pegar en el panel izquierdo un sitio o enlace por línea.
2. Presionar **Evaluar factibilidad** (o `Ctrl`/`Cmd` + `Enter`).
3. Revisar la tabla de resultados y hacer clic en una fila para ver el detalle
   de ingeniería.
4. **Exportar CSV** entrega las 32 columnas del cálculo para adjuntar a un informe.

### Formatos de entrada que reconoce

```
Cliente Norte; -33.3500; -70.6800; h=25      grados decimales + altura de torre
Bodega Sur    -33.6100 -70.7300              separado por espacios o tabs
Radio Base X  33°26'36"S 70°39'04"W          sexagesimal
Punto UTM     19S 345678 6298765             UTM husos 17 a 19
13_184                                        código de sitio de la red
Cliente X -33.44,-70.65 -> 13_184            enlace explícito A → B
```

- La altura de torre se indica con `h=30`, `alt=30`, `altura=30` o `@30`.
- También acepta pegar una tabla de Excel con cabecera: basta que haya una fila
  con las columnas `nombre`, `lat`, `lon` y opcionalmente `altura`.
- Las líneas vacías y las que empiezan con `#` se ignoran.
- Se puede cargar un archivo `.csv` / `.tsv` en lugar de pegar.
- Las coordenadas se validan contra el rango de Chile; si vienen invertidas
  (lon primero) o sin signo, se corrigen. Un punto fuera de Chile se reporta
  como error en vez de calcularse.

Los dos modos se comportan distinto:

- **Sitio suelto** → busca en el inventario el mejor nodo FO y el mejor sitio par
  MMOO dentro del radio de búsqueda.
- **Enlace `A -> B`** → evalúa exactamente ese vano, sin buscar alternativas.

---

## Qué calcula

### Fibra óptica

| Paso | Detalle |
|---|---|
| Nodo de conexión | Sitio más cercano que cumple el filtro (por defecto, con 4G: un sitio con 4G/5G casi siempre tiene fibra o transporte de alta capacidad). |
| Ruta estimada | Distancia recta × factor de sinuosidad. Urbano 1,45 (más quiebres por manzanas y cruces) y rural 1,25 (sigue caminos largos pero rectos). Sobre 10 km se usa el factor rural: un tendido largo sale de la trama urbana. |
| Obra | Cantidad de postes según el vano configurado, y costo con los valores unitarios que se definan. |
| Veredicto | ALTA / MEDIA / BAJA / NO VIABLE según umbrales de km de ruta, editables. |

Se muestran además los 4 nodos alternativos más cercanos con su propio veredicto.

### Microondas

| Paso | Referencia |
|---|---|
| Despeje | Bulbo terrestre `d1·d2/(12,75·k)` más la fracción exigida del primer elipsoide de Fresnel `F1 = 17,32·√(d1·d2/(f·d))` (ITU-R P.526). Entrega la holgura con las alturas actuales y la **altura mínima de torre** necesaria por lado. |
| Presupuesto | Pérdida de espacio libre, ganancia de parabólicas (`17,8 + 20·log D + 20·log f`, eficiencia ~55 %), nivel de recepción y margen de desvanecimiento. |
| Lluvia | Atenuación específica con los coeficientes k y α de **ITU-R P.838-3** (interpolados: k en log-log, α lineal en log f), longitud efectiva y escalado a otros porcentajes de tiempo según **ITU-R P.530-17**. El R0.01 se toma por región de Chile o se fija a mano. |
| Multitrayecto | Método de mes peor de **ITU-R P.530-17**, con gradiente `dN1` configurable. |
| Banda | Se elige la banda más alta (más capacidad, antena más chica) que cumpla despeje, disponibilidad objetivo y alcance típico, entre 7 y 38 GHz. Si ninguna cumple, se informa la de mejor disponibilidad. |

Cuando el diámetro de antena se deja en `0`, cada banda se evalúa con su
diámetro típico (1,8 m en 7-8 GHz … 0,3 m en 23-38 GHz). Comparar todas las
bandas con una parabólica de 0,6 m falsearía la comparación: 0,6 m a 38 GHz da
45 dBi, que no es una configuración real.

E-band (80 GHz) se lista para saltos cortos pero **no se elige
automáticamente**: queda fuera del rango 1-40 GHz de la tabla P.838-3, así que
su atenuación por lluvia es una extrapolación y aparece marcada como tal.

### Limitaciones que hay que tener presentes

- El despeje asume **terreno plano**: modela la curvatura de la Tierra y Fresnel,
  pero no la topografía. Un enlace que aquí sale con holgura positiva puede
  estar cortado por un cerro. La factibilidad definitiva necesita perfil DEM
  (Pathloss, ATDI o equivalente) y visita a sitio.
- La ruta de FO se estima con los **sitios de radio como proxy** de un nodo con
  transporte. No reemplaza el catastro de rutas de fibra: puede haber una troncal
  más cerca que cualquier sitio.
- Los umbrales, factores, costos y el R0.01 por región son valores de
  planificación **editables**, no tarifas ni mediciones.
- La disponibilidad se acota al 0,0001 % del tiempo, que es el piso del modelo
  P.530; por eso se muestra `≥99,9999 %` y nunca `100 %`.

---

## Inventario de la red

`data/sites.js` se genera desde los reportes CGI y contiene **4.532 sitios
únicos** (138.857 celdas: 2G 5.738, 3G 11.126, 4G 114.546, 5G 7.447).

Por sitio se guarda: código, nombre, coordenada, tecnologías y celdas por
tecnología, proveedor, región, comuna, ciudad, dirección, estado, entorno
(urbano/rural), emplazamiento, altura de antenas, clúster de calidad y bandas.

### Regenerar el inventario con reportes nuevos

```bash
pip install openpyxl
python3 tools/extract_sites.py CGI_20260713.xlsx CGI_HUAWEI_20260713.xlsx -o data/sites.js
python3 tools/build_single.py     # opcional, refresca el archivo único
```

El script lee las hojas `2G` / `2G_FLEXI`, `3G`, `LTE` y `5G` de cada archivo y
consolida por código de sitio. Detalles que resuelve:

- La hoja LTE trae **dos** columnas de sitio: `Codigo Sitio` (`01i_006`) y `Site`
  (`01i_006_4G`, el nombre del nodo). Se usa `Codigo Sitio`; tomar la otra
  duplicaría los sitios, porque 4G no cruzaría con 2G/3G/5G.
- Se quitan los sufijos `_2G` / `_3G` / `_4G` / `_5G` de los códigos.
- Las coordenadas se toman por **mediana** de todas las celdas del sitio, para
  que una celda con la coordenada mal cargada no desplace el sitio.
- Detecta y corrige lat/lon invertidas, y descarta coordenadas fuera de Chile.
- Normaliza el casing inconsistente del reporte (`u`/`U`, `iNDOOR`/`INDOOR`).
- El EARFCN se traduce a banda LTE (B5 850, B7 2600, B28 700, …).

La salida es columnar con diccionario de valores repetidos: 597 KB en vez de los
3 MB que ocuparía un arreglo de objetos, sin perder ningún campo.

Sitios sin coordenada válida en ninguna hoja (4 en el reporte del 13-07-2026):
`07_326`, `01_677`, `06_783`, `53_438`.

---

## Estructura

```
index.html                 interfaz
css/styles.css             estilos (tema oscuro y claro)
js/geo.js                  geodesia: haversine, azimut, UTM, parseo de coordenadas
js/radio.js                ingeniería: Fresnel, bulbo, P.838, P.530, presupuesto
js/inventory.js            inventario en memoria y consultas espaciales por grilla
js/parse.js                lectura de la lista pegada por el usuario
js/chart.js                mapa, perfil de trayectoria y radar (canvas puro)
js/app.js                  interfaz, parámetros, tabla, detalle y exportación
data/sites.js              inventario generado (no editar a mano)
tools/extract_sites.py     consolida los reportes CGI
tools/build_single.py      empaqueta todo en un archivo
tools/test_modules.js      pruebas de los módulos de cálculo
dist/factibilidad.html     versión de un solo archivo
```

## Pruebas

```bash
node tools/test_modules.js
```

45 comprobaciones sobre distancias, azimut, conversión UTM, parseo de
coordenadas en los cuatro formatos, consultas del inventario (incluyendo la
grilla espacial contra fuerza bruta), geometría de Fresnel, coeficientes P.838,
escalado P.530 y lectura de la entrada del usuario.

Los parámetros y el texto pegado se guardan en `localStorage`, así que la
herramienta reabre con el último estado.
