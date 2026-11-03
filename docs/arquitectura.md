# Arquitectura de SICAE-IA

<!--
  Documento de arquitectura del proyecto de grado.
  Secciones previstas (se llenan a medida que se construye el sistema):
-->

## 1. Vision general

<!-- Diagrama y descripcion de las tres piezas: extension -> API -> modelo ML. -->

## 2. Modulo ML (`ml/`)

<!-- Dataset usado (SpaPhish; ver metricas.md), preprocesamiento, algoritmo
     elegido y metricas obtenidas. -->

## 3. API (`api/`)

<!-- Endpoints, esquemas de entrada/salida, modelo de datos en SQLite. -->

| Endpoint | Clave | Qué hace |
|---|---|---|
| `GET /salud` | Pública | Dice si la API está arriba, si el modelo está cargado y su versión |
| `POST /analizar` | `X-API-Key` | Clasifica un correo y registra el resultado (sin el texto) |
| `GET /estadisticas` | `X-API-Key` | Conteos por categoría y prioridad |

### 3.1 Seguridad de la API

Código en [`api/app/seguridad.py`](../api/app/seguridad.py). Solo usa la librería estándar y lo
que ya trae FastAPI. Cada petición atraviesa estas capas, de afuera hacia adentro:

| # | Capa | Qué hace | Por qué |
|---|---|---|---|
| 1 | Cabeceras de seguridad | Agrega a **todas** las respuestas: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` | Evitan que el navegador interprete mal la respuesta, que la API se muestre dentro de otra página, que se filtre la URL de origen y que un resultado quede guardado en caché |
| 2 | CORS | Solo los orígenes de `SICAE_CORS_ORIGINS` (por ejemplo `chrome-extension://<id>`) reciben permiso del navegador. Métodos GET y POST; encabezados `Content-Type` y `X-API-Key`. **Nunca `"*"`**: si aparece, la API no arranca | Impide que cualquier página web abierta en el navegador del usuario llame a la API |
| 3 | Límite por IP | Como máximo `SICAE_RATE_LIMIT` peticiones por minuto (30 por defecto), en una ventana deslizante en memoria. Si se pasa: **429** con `Retry-After` | Frena el abuso y los intentos repetidos de adivinar la clave |
| 4 | Tamaño máximo | Peticiones de más de `SICAE_MAX_BYTES` (200.000 por defecto): **413**, sin leerlas enteras ni repetir su contenido | Evita que un cuerpo gigante consuma memoria |
| 5 | Clave de API | `/analizar` y `/estadisticas` exigen `X-API-Key` igual a `SICAE_API_KEY`, comparada con `secrets.compare_digest`. Si falta o no coincide: **401** con el mismo mensaje genérico | La comparación en tiempo constante no deja adivinar la clave midiendo tiempos; el mensaje único no dice si faltó o si estaba mal |

Además:
- **Arranque seguro.** Sin `SICAE_API_KEY`, la API **no arranca** y muestra cómo crearla. En
  modo producción tampoco arranca con el valor de ejemplo `cambia-esto`.
- **Documentación cerrada.** `/docs`, `/redoc` y `/openapi.json` solo existen con
  `SICAE_MODO=desarrollo`.
- **Errores sin contenido.** Los errores de validación (422) no devuelven lo que se envió.

**Limitaciones (prototipo):**
- **El límite por IP vive en la memoria del proceso.**
  - **Se reinicia al reiniciar la API:** los contadores empiezan de cero.
  - **No se comparte entre varios workers.** Con `uvicorn --workers N`, cada worker lleva su
    propio contador, así que una IP podría hacer hasta N × `SICAE_RATE_LIMIT` peticiones por
    minuto. Para compartirlo haría falta un almacén común, como Redis, que este prototipo no usa.
  - **La memoria no crece sin fin:** como máximo una vez por minuto se borran las IPs que no
    hicieron peticiones en los últimos 60 s.
- **La IP se toma de la conexión.** Detrás de un proxy, todas las peticiones parecerían venir de
  la IP del proxy. No se usa `X-Forwarded-For` porque cualquiera puede falsificarlo.
- **La clave es una sola, compartida.** No hay usuarios ni permisos distintos. Si se filtra, se
  cambia en `.env` y se reinicia la API.

### 3.2 Qué se guarda y qué no

Cada `POST /analizar` exitoso agrega **una fila** a la tabla `analisis` de una base SQLite
(`SICAE_DB_PATH`, por defecto `api/data/sicae.db`, fuera de Git). El código está en
[`api/app/registro.py`](../api/app/registro.py) y usa `sqlite3` de la librería estándar.

| Columna | Tipo | Significado |
|---|---|---|
| `id` | entero | Número de la fila, automático |
| `fecha` | texto | Momento del análisis en UTC, formato ISO 8601 (`2026-11-03T15:04:05+00:00`) |
| `categoria` | texto | `legitimo`, `publicidad` o `phishing` |
| `puntaje` | real | Puntaje del modelo **con signo**, tal cual sale de `analizar_correo()`: mayor que 0 = phishing, menor que 0 = legítimo. Cuanto más lejos de 0, más seguro está el modelo |
| `confianza` | texto | `alta` o `dudosa`, igual que en la respuesta de la API (dudosa si \|puntaje\| < 0,5; ver `docs/metricas.md`, paso 1.7) |
| `prioridad` | texto o NULL | `alta`, `media` o `baja`; **NULL si es phishing**, porque el phishing va como alerta y no se prioriza |
| `version_modelo` | texto | Versión del modelo que clasificó, por ejemplo `v1.0` |

Las restricciones `CHECK` de la tabla hacen que SQLite rechace cualquier valor fuera de esas
listas.

**Nunca se guarda:**
- el asunto ni el cuerpo;
- el remitente ni los destinatarios;
- las URLs ni las cabeceras;
- un hash del contenido, porque permitiría saber si un correo conocido pasó por el sistema;
- los motivos de la decisión, que nombran palabras del correo.

Una prueba envía un correo con un texto único en todos sus campos y comprueba que ese texto
**no aparece** en ningún byte del archivo `.db`.

**Si el registro falla** (disco lleno, archivo bloqueado), la respuesta igual se entrega. En el
log queda solo el tipo de error, sin contenido. `GET /estadisticas` lee esta tabla y devuelve
solo conteos.

## 4. Extension de Chrome (`extension/`)

<!-- Manifest V3, permisos solicitados y como el side panel obtiene el correo. -->

## 5. Clasificacion y prioridad

<!-- Como se combinan el modelo (phishing vs legitimo) y la regla de
     publicidad para llegar a las tres categorias finales, y como se
     asigna la prioridad. -->

La API (`api/app/main.py`, paso 2.1) expone `POST /analizar`, que llama a
`analizar_correo()` de `ml/sicae_ml/sistema.py`: modelo v1.0, luego regla de publicidad y
luego prioridad (detalle en `docs/metricas.md`, pasos 1.6 a 1.8). El modelo se carga una vez
al arrancar; `GET /salud` dice si está cargado.

## 6. Alcance y limitaciones

<!-- Prototipo en entorno controlado. Limpieza y envio SIMULADOS:
     nunca se borra ni se envia un correo real. -->

## 7. Decisiones tecnicas

<!-- Por que cada eleccion, para poder defenderla ante el jurado. -->
