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

| Endpoint | Pide | Qué hace |
|---|---|---|
| `GET /salud` | Pública | Dice si la API está arriba, si el modelo está cargado y su versión |
| `POST /auth/google` | Token de Google (`Bearer`) | Lo verifica con Google (`tokeninfo`) y crea una sesión de 8 h (paso 4.3) |
| `POST /consentimiento` | Sesión | Guarda qué versión del texto de permisos aceptó y cuándo |
| `POST /auth/cerrar` | Sesión | Cierra esa sesión |
| `DELETE /cuenta` | Sesión | Borra el usuario y todas sus sesiones |
| `POST /analizar` | Sesión + consentimiento | Clasifica un correo y registra el resultado (sin el texto ni el usuario) |
| `POST /analizar/lote` | Sesión + consentimiento | Lo mismo para 1 a `SICAE_MAX_LOTE` (50) correos, en el mismo orden (paso 4.4). Reutiliza `analizar_correo()`; si uno falla, en su lugar va `{"error": ...}` y los demás siguen. Una fila de registro por correo, sin texto. Tope propio de `SICAE_MAX_BYTES_LOTE` (2 MB) y cuenta como **una** petición en el límite por IP. Con `"registrar": false` (paso 4.5, la clasificación para "Liberar espacio") **no** escribe filas, así no cuenta en `/estadisticas`; por defecto es `true` y solo acepta `true`/`false` |
| `POST /acciones` | Sesión + consentimiento | Registra una acción hecha en Gmail desde la extensión (paso 4.5): `{accion, cantidad, mb}`. Responde **204**. Ver "Registro de acciones" |
| `POST /redactar` | Sesión + consentimiento **"4"** | Propone un borrador con IA (paso 6.2): Ollama local o, solo para la cuenta de prueba, el modo demostración con Gemini. Ver "3.3 Redacción con IA" |
| `GET /redactar/proveedores` | Sesión | Paso 6.3: `{local, modelo_local, demostracion}`. `demostracion` es `true` solo si hay `SICAE_DEMO_API_KEY` y el `google_sub` de la sesión es `SICAE_DEMO_CUENTA`. La extensión muestra el interruptor del modo demostración solo entonces. Nunca devuelve la clave ni la cuenta |
| `GET /estadisticas` | Sesión | Conteos por categoría y prioridad |

### 3.1 Seguridad de la API

Código en [`api/app/seguridad.py`](../api/app/seguridad.py). Solo usa la librería estándar y lo
que ya trae FastAPI. Cada petición atraviesa estas capas, de afuera hacia adentro:

| # | Capa | Qué hace | Por qué |
|---|---|---|---|
| 1 | Cabeceras de seguridad | Agrega a **todas** las respuestas: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` | Evitan que el navegador interprete mal la respuesta, que la API se muestre dentro de otra página, que se filtre la URL de origen y que un resultado quede guardado en caché |
| 2 | CORS | Solo los orígenes de `SICAE_CORS_ORIGINS` (por ejemplo `chrome-extension://<id>`) reciben permiso del navegador. Métodos GET, POST y DELETE; encabezados `Content-Type` y `Authorization`. **Nunca `"*"`**: si aparece, la API no arranca | Impide que cualquier página web abierta en el navegador del usuario llame a la API |
| 3 | Límite por IP | Como máximo `SICAE_RATE_LIMIT` peticiones por minuto (30 por defecto), en una ventana deslizante en memoria. Si se pasa: **429** con `Retry-After` | Frena el abuso y los intentos repetidos de adivinar una sesión |
| 4 | Tamaño máximo | Peticiones de más de `SICAE_MAX_BYTES` (200.000 por defecto): **413**, sin leerlas enteras ni repetir su contenido | Evita que un cuerpo gigante consuma memoria |
| 5 | Sesión (paso 4.3) | Las rutas protegidas exigen `Authorization: Bearer <sesión>`. La API busca el **hash SHA-256** del token en la tabla `sesiones` (`usuarios.py`). Si falta, es inventada, venció o se cerró: **401** con el mismo mensaje genérico. `/analizar` además exige el consentimiento (**403**) | Solo se guarda el hash, así que copiar la base no da sesiones válidas. Los tokens son aleatorios de 256 bits (`secrets.token_urlsafe(32)`), imposibles de adivinar. El mensaje único no dice cuál fue el problema |

Además:
- **Arranque seguro.** Sin `SICAE_GOOGLE_CLIENT_ID`, o con un valor que no parece un client ID de
  Google, la API **no arranca** y explica qué falta. `SICAE_API_KEY` ya no se usa.
- **Verificación con Google** (`api/app/google.py`, solo `urllib`). Se pregunta a `tokeninfo` con
  el token en el **cuerpo** de un `POST`, nunca en la URL, y con 5 s como máximo. Se acepta solo si
  cumple todo:
  - `aud` y `azp` iguales al client ID;
  - no está vencido;
  - incluye el alcance de email;
  - `email_verified` es `true`.

  Si Google no responde: **503**. De la respuesta solo se usa `sub`; el correo se descarta.
- **Sin secretos en los logs.** Nunca se escriben el token de Google, el de sesión ni el correo:
  solo el tipo de error.
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
- **No hay roles:** cualquier cuenta que Google acepte para el client ID (en modo de prueba, los
  usuarios de prueba del proyecto) puede usar la API. No hay administradores ni permisos
  distintos.
- **La API necesita internet para abrir sesión** (verifica con Google). Las sesiones ya abiertas
  siguen sirviendo hasta que vencen.

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

**Registro de acciones (paso 4.5)**, en la misma base y en `registro.py`. La extensión mueve los
correos en Gmail; la API **solo anota** que pasó, con `POST /acciones`:

| Columna | Tipo | Significado |
|---|---|---|
| `id` | entero | Número de la fila, automático |
| `fecha` | texto | Momento en UTC, ISO 8601 |
| `accion` | texto | `papelera`, `deshacer_papelera`, `cuarentena` o `devolver_cuarentena` (`CHECK`) |
| `cantidad` | entero | Cuántos correos, de 0 a 500 (`CHECK`) |
| `mb` | real | Cuánto ocupaban, en MB, mayor o igual a 0 (`CHECK`) |

- **No se guarda** el identificador de ningún correo, el remitente ni el usuario. El cuerpo se
  valida con `extra="forbid"`: si llega cualquier otro campo (por ejemplo `ids`), es **422**.
- La API **no habla con Gmail**: no puede mover ni borrar correos.
- Si el registro falla: **503**. La acción en Gmail ya se hizo, y la extensión solo avisa.

**Usuarios y sesiones (paso 4.3)**, en la misma base. El código está en
[`api/app/usuarios.py`](../api/app/usuarios.py):

| Tabla | Columnas | Qué **no** se guarda |
|---|---|---|
| `usuarios` | `id`, `google_sub` (UNIQUE: el identificador de la cuenta que da Google), `creado`, `ultimo_acceso`, `consentimiento_version`, `consentimiento_fecha` | El correo, el nombre y el token de Google |
| `sesiones` | `hash` (SHA-256 del token de sesión, 64 hex), `usuario_id` (con `ON DELETE CASCADE`), `creada`, `expira` | El token en claro |

- **Los análisis no se ligan al usuario:** la tabla `analisis` no tiene columna de usuario.
- **`DELETE /cuenta`** borra la fila de `usuarios` y, en cascada, todas sus sesiones.
- **Las sesiones vencidas** se borran al usarse y cada vez que se crea una nueva.
- **Una prueba revisa los bytes del `.db`:** después de iniciar sesión y analizar, no aparecen ni
  el correo de Google, ni el token de Google, ni el token de sesión.

### 3.3 Redacción con IA (paso 6.2)

Código en [`api/app/redaccion.py`](../api/app/redaccion.py). `POST /redactar` recibe
`{indicacion (1 a 500), tono (formal | breve | cordial), asunto, cuerpo, modo (local |
demostracion)}`. A propósito **no** acepta remitente, destinatarios ni cabeceras (`extra="forbid"`).

**Proveedores:**

| Modo | Proveedor | Cómo |
|---|---|---|
| `local` (por defecto) | **Ollama en este equipo** (`SICAE_IA_URL`, solo `http://127.0.0.1:<puerto>`) | API nativa `POST /api/chat` con `"think": false` (sin razonamiento), `"stream": false` y `"keep_alive": "10m"`. **Sin proxies** y sin seguir redirecciones: nada sale de la máquina |
| `demostracion` | **Gemini, capa gratuita** (dirección fija: `generativelanguage.googleapis.com/v1beta/openai/chat/completions`) | Solo si hay `SICAE_DEMO_API_KEY` y el `google_sub` de la sesión es `SICAE_DEMO_CUENTA`. `reasoning_effort: "minimal"` (en Gemini 3 no se puede apagar). Las direcciones de correo se cambian por `[correo]` |

- **Por qué la API nativa de Ollama:** según su documentación (8 nov. 2026), `"think": false` y
  `keep_alive` existen en `/api/chat`. El endpoint compatible con OpenAI no acepta `keep_alive`.
- **Nunca hay "plan B":** si Ollama falla, la respuesta es el error; no se pasa a Gemini.
- **Inyección de instrucciones:**
  - el mensaje de sistema dice que el correo, entre `<<<CORREO>>>` y `<<<FIN_CORREO>>>`, son
    datos y no instrucciones;
  - las marcas que traiga el correo se neutralizan;
  - del borrador se quitan los `<think>…</think>` y los enlaces que no estaban en la indicación
    (`enlaces_quitados` y un aviso).
- **Errores:**
  - 503: Ollama no instalado o apagado (se ven igual: conexión rechazada), modelo no descargado
    (`ollama pull …`), configuración inválida o demostración desactivada;
  - 504: tiempo agotado (`SICAE_IA_TIEMPO_MAX_S`);
  - 502: respuesta rara o clave de Gemini rechazada.

  **Nunca** se devuelve ni se escribe en los logs lo que respondió el proveedor.
- **`codigo` en los errores** (paso 6.3): los errores de `/redactar` traen `{"detalle", "codigo"}`
  (`sin_conexion`, `modelo_no_descargado`, `tiempo_agotado`, `consentimiento`, `demo_cuenta`,
  `demo_desactivado`, `limite_hora`…). La extensión elige su propio mensaje con el código y no
  muestra el `detalle`. Se hace con `ErrorConCodigo`, una `HTTPException` con `codigo` que el
  manejador de errores agrega al JSON. Los demás errores de la API no cambian.
- **Límite:** `SICAE_IA_LIMITE_HORA` (20) borradores por usuario por hora, en memoria (ventana
  deslizante; se reinicia con la API). Al pasarse: 429 con `Retry-After`.

**Registro de borradores**, en la misma base y en `registro.py`:

| Columna | Tipo | Significado |
|---|---|---|
| `id` | entero | Número de la fila, automático |
| `fecha` | texto | Momento en UTC, ISO 8601 |
| `proveedor` | texto | `ollama` o `demostracion` (`CHECK`) |
| `modelo` | texto | Por ejemplo `gemma4:e4b` (1 a 100 caracteres) |
| `segundos` | real | Cuánto tardó, ≥ 0 |
| `exitoso` | entero | 1 si hubo borrador, 0 si falló |

**Nunca** se guardan la indicación, el correo, el borrador ni el usuario. Una prueba busca esos
textos (y la clave de Gemini) en los bytes del `.db` y en los logs.

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
