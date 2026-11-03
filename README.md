# SICAE-IA

[![CI](https://github.com/XzJulian0711/sicae-ia/actions/workflows/ci.yml/badge.svg)](https://github.com/XzJulian0711/sicae-ia/actions/workflows/ci.yml)

*CI: en cada pull request hacia `main` y en cada push a `main` corre las pruebas de `ml/` y `api/` (sin datos reales ni el modelo `.joblib`) y revisa con pip-audit que ninguna dependencia tenga vulnerabilidades conocidas.*

Sistema inteligente para la automatización y clasificación de correos electrónicos.
Clasifica cada correo en **legítimo**, **publicidad** o **phishing** y le asigna una prioridad (**alta**, **media** o **baja**).
Proyecto de grado de Ingeniería de Sistemas, Fundación Universitaria Los Libertadores.

## Estado del proyecto

En desarrollo — **Fase 1: datos y modelo**. La API y la extensión de Chrome están planificadas pero
todavía no implementadas.

El repositorio aún no contiene un modelo entrenado ni resultados evaluables, por lo que este README
no reporta ninguna métrica de desempeño. Se añadirán cuando el entrenamiento y la validación estén
hechos.

## Alcance

Definido por el equipo. No se modifica sin aprobación conjunta.

- **Prototipo en entorno controlado.** No es un producto listo para producción.
- **Nunca borra ni envía correos reales.** La limpieza y el envío son **simulados**: el sistema
  muestra qué haría, pero no ejecuta ninguna acción sobre el buzón.
- **Datos:** SpaPhish y cuentas de prueba creadas por el equipo.
- **Modelo:** clasificación phishing vs. legítimo, entrenado solo con SpaPhish (correos en
  español). SpearPhishMX se descartó; las razones están en [docs/metricas.md](docs/metricas.md).
- **Publicidad y spam:** se detectan por reglas, no por el modelo — cabecera `List-Unsubscribe` y
  señales de envío masivo.
- **Salida al usuario:** una de tres categorías (legítimo, publicidad, phishing) y una prioridad
  (alta, media, baja).

## Stack

| Módulo | Tecnologías |
|---|---|
| `ml/` | Python 3.13, scikit-learn, pandas |
| `api/` | FastAPI, Pydantic, SQLAlchemy, SQLite |
| `extension/` | Chrome Manifest V3, side panel, HTML/CSS/JS sin framework |

## Integrantes

- Julian Camilo Cárdenas Torres
- Juan Sebastián Vásquez Peña
- Stephanie Murillo Urrego
- Mateo Enrique Bermejo Ramírez

## Estructura del repositorio

```
sicae-ia/
├── ml/                       Modelo de machine learning
│   ├── sicae_ml/             Código del modelo (paquete de Python)
│   │   ├── load_data.py      Carga y depuración de SpaPhish
│   │   ├── publicidad.py     Regla de publicidad (List-Unsubscribe, envío masivo)
│   │   ├── priority.py       Regla de prioridad (alta, media, baja)
│   │   ├── explicar.py       Motivos de la decisión del modelo para cada correo
│   │   ├── calibrar.py       Umbral de confianza "dudosa" y promedios para los motivos
│   │   └── sistema.py        analizar_correo(): modelo + publicidad + prioridad
│   ├── config/
│   │   └── prioridad.json    Reglas de prioridad: remitentes, palabras, umbrales
│   ├── tests/                Pruebas del modelo
│   ├── data/
│   │   ├── raw/              Datasets originales          ← fuera de Git
│   │   └── processed/        Datasets limpios             ← fuera de Git
│   ├── models/               Modelos entrenados (.joblib) ← fuera de Git
│   └── requirements.txt
│
├── api/                      Backend: puente entre el modelo y la extensión
│   ├── app/
│   │   ├── main.py           App FastAPI: GET /salud y POST /analizar
│   │   ├── config.py         Configuración leída de .env (rutas y límites)
│   │   └── esquemas.py       Qué entra y qué sale (Pydantic)
│   ├── tests/                Pruebas de los endpoints (modelo inventado)
│   └── requirements.txt
│
├── extension/                Extensión de Chrome (Manifest V3), ver docs/extension.md
│   ├── manifest.json         Permisos mínimos y configuración
│   ├── service-worker.js     Abre el panel lateral al hacer clic en el ícono
│   ├── sidepanel/            Panel: "Analizar este correo" y "Probar conexión"
│   ├── gmail/                Content script: lee el correo abierto (selectores.js + lector.js)
│   ├── opciones/             URL de la API y clave (chrome.storage.local)
│   ├── lib/                  Lógica pura, probada (logica.js, correo.js) y almacen.js
│   ├── estilos/sicae.css     Estilo de la demo (Sora + DM Sans, azul/naranja)
│   ├── fuentes/              Sora y DM Sans locales + licencias OFL
│   └── tests/                Pruebas con node --test (sin paquetes)
│
├── docs/
│   ├── arquitectura.md       Documentación de arquitectura y decisiones
│   ├── extension.md          Cómo cargar y configurar la extensión
│   └── metricas.md           Dataset usado y métricas del modelo
│
├── .github/workflows/
│   └── ci.yml                Integración continua (pruebas en cada push)
│
├── .env.example              Plantilla de variables de entorno
├── .gitignore
├── pyproject.toml            Instala ml/sicae_ml como paquete (pip install -e .)
└── CLAUDE.md                 Guía del proyecto
```

Las rutas marcadas **fuera de Git** no se versionan: los datasets son pesados y pueden contener
datos personales, y los modelos se regeneran entrenando. Las carpetas sí existen al clonar, vacías.

## Cómo obtener los datos

Los datos no están en Git, así que cada integrante los descarga una vez:

1. Descarga SpaPhish de Mendeley Data: <https://data.mendeley.com/datasets/hz2d6gz7pc/5>
2. Copia estos tres archivos a `ml/data/raw/spaphish/`:
   - `Spaphish dataset - DiB.csv`
   - `README.txt`
   - `dataset_schema.json`
3. Instala las dependencias del módulo ML y el propio proyecto:

   ```bash
   pip install -r ml/requirements.txt
   pip install -e .
   ```

   `pip install -e .` instala el paquete `sicae_ml` (la carpeta `ml/sicae_ml/`) en modo
   editable, según `pyproject.toml`. Así los scripts, las pruebas y la API lo importan con
   `from sicae_ml... import ...`, y los cambios en el código se ven sin reinstalar. Los scripts
   se corren como módulos: `python -m sicae_ml.<nombre>`.

4. Ejecuta la carga y depuración desde la raíz del proyecto:

   ```bash
   python -m sicae_ml.load_data
   ```

   El script verifica los conteos, quita las filas inválidas y guarda
   `ml/data/processed/correos.csv`. Las cifras de cada paso están en
   [docs/metricas.md](docs/metricas.md).

## Configurar la prioridad

La prioridad (alta, media o baja) de los correos legítimos sale de las reglas de
`ml/config/prioridad.json`. En Git ese archivo va con las listas de remitentes y dominios
**vacías**, y así debe quedarse.

Para usar tus remitentes reales, crea una **copia local** que Git ignora:

```bash
cp ml/config/prioridad.json ml/config/prioridad.local.json
```

En Windows con PowerShell, el comando es `Copy-Item ml/config/prioridad.json ml/config/prioridad.local.json`.

Después llena las listas en `prioridad.local.json`:
- **Si existe, se usa en lugar de `prioridad.json`.** Lo reemplaza completo; no se mezclan, así
  que debe tener todas las claves.
- **Está en `.gitignore`**, así que tus direcciones nunca se suben. Puedes comprobarlo con
  `git check-ignore -v ml/config/prioridad.local.json`.
- **Para volver a la configuración del repositorio,** borra o renombra el archivo local.

> **No pongas direcciones reales en `prioridad.json`**, solo en el archivo local.

Ejemplo comentado. El JSON real **no admite comentarios**: quítalos al copiarlo.

```jsonc
{
  // +2 si el correo viene de una de estas direcciones exactas
  "remitentes_importantes": ["coordinacion@universidad.edu.co", "jefa@example.com"],
  // +2 si viene de este dominio o de un subdominio (mail.universidad.edu.co también cuenta)
  "dominios_importantes": ["universidad.edu.co"],
  // +1 si aparece alguna como palabra completa, sin importar tildes ni mayúsculas
  "palabras_urgencia": ["vence", "fecha limite", "plazo", "urgente", "hoy", "manana", "recordatorio"],
  // Puntos de cada regla. destinatario_unico: un solo destinatario en To, sin Cc ni List-Id.
  // respuesta: el correo tiene In-Reply-To (contesta a otro correo)
  "puntos": {"remitente_importante": 2, "urgencia": 1, "destinatario_unico": 1, "respuesta": 1},
  // puntaje >= 3 -> alta; >= 1 -> media; 0 -> baja
  "umbrales": {"alta": 3, "media": 1}
}
```

Las reglas y por qué son reglas y no un modelo están en
[docs/metricas.md](docs/metricas.md), sección "Prioridad (paso 1.6)".

## Analizar un correo

`ml/sicae_ml/sistema.py` une todo: el modelo v1.0, la regla de publicidad y la prioridad.
Necesita el modelo (`ml/models/clasificador.joblib`, fuera de Git) y dos archivos de
calibración que se generan una vez, sin reentrenar el modelo:

```bash
python -m sicae_ml.descargar_modelo   # baja el modelo v1.0 de la Release y verifica su SHA-256
python -m sicae_ml.calibrar           # crea ml/reports/umbral_confianza.json y promedios_estructurales.json
```

### Descargar el modelo

El modelo v1.0 no está en Git: está publicado en la Release
[`v1.0-modelo`](https://github.com/XzJulian0711/sicae-ia/releases/tag/v1.0-modelo). Para tenerlo
no hay que copiarlo a mano ni reentrenar:

```bash
python -m sicae_ml.descargar_modelo
```

**Qué hace el comando:**
1. **Si `ml/models/clasificador.joblib` ya existe con el SHA-256 correcto,** no descarga nada.
2. **Si no existe,** lo descarga **solo por HTTPS**, con tiempo máximo de espera, a un archivo
   temporal, y calcula su SHA-256 mientras llegan los datos.
3. **Si el hash coincide** con el esperado, lo guarda como `clasificador.joblib`. **Si no
   coincide,** borra el temporal y termina con error: nunca queda un modelo sin verificar.
4. **Si existe un `clasificador.joblib` con otro hash,** no lo sobrescribe. Para reemplazarlo
   por el de la Release:

   ```bash
   python -m sicae_ml.descargar_modelo --forzar
   ```

**Por qué se verifica el SHA-256.**
- El SHA-256 es una "huella" de 64 caracteres: cambia por completo si cambia un solo byte del
  archivo. Así se detecta una descarga incompleta o dañada, y también un archivo que alguien
  modificó.
- Es importante porque `joblib` usa **pickle**, y pickle **puede ejecutar código al cargar** un
  archivo: un modelo alterado podría ejecutar cualquier cosa en el equipo. Por eso el hash se
  comprueba **antes** de cargarlo, no después.
- `cargar_modelo()` (y con ella la API, al arrancar) también lo verifica cada vez. Si no
  coincide, el modelo no se carga, `GET /salud` dice `sin_modelo` y `POST /analizar` responde
  503.
- El hash esperado está escrito en un solo lugar: `SHA256_MODELO` en `ml/sicae_ml/integridad.py`.

**Si alguien reentrena** con `python -m sicae_ml.train`, el archivo nuevo tiene otro SHA-256: ya
no es el modelo v1.0, así que no se carga hasta publicar una versión nueva y actualizar
`SHA256_MODELO`.

Ejemplo con un correo inventado. La salida es la real del modelo v1.0:

```python
from sicae_ml.priority import cargar_config
from sicae_ml.sistema import analizar_correo

cabeceras = {"From": "Paquetería Express <avisos@example.net>", "To": "usuario@example.org"}
asunto = "Su paquete está detenido"
cuerpo = ("Estimado cliente, su paquete no pudo ser entregado. Para programar una nueva entrega "
          "pague la tasa de envío antes de 24 horas: http://example.net/pago")

resultado = analizar_correo(cabeceras, asunto, cuerpo, n_urls=1, n_adjuntos=0,
                            config_prioridad=cargar_config())
```

```json
{
  "categoria": "phishing",
  "confianza": "alta",
  "puntaje": 1.6907,
  "prioridad": null,
  "motivos": [
    {"codigo": "palabra:paquete", "etiqueta": "Menciona «paquete»", "origen": "modelo"},
    {"codigo": "palabra:entrega", "etiqueta": "Menciona «entrega»", "origen": "modelo"},
    {"codigo": "palabra:cliente", "etiqueta": "Usa un saludo genérico («cliente»)", "origen": "modelo"},
    {"codigo": "estructura:long_cuerpo", "etiqueta": "El correo es corto", "origen": "modelo"}
  ],
  "version": "v1.0"
}
```

Cómo leer el resultado:
- **`puntaje` y `confianza`.** Un puntaje mayor que 0 es phishing. Si `|puntaje|` es menor que
  0,5, la `confianza` es "dudosa".
- **`prioridad`.** El phishing no lleva prioridad: va como alerta.
- **Un legítimo con prioridad.** Por ejemplo, un correo de un dominio marcado como importante,
  dirigido solo al usuario, que responde a otro y menciona una fecha límite. Da
  `"categoria": "legitimo"` y `"prioridad": "alta"`, con motivos de origen `modelo` («saludos»,
  «reunión», «tesis», "Trae adjuntos") y de origen `prioridad`.
- **Privacidad.** El resultado nunca incluye el texto, el asunto ni las direcciones del correo.

Cómo se calculan los motivos y el umbral de "dudosa":
[docs/metricas.md](docs/metricas.md), sección "Explicación y sistema (paso 1.7)".

## API

La API (FastAPI) expone `analizar_correo()` para la extensión. No borra ni envía correos: solo
los clasifica. De cada análisis guarda una fila con fecha, categoría, puntaje, confianza,
prioridad y versión del modelo, **nunca el texto ni las direcciones** (ver
[docs/arquitectura.md](docs/arquitectura.md), "Qué se guarda y qué no").

### Instalar

Desde la raíz del proyecto, con el entorno virtual activado:

```bash
pip install -r api/requirements.txt   # incluye ml/requirements.txt
pip install -e .                      # instala el paquete sicae_ml
```

Para clasificar, la API necesita estos archivos:
- **`ml/models/clasificador.joblib`:** el modelo v1.0. Está fuera de Git; se descarga con
  `python -m sicae_ml.descargar_modelo` (ver "Descargar el modelo").
- **Los dos JSON de calibración:** se generan con `python -m sicae_ml.calibrar`.

### Crear el archivo .env (obligatorio)

La API **no arranca sin una clave**. Cópiala de la plantilla y cámbiala:

```bash
cp .env.example .env          # en PowerShell: Copy-Item .env.example .env
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Abre `.env` y pon la clave que imprimió el segundo comando en `SICAE_API_KEY=...`. El valor de
ejemplo `cambia-esto` no sirve: con él la API no arranca, salvo en modo desarrollo.

`.env` **no se sube a Git**. Otras variables útiles:

| Variable | Para qué | Por defecto |
|---|---|---|
| `SICAE_MODO` | `desarrollo` habilita `/docs` | `produccion` |
| `SICAE_CORS_ORIGINS` | Orígenes de la extensión, separados por comas (`chrome-extension://<id>`). Nunca `*` | vacío (ninguno) |
| `SICAE_RATE_LIMIT` | Peticiones por minuto por IP | 30 |
| `SICAE_MAX_BYTES` | Tamaño máximo de una petición | 200000 |
| `SICAE_DB_PATH` | Archivo SQLite del registro | `api/data/sicae.db` |

### Arrancar

```bash
uvicorn app.main:app --app-dir api --reload
```

- `--app-dir api` le dice a uvicorn dónde está el paquete `app`.
- `--reload` reinicia el servidor al guardar cambios. Úsalo solo mientras desarrollas.
- **Sin `SICAE_API_KEY`**, uvicorn se detiene con el mensaje "Falta SICAE_API_KEY…".
- **Si falta el modelo, la API arranca igual:** `GET /salud` lo informa y `POST /analizar`
  responde 503.

### Probar con curl

`/salud` es pública. `/analizar` y `/estadisticas` piden la clave en el encabezado `X-API-Key`.
En PowerShell escribe `curl.exe` en lugar de `curl`.

```bash
curl http://127.0.0.1:8000/salud

curl -X POST http://127.0.0.1:8000/analizar \
  -H "Content-Type: application/json" \
  -H "X-API-Key: TU_CLAVE" \
  -d '{"asunto": "Su paquete está detenido", "cuerpo": "Estimado cliente, pague la tasa de envío.", "remitente": "avisos@example.net", "destinatarios": ["usuario@example.org"], "n_urls": 1, "n_adjuntos": 0}'

curl -H "X-API-Key: TU_CLAVE" http://127.0.0.1:8000/estadisticas
```

`/estadisticas` devuelve solo conteos, por ejemplo
`{"total": 1, "por_categoria": {"legitimo": 0, "publicidad": 0, "phishing": 1}, "por_prioridad":
{"alta": 0, "media": 0, "baja": 0, "sin_prioridad": 1}}`.

### Probar desde /docs (solo en modo desarrollo)

1. En `.env`, pon `SICAE_MODO=desarrollo` y reinicia la API. En producción, `/docs` responde 404.
2. Abre <http://127.0.0.1:8000/docs> y pulsa **Authorize**. Escribe la clave de `.env` en
   `X-API-Key`.
3. **POST /analizar → Try it out.** El cuerpo ya viene con un correo de ejemplo inventado; pulsa
   Execute. Con el modelo v1.0 responde `"categoria": "phishing"` con motivos como
   «paquete» y «entrega».

Campos de `POST /analizar`:

| Campo | Tipo | Límite |
|---|---|---|
| `asunto` | texto | 1.000 caracteres |
| `cuerpo` | texto plano | 50.000 caracteres |
| `remitente` | texto, por ejemplo `"Nombre <correo@dominio>"` | 320 caracteres |
| `destinatarios` | lista de direcciones | 100 |
| `cabeceras` | opcional: `{"List-Unsubscribe": "...", "In-Reply-To": "..."}` | 100 cabeceras |
| `n_urls`, `n_adjuntos` | enteros ≥ 0 | — |

**Errores** (siempre con `{"detalle": ...}` y sin repetir lo que se envió):

| Código | Cuándo |
|---|---|
| 401 | Falta la clave o es incorrecta (mismo mensaje en los dos casos) |
| 413 | La petición pasa de `SICAE_MAX_BYTES` |
| 422 | Entrada inválida: dice qué campo falló |
| 429 | Más de `SICAE_RATE_LIMIT` peticiones por minuto. Espera los segundos de `Retry-After` |
| 503 | Modelo no cargado: revisa `GET /salud` |

**Privacidad.** La API nunca escribe en los logs el asunto, el cuerpo ni las direcciones. Los
logs de uvicorn solo muestran el método y la ruta (`POST /analizar`). Las capas de seguridad
están explicadas en [docs/arquitectura.md](docs/arquitectura.md), "Seguridad de la API".

### Pruebas

```bash
pytest            # ml/tests y api/tests
pytest api/tests  # solo la API
```

Las pruebas de la API usan un modelo inventado y una clave de prueba, así que corren sin el
`.joblib` y sin `.env`.

## Cómo contribuir

### 1. Una rama por paso

Nunca se trabaja directamente sobre `main`. Cada paso de la guía va en su propia rama, con el
formato `feat/<fase>.<paso>-<tema>`:

```
feat/1.1-datasets
feat/1.2-preprocesamiento
feat/2.1-endpoints
```

```bash
git switch main
git pull
git switch -c feat/1.1-datasets
```

### 2. Commits en español

Mensaje corto que diga qué cambió, en español:

```bash
git commit -m "Agrega carga de SpaPhish y normalización de columnas"
```

Mejor varios commits pequeños y entendibles que uno gigante al final.

### 3. Pull request con revisión de otro integrante

```bash
git push -u origin feat/1.1-datasets
```

Después, en GitHub: *Compare & pull request*, describe qué hiciste y asigna como revisor a otro
integrante del equipo.

Antes de pedir la revisión, espera a que el pull request tenga la **marca verde de CI**: GitHub
corre las pruebas y la auditoría de dependencias solo. Si sale una ✗ roja, entra a *Details* para
ver qué falló y corrígelo en la misma rama.

**Nadie aprueba ni mergea su propio pull request.** Son cuatro personas sobre el mismo código: la
revisión cruzada es lo que evita que algo se rompa sin que nadie se dé cuenta, y deja constancia en
el historial de quién revisó qué.

### Antes de abrir el pull request

- Las pruebas pasan (`pytest`).
- Ninguna clave ni token quedó en el código. Las credenciales van en `.env`, que está fuera de Git;
  si agregaste una variable nueva, añádela también a `.env.example`.
- Cada función nueva tiene al menos una prueba en el `tests/` de su módulo.
