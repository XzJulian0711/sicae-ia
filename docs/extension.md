# Extensión de Chrome de SICAE-IA

Pasos 3.1 y 3.2. La extensión tiene:
- un **panel lateral** que **analiza el correo abierto en Gmail** y prueba la conexión con la API;
- una página de **Opciones** para la URL de la API y la clave.

Necesita **Chrome 116 o más nuevo**.

Todo está hecho con HTML, CSS y JavaScript **sin frameworks, sin npm y sin código remoto**: cada
archivo está en la carpeta `extension/`, incluidas las fuentes.

## Cargar la extensión en Chrome

1. Abre `chrome://extensions` en Chrome.
2. Activa **Modo de desarrollador** (interruptor arriba a la derecha).
3. Pulsa **Cargar descomprimida** y elige la carpeta `extension/` del proyecto (la que tiene
   `manifest.json`).
4. Aparece la tarjeta **SICAE-IA**. Fija el ícono en la barra con el ícono de la pieza de
   rompecabezas → 📌. **Al hacer clic en el ícono se abre el panel lateral.** Esto lo activa
   `service-worker.js` con `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`.
   Si no se abre, en la tarjeta pulsa **Service worker** → Inspeccionar para ver los errores.

Si cambias archivos de la extensión, vuelve a `chrome://extensions` y pulsa ⟳ (Actualizar) en la
tarjeta.

## Conectarla con la API

1. **Copia el ID de la extensión.** Está en la tarjeta de `chrome://extensions`: es una cadena
   de 32 letras, como `abcdefghijklmnopabcdefghijklmnop`. El ID no cambia mientras cargues la
   misma carpeta.
2. **Ponlo en el archivo `.env` de la API** (en la raíz del proyecto):

   ```
   SICAE_CORS_ORIGINS=chrome-extension://abcdefghijklmnopabcdefghijklmnop
   ```

   Así la API acepta explícitamente a la extensión (CORS). **Nunca uses `*`**: la API no arranca
   con ese valor. Si hay varios integrantes con IDs distintos, sepáralos con comas.
3. **Reinicia la API** (`uvicorn app.main:app --app-dir api --reload`), porque `.env` se lee al
   arrancar.
4. **Configura la extensión:** clic derecho en el ícono → **Opciones**, o el enlace "Opciones"
   del panel. Escribe:
   - **URL de la API:** `http://127.0.0.1:8000`. Es el valor por defecto y, por ahora, el
     **único** aceptado (ver "Qué URL acepta");
   - **Clave de la API:** el valor de `SICAE_API_KEY` de tu `.env`.

   Pulsa **Guardar**.
5. **Prueba:** abre el panel (clic en el ícono) y pulsa **Probar conexión**. Se hacen dos peticiones:
   1. **`GET /salud`**, que es pública: ¿responde la API? ¿está cargado el modelo?
   2. **`GET /estadisticas` con la clave en `X-API-Key`**: ¿la clave guardada es correcta? Solo
      se usa el código de la respuesta (200 o 401); **los conteos no se leen ni se muestran**.
      Esta segunda petición solo se hace si la primera respondió.

**Primera línea: la conexión**

| Resultado | Qué significa |
|---|---|
| 🔵 "Conectado · modelo v1.0" | La API responde y el modelo está cargado |
| 🟠 "Conectado, pero el modelo no está disponible" | La API responde, pero falta el modelo o no pasó la verificación de SHA-256 (`python -m sicae_ml.descargar_modelo`) |
| 🟠 "Sin conexión con la API…" | La API está apagada, la URL está mal o tardó más de 5 s |
| 🟠 "La API respondió de forma inesperada…" | La URL apunta a algo que no es la API de SICAE-IA |

**Segunda línea: la clave**

| Resultado | Qué significa |
|---|---|
| 🔵 "Clave correcta." | La clave de Opciones es igual a `SICAE_API_KEY` del `.env` |
| 🟠 "Clave incorrecta. Revísala en Opciones." | La API respondió 401: la clave no coincide |
| 🟠 "Falta la clave: configúrala en Opciones." | Todavía no guardaste una clave. El panel también muestra el aviso **Falta configurar la clave de la API** con el botón **Abrir opciones** |
| 🟠 "Demasiadas pruebas seguidas…" | Se pasó el límite de peticiones por minuto de la API (429): espera un minuto |
| 🟠 "No se pudo comprobar la clave." | Otro error. Por ejemplo, el registro de la API no está disponible |

## Analizar un correo de Gmail

1. Abre Gmail en Chrome con una **cuenta de prueba**. Si la pestaña ya estaba abierta antes de
   instalar o actualizar la extensión, recárgala con F5.
2. Abre un correo. Tiene que estar abierto, no solo seleccionado en la lista.
3. Haz clic en el ícono de SICAE-IA y pulsa **Analizar este correo**.
4. El panel muestra:
   - **Categoría:** Legítimo, Publicidad o Phishing (posible fraude). Phishing sale en naranja,
     porque es una alerta.
   - **Prioridad:** Alta, Media o Baja. Un phishing no tiene prioridad: va como alerta.
   - **Confianza:** Alta o Dudosa. "Dudosa" significa que el puntaje del modelo quedó cerca de 0, donde se
     equivoca más (ver `ml/sicae_ml/calibrar.py`).

   Los motivos ("por qué") llegan en el paso 3.3.

Qué pasa por dentro:
1. El panel pide el correo a la pestaña activa con `chrome.tabs.sendMessage`.
2. El content script (`gmail/lector.js`) lo lee de la página y responde.
3. `lib/correo.js` arma la petición.
4. Se envía `POST /analizar` con la clave en `X-API-Key`.

| Mensaje | Qué significa |
|---|---|
| 🟠 "Abre un correo en Gmail para analizarlo." | La pestaña activa no es Gmail, o es la bandeja sin un correo abierto |
| 🟠 "Recarga la pestaña de Gmail (F5)…" | La pestaña se abrió antes de instalar o actualizar la extensión: todavía no tiene el content script |
| 🟠 "No se encontró el remitente / el texto del correo…" | El correo no terminó de cargar, o Gmail cambió su página (ver `gmail/selectores.js`) |
| 🟠 "El correo es muy largo: se analizó solo el inicio." | El cuerpo se recortó para no pasar los límites de la API: 50.000 caracteres de cuerpo **o** 200.000 bytes de la petición completa, lo que llegue primero |
| 🟠 "Clave incorrecta…" | 401: la clave no coincide con `SICAE_API_KEY` |
| 🟠 "El correo es demasiado grande para la API." | 413: la petición pasó `SICAE_MAX_BYTES` |
| 🟠 "La API no aceptó los datos del correo." | 422: algún campo pasó los límites del `.env` de la API |
| 🟠 "Demasiados análisis seguidos…" | 429: espera un minuto |
| 🟠 "El modelo no está cargado en la API…" | 503: descarga el modelo (`python -m sicae_ml.descargar_modelo`) |

### Qué se lee y qué no

| Se lee (solo del correo abierto) | Cómo |
|---|---|
| Asunto | Título de la conversación |
| Remitente | Solo la dirección, no el nombre |
| Destinatarios | Direcciones de Para y CC. La regla de prioridad "Dirigido solo a ti" los usa |
| Cuerpo | Texto plano, tal como se ve en pantalla |
| Cantidad de enlaces (`n_urls`) | `href` de los enlaces y `src` de las imágenes del cuerpo, **sin repetidos**: así cuenta `url_count` en SpaPhish, incluidos `#` y `mailto:`. Las direcciones se cuentan pero no se envían |
| Cantidad de adjuntos (`n_adjuntos`) | Tarjetas de adjuntos del mensaje. No se abren |

**No se lee:**
- las cabeceras;
- el contenido de los adjuntos;
- la bandeja y los otros correos;
- los mensajes anteriores del hilo. Si hay varios desplegados, se usa **el último**.

**No se guarda nada del correo.** Vive en la memoria del panel mientras se analiza:
- no va a `chrome.storage` ni a la consola;
- la API tampoco lo guarda: registra solo el resultado, sin texto.

El content script **no hace nada hasta que el panel le pide `leer-correo`**:
- solo acepta ese mensaje de la propia extensión;
- no modifica la página;
- no hace peticiones.

Todos los selectores de Gmail están en **`gmail/selectores.js`**, con un comentario cada uno.

### Qué URL acepta

La extensión solo puede llamar a las direcciones que están en `host_permissions` del manifest. Por
eso Opciones **solo acepta `http://127.0.0.1:8000`**, y explica por qué si escribes otra:

| Si escribes… | Mensaje |
|---|---|
| `http://localhost:8000` | Usa 127.0.0.1 en lugar de localhost: es la dirección que la extensión tiene permiso de usar |
| `http://127.0.0.1:8080` (otro puerto) | La API debe estar en el puerto 8000 |
| `https://…` | Por ahora la extensión solo tiene permiso para http://127.0.0.1:8000; para otra dirección https hay que agregarla al manifest |

La lista está en `ORIGENES_PERMITIDOS` (`extension/lib/logica.js`). **Debe coincidir con
`host_permissions`**, y una prueba lo comprueba. Para agregar una API por https, se agrega en
los dos lugares.

## Permisos y para qué sirve cada uno

`manifest.json` no admite comentarios, así que la explicación está aquí:

| Permiso | Para qué |
|---|---|
| `storage` | Guardar la URL de la API y la clave en `chrome.storage.local` (solo en este equipo) |
| `sidePanel` | Abrir el panel lateral (`sidepanel/panel.html`) al hacer clic en el ícono. No da acceso a ningún sitio |
| `https://mail.google.com/*` | Correr el content script (`content_scripts` del manifest) que lee el correo abierto. Chrome avisa al instalar que la extensión puede leer ese sitio. También deja ver la URL de la pestaña solo si es Gmail |
| `http://127.0.0.1:8000/*` | Llamar a la API que corre en tu equipo |

**No se pide** `tabs`, `scripting`, `activeTab`, `<all_urls>` ni acceso a otros sitios:
- el content script se declara en el manifest, así que no hace falta `scripting`;
- `chrome.tabs.query` y `chrome.tabs.sendMessage` funcionan sin el permiso `tabs`;
- la URL de la pestaña solo llega cuando es Gmail, que es justo lo que se necesita para decir
  "Abre un correo en Gmail".

## Seguridad en el código

- **La clave nunca está en el código.**
  - La escribe el usuario en Opciones y se guarda en `chrome.storage.local`, no en `sync`, para
    que no se copie a la cuenta de Google.
  - El campo es de tipo contraseña.
  - Una vez guardada **no se vuelve a mostrar**: el campo queda vacío y solo dice que hay una
    clave guardada.
- **Texto solo con `textContent`,** nunca `innerHTML`. Una prueba revisa que no aparezca
  `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` ni `new Function`.
- **`fetch` con tiempo máximo:** cada petición pasa por `pedir()`, con `AbortSignal.timeout(5000)`,
  `cache: "no-store"` y sin cookies (`credentials: "omit"`).
- **La clave solo viaja donde hace falta:** `/salud` se pide sin clave. La clave va en
  `X-API-Key` solo en `/estadisticas`, de cuya respuesta solo se usa el código, y en
  `/analizar`.
- **El resultado se valida:** solo se muestran categorías, prioridades y confianzas conocidas;
  cualquier otro valor da "respuesta inesperada".
- **Mensajes genéricos:** nunca se muestra el texto crudo de un error ni el campo `detalle` de la
  API. La versión del modelo solo se muestra si tiene una forma esperada, como `v1.0`.
- **Nada remoto y sin scripts en línea:**
  - la política de seguridad de contenido (CSP) por defecto de Manifest V3 bloquea los scripts
    remotos y los escritos dentro del HTML;
  - por eso todo está en archivos locales, sin `<script>` en línea, sin `onclick=` y sin
    `style=`;
  - una prueba revisa que ningún HTML ni CSS cargue recursos de internet.
- **URL de la API validada:** solo las direcciones de `ORIGENES_PERMITIDOS`, iguales a
  `host_permissions`; sin usuario, contraseña, rutas ni parámetros.

## Estilo

- Usa **Sora** para los títulos y **DM Sans** para el texto, con **azul `#1d4ed8` para las
  acciones** y **naranja `#c2410c` para las alertas**.
- Los dos colores tienen contraste AA sobre fondo blanco.
- Los botones y campos muestran el foco con un borde azul, para quien navega con el teclado.

### Fuentes (licencia SIL Open Font License 1.1)

Se descargaron una sola vez, por HTTPS, del repositorio oficial
[google/fonts](https://github.com/google/fonts). Las licencias están junto a ellas, en
`extension/fuentes/OFL-*.txt`.

| Archivo en `extension/fuentes/` | Origen | SHA-256 |
|---|---|---|
| `Sora-Variable.ttf` | `ofl/sora/Sora[wght].ttf` | `84ff7096ae3ec6c8be47d906d1a0ba4de7f2ce78c615275c77301964a316e16c` |
| `OFL-Sora.txt` | `ofl/sora/OFL.txt` | `ba0b9729c9428ba79a0459ab8ec575791b51509dbec213e383d0316d37fec299` |
| `DMSans-Variable.ttf` | `ofl/dmsans/DMSans[opsz,wght].ttf` | `8cd08d97e89c24d0aa92edd2f0f4c8ee6195eee9b7c9f154865a58b02f0c1c0d` |
| `OFL-DMSans.txt` | `ofl/dmsans/OFL.txt` | `9af36190332437f5ecd09974de43c1f7c77a310a996cdd8ceb25628b458840e1` |

Los archivos `.ttf` se renombraron solo para quitar los corchetes del nombre; su contenido no
cambió. Una prueba comprueba estos SHA-256.

## Pruebas

La lógica que no depende de Chrome está en dos archivos:
- `extension/lib/logica.js`: validar la URL y la clave, e interpretar `/salud`;
- `extension/lib/correo.js`: armar la petición, recortar, contar enlaces e interpretar
  `/analizar`.

Se prueba con el ejecutor que trae Node, **sin npm ni paquetes**:

```bash
node --test "extension/tests/*.test.js"
```

- **`tests/logica.test.js`:** casos válidos e inválidos de la URL (incluidos `localhost`, otro
  puerto y https), de la clave, de las respuestas de `/salud` y de los códigos de `/estadisticas`
  (200, 401, 429 y otros).
- **`tests/correo.test.js`:** casos de la petición, el recorte, los enlaces y las respuestas de
  `/analizar`. También comprueba que los campos y límites coincidan con `api/app/esquemas.py` y
  `config.py` (solo los lee).
- **`tests/gmail.test.js`:** el content script con **HTML inventado** que imita a Gmail, nunca
  correos reales:
  - correo completo y hilo con varios mensajes;
  - bandeja sin correo abierto;
  - correo sin remitente o sin cuerpo.

  Node no trae DOM y no usamos npm (jsdom), así que `tests/ayudas/mini-dom.js` es un DOM mínimo
  hecho para estas pruebas. Solo entiende selectores sencillos, y una prueba comprueba que los de
  `selectores.js` lo sean.
- **`tests/seguridad.test.js`:** revisión estática de los archivos. Comprueba:
  - que no se use `innerHTML`, `eval` ni código remoto;
  - que no haya scripts en línea;
  - que el manifest tenga exactamente los permisos de la tabla;
  - que el clic en el ícono abra el panel: sin `default_popup`, con `side_panel.default_path`
    en `sidepanel/panel.html` y un service worker que llama a `setPanelBehavior`;
  - que `ORIGENES_PERMITIDOS` coincida con `host_permissions`;
  - que el content script corra solo en Gmail y solo lea: sin `fetch`, sin `storage`, sin
    `console` y sin cambiar la página;
  - que nada del correo vaya a `chrome.storage`: solo `almacen.js` lo usa, y solo para
    `urlApi` y `claveApi`;
  - que no haya claves escritas en el código;
  - el SHA-256 de las fuentes.

Se necesita Node 22 o más nuevo. La CI las corre en cada pull request en **su propio job**
("Pruebas de la extensión (Node)"), en paralelo con el de Python.

## Limitaciones

- **La clave queda guardada sin cifrar en el perfil de Chrome.** Manifest V3 no ofrece un
  almacén seguro de secretos: quien tenga acceso a tu sesión del sistema operativo podría leerla.
  Por eso es una clave solo para este prototipo, y se cambia en `.env` si se filtra.
- **Solo funciona con la API en `http://127.0.0.1:8000`.** Para usar otra dirección hay que
  agregarla en `host_permissions` del manifest **y** en `ORIGENES_PERMITIDOS`. Una API que no
  esté en tu equipo debería usar https, para que la clave no viaje sin cifrar.
- **Desde la página de Gmail no se ven las cabeceras** (`List-Unsubscribe`, `List-Id`,
  `Precedence`, `In-Reply-To`, `Cc`…). Se envía `cabeceras: {}`, y por eso:
  - la **publicidad** solo se reconoce por las señales débiles: frases de baja y remitente
    masivo; se necesitan las dos. Las señales fuertes por cabecera no llegan, así que un boletín
    puede salir como legítimo;
  - la regla de prioridad **"es una respuesta"** (`In-Reply-To`) nunca se activa;
  - **Para y CC** se envían juntos como destinatarios, porque Gmail no los separa en la vista
    normal. "Dirigido solo a ti" puede fallar si hubo copias.
- **Gmail puede cambiar su página** sin aviso. Si deja de encontrar algo, se revisa
  `gmail/selectores.js`.
- **Cuerpos largos:** se envía solo el inicio, y el panel lo avisa. Hay dos topes:
  - 50.000 caracteres de cuerpo;
  - 200.000 bytes UTF-8 del JSON completo (`SICAE_MAX_BYTES`).

  El de bytes puede llegar antes: un carácter chino ocupa 3 bytes y un carácter de control
  ocupa 6 en el JSON (`\u0001`). Si se cambian esos límites en el `.env` de la API, hay que
  cambiarlos también en `lib/correo.js`; una prueba compara con los valores por defecto de
  `config.py`.
- **Solo el correo abierto**, el último desplegado del hilo. No analiza la bandeja ni varios
  correos a la vez.
- **La revisión visual en Chrome** (cargarla y probarla) se hace a mano, con los pasos de este
  documento.
