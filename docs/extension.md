# Extensión de Chrome de SICAE-IA

Pasos 3.1 a 3.4. La extensión tiene:
- un **panel lateral**, con el diseño del demo, que **analiza el correo abierto en Gmail**,
  muestra el resultado y prueba la conexión con la API;
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

1. **El ID de la extensión es fijo para todo el equipo:** `kaabamgfaihcpmchpeacpohpchlgildf`.
   Sale del campo `"key"` del manifest (ver "ID fijo"), así que es el mismo en todos los
   equipos, cargues la carpeta desde donde la cargues. Es el que aparece en la tarjeta de
   `chrome://extensions`.
2. **Ponlo en el archivo `.env` de la API** (en la raíz del proyecto):

   ```
   SICAE_CORS_ORIGINS=chrome-extension://kaabamgfaihcpmchpeacpohpchlgildf
   ```

   Así la API acepta explícitamente a la extensión (CORS). **Nunca uses `*`**: la API no arranca
   con ese valor. Como el ID es el mismo para todos, ya no hace falta una lista de IDs.
3. **Reinicia la API** (`uvicorn app.main:app --app-dir api --reload`), porque `.env` se lee al
   arrancar.
4. **Configura la extensión:** clic derecho en el ícono → **Opciones**, o el botón de ajustes
   (engranaje) del panel. Escribe:
   - **URL de la API:** `http://127.0.0.1:8000`. Es el valor por defecto y, por ahora, el
     **único** aceptado (ver "Qué URL acepta");
   - **Clave de la API:** el valor de `SICAE_API_KEY` de tu `.env`.

   Pulsa **Guardar**.
5. **Prueba:** abre el panel (clic en el ícono), despliega **Estado de la conexión** al final y
   pulsa **Probar conexión**. Se hacen dos peticiones:
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

## Inicio de sesión y consentimiento (paso 4.2)

Sigue el demo: la página 2 es la bienvenida, la 3 los permisos y la 7 el diagrama del flujo.
**La verificación del token en la API es el paso 4.3:** por ahora la API no lo recibe.

**Requisitos:**
- **Google Chrome** con una sesión de Google iniciada en el navegador. En Edge, Brave y otros,
  `getAuthToken` no funciona, y el panel lo dice.
- La cuenta debe estar en la **lista de usuarios de prueba** de la pantalla de consentimiento
  OAuth del proyecto en Google Cloud.

**Flujo:**

```
Abrir el panel ─┬─ con sesión y consentimiento ─→ vista principal (análisis)
                └─ si no ─→ Bienvenida ─ "Continuar con Google" (ventana oficial de Google)
                              ├─ ya había aceptado ─→ vista principal
                              └─ si no ─→ "Revisa los permisos"
                                            ├─ "Aceptar y continuar" ─→ guarda el consentimiento ─→ vista principal
                                            └─ "Ahora no" ─→ no guarda nada ─→ Bienvenida
```

- **Bienvenida:** título, 3 beneficios que ya funcionan y **solo** "Continuar con Google". No
  hay Microsoft ni otros proveedores. Lleva la nota "Nunca te pedimos la contraseña de tu
  correo".
- **Permisos:** muestra **solo lo que se pide hoy**, identificarte con tu correo de Google.
  - Leer correos, papelera, borradores y recordatorios se pedirán aparte cuando existan.
  - Incluye "Nunca haremos…" y el texto de la **Ley 1581 de 2012**.
- **Qué se guarda al aceptar:** solo `{aceptado: true, version: "1", fecha}`, en
  `chrome.storage.local` (`lib/sesion.js` → `crearConsentimiento`). Si cambia el texto de los
  permisos, se sube la versión y se vuelve a pedir.
- **El token nunca:**
  - se guarda en `storage`;
  - se muestra en pantalla ni se escribe en la consola;
  - sale de `lib/sesion.js`, cuyas funciones devuelven solo `{ok, mensaje}` o sí/no.

  Chrome lo guarda en su propia caché. Al abrir el panel, `getAuthToken({interactive: false})`
  solo comprueba si hay sesión.

**Errores** (nunca se muestra el texto crudo del error):

| Caso | Mensaje |
|---|---|
| Cerraste la ventana de Google sin terminar | "Cerraste la ventana de Google sin terminar… Si Google mostró «Acceso bloqueado», tu cuenta no está en la lista de usuarios de prueba." |
| La cuenta no es usuario de prueba | "Google no permitió el acceso: tu cuenta debe estar en la lista de usuarios de prueba del proyecto…" |
| Sin internet | "Sin conexión a internet. Revísala e inténtalo de nuevo." |
| Navegador sin `chrome.identity` | "Este navegador no permite iniciar sesión con Google desde la extensión. Usa Google Chrome." |
| Otro | "No se pudo iniciar sesión con Google. Inténtalo de nuevo." |

Chrome no siempre distingue "cerré la ventana" de "Google me bloqueó". Por eso el primer
mensaje también menciona la lista de usuarios de prueba.

**La cuenta en el encabezado:**
- Con la sesión iniciada, el encabezado del panel muestra el correo de la cuenta, por ejemplo
  `sicae.pruebas.2026@gmail.com`.
- Se pide **en el momento** a Google (`obtenerCorreo()` en `lib/sesion.js`, endpoint userinfo):
  - **no se guarda** en `chrome.storage`;
  - solo se muestra con `textContent`;
  - si el token venció (401), se quita de la caché y se reintenta una vez;
  - si falla, el botón no aparece y el resto del panel sigue igual.
- **Al pulsar el correo** se abre un menú con **"Cerrar sesión"**. Hace lo mismo que el botón de
  Opciones y vuelve a la bienvenida con el mensaje del resultado.
- El menú se cierra con **Escape** o con un clic fuera. Es accesible:
  - el botón tiene `aria-haspopup="menu"` y `aria-expanded`;
  - el menú tiene `role="menu"`;
  - al abrirse, el foco va a "Cerrar sesión".

### Usar otra cuenta: otro perfil de Chrome

La extensión usa **una sesión por perfil de Chrome**. Para usar otra cuenta de Google, se abre
**otro perfil**:
1. ícono de perfil de Chrome, arriba a la derecha → **Agregar**;
2. inicia sesión con la otra cuenta;
3. en ese perfil, carga la extensión otra vez con "Cargar descomprimida". **El ID es el mismo**,
   gracias a la `key`.

**Por qué:**
- `chrome.identity.getAuthToken` siempre usa la cuenta con la que **ese perfil** tiene sesión en
  Chrome;
- la caché de tokens, `chrome.storage` (URL, clave y consentimiento) y las extensiones también
  son **por perfil**.

Así nunca se mezclan tokens, consentimientos ni claves de cuentas distintas. Elegir otra cuenta
dentro del mismo perfil necesitaría el permiso `identity.email` y un selector de cuentas que
Chrome no ofrece de forma estable a las extensiones.

**En Opciones → "Sesión y consentimiento":**
- **Cerrar sesión:**
  1. quita el token de la caché de Chrome (`removeCachedAuthToken`);
  2. lo revoca en `https://oauth2.googleapis.com/revoke`, con el token en el cuerpo de un
     `POST` y nunca en la URL.

  Si Google no confirma, o no hay red, la caché igual queda limpia y el mensaje pide **quitar el
  acceso a mano en myaccount.google.com/permissions**.
- **Retirar consentimiento:** borra `{aceptado, version, fecha}`. La próxima vez que abras el
  panel verás la bienvenida.

## Analizar un correo de Gmail

1. Abre Gmail en Chrome con una **cuenta de prueba**. Si la pestaña ya estaba abierta antes de
   instalar o actualizar la extensión, recárgala con F5.
2. Abre un correo. Tiene que estar abierto, no solo seleccionado en la lista.
3. Haz clic en el ícono de SICAE-IA y pulsa **Analizar este correo**.
4. El panel muestra la tarjeta **CORREO ABIERTO** y el **resultado** (ver las secciones
   siguientes).

### El panel (paso 3.4)

Sigue el demo ("Demo extensión de correo inteligente.pdf", página 5) con el nombre SICAE-IA. De
arriba hacia abajo:

| Parte | Qué hace |
|---|---|
| **Encabezado** | Escudo en un cuadro oscuro, "SICAE-IA" y el botón de **ajustes** (engranaje), que abre Opciones |
| Aviso "Falta configurar la clave" | Solo si todavía no hay clave |
| **Analizar este correo** | Botón azul (acción). El panel no lee el correo solo: espera el clic |
| **Estado vacío** | Antes de analizar, en el lugar del resultado: escudo gris y "Abre un correo en Gmail y pulsa Analizar este correo." Desaparece al mostrar un resultado, y vuelve si la lectura falla. Nunca se ven los dos a la vez (`vistaResultado()` en `lib/tarjeta.js`) |
| **CORREO ABIERTO** | Asunto (o "(Sin asunto)") y remitente leídos de Gmail. Se ve aunque la API falle |
| **Franja de resultado** | Ícono + título en color, con consejos, prioridad, motivos y la nota (ver la tabla siguiente) |
| **Estado de la conexión** | Sección plegable (`<details>`) con "Probar conexión" y sus dos líneas |
| **Barra inferior** | Bandeja · **Analizar** · Redactar. Solo Analizar funciona; las otras dicen "Próximamente" y no hacen nada |

Todavía **no hay botones de acción** (mover a cuarentena, reportar): llegan con la API de Gmail.

### La franja de resultado (pasos 3.3 y 3.4)

Depende de la **categoría** y de la **confianza** que devuelve `/analizar`. "Dudosa" significa
que el puntaje del modelo quedó cerca de 0, donde se equivoca más (ver
`ml/sicae_ml/calibrar.py`).

| Categoría | Confianza | Color e ícono | Título | Debajo del título | Prioridad |
|---|---|---|---|---|---|
| Phishing | alta | 🔴 rojo · triángulo de alerta | "Posible phishing · riesgo alto" | 3 consejos: "No hagas clic en los enlaces." · "No envíes datos ni contraseñas." · "Verifica con el remitente por otro medio." | No se muestra |
| Phishing | dudosa | 🟠 naranja · signo de pregunta | "Revisa con cuidado" | "Tiene algunas señales de phishing, pero no es un resultado seguro. Antes de abrir enlaces o responder, confirma con el remitente por otro medio." | No se muestra |
| Legítimo | alta | 🔵 azul · visto ✓ | "No se detectaron señales de phishing" | — | Etiqueta |
| Legítimo | dudosa | 🔵 azul · visto ✓ | "No se detectaron señales de phishing, pero revisa con cuidado" | — | Etiqueta |
| Publicidad | alta | ⚪ gris · sobre | "Correo masivo o publicidad" | — | Etiqueta |
| Publicidad | dudosa | ⚪ gris · sobre | "Correo masivo o publicidad, pero revisa con cuidado" | — | Etiqueta |

En todos los casos:
- **Prioridad:** etiqueta "Prioridad alta / media / baja". Un phishing no la tiene: va como
  alerta.
- **Motivos como chips numerados (1, 2, 3):**
  - **Título:** "Señales de correo normal" en un legítimo; "Motivos" en phishing y publicidad.
  - **Hasta 3 motivos**, en el orden en que los da la API: primero los del modelo, luego los de
    publicidad y los de prioridad. Si no hay, la sección no aparece.
  - **Sin repetidos.** El modelo usa palabras sueltas y pares de palabras, así que pueden llegar
    "Menciona «estimado»" y "Menciona «estimado cliente»". En ese caso queda **solo la frase**.
    - Solo cuentan palabras completas: «pago» no se quita por «pagos pendientes».
    - También se quitan los duplicados exactos.
    - Los repetidos se quitan **antes** de quedarse con 3, para que los 3 sean distintos.
- **Nota fija:** "Resultado automático: puede equivocarse."
- **Nunca dice que un correo "es seguro".** El texto más tranquilo es "No se detectaron señales
  de phishing". Una prueba lo revisa.

**Accesibilidad:**
- **El color nunca es la única señal:** cada caso tiene un ícono de forma distinta y su título
  en texto. La prioridad es una etiqueta con texto y borde.
- **Contraste AA,** con cada título sobre su fondo:
  - rojo `#b91c1c`: 5,9:1;
  - naranja `#c2410c`: 4,9:1;
  - azul `#1d4ed8`: 6,2:1;
  - gris `#334155`: 9,5:1.
- **El resultado tiene `role="status"` y `aria-live="polite"`:** la tarjeta del correo y la
  franja están en ese contenedor, así que el lector de pantalla las anuncia al aparecer. El ícono
  es decorativo (`alt=""`), porque el título ya lo dice.
- **En el resto del panel:**
  - los íconos son decorativos (`aria-hidden`);
  - el botón de ajustes, que solo tiene ícono, se llama "Ajustes" (`aria-label`);
  - en la barra inferior, Analizar tiene `aria-current="page"` y Bandeja y Redactar tienen
    `aria-disabled="true"`. Su "Próximamente" sale en una región `aria-live`.
- **Más contrastes,** todos ≥ 7:1:
  - rótulos, remitente y pestañas inactivas, gris `#475569` sobre blanco o sobre el fondo
    `#f6f6f4`;
  - la pestaña activa, azul sobre `#eff6ff`: 6,2:1.
- El borde claro del botón redondo es decorativo: lo que identifica al botón es el engranaje
  oscuro (16:1).

**Seguridad:**
- Los motivos pueden traer palabras del correo, así que se escriben **solo con `textContent`**,
  cada uno en un `<li>` creado con `createElement`. Nunca se usa `innerHTML`.
- El asunto y el remitente de "CORREO ABIERTO" también se escriben con `textContent`.
- Los chips son una `<ol>`: el número lo pone el CSS (`counter`), así que el texto del motivo va
  solo.
- **Íconos:**
  - los de la franja son SVG locales (`extension/iconos/`), sin scripts ni enlaces. La ruta de
    cada uno sale de una tabla fija en `lib/tarjeta.js`, nunca de la API;
  - los del encabezado y la barra son SVG en línea en `panel.html`, también sin scripts ni
    enlaces. Una prueba lo revisa.

### Ícono de la extensión

`extension/iconos/sicae-16.png`, `-32`, `-48` y `-128` son el mismo escudo del encabezado:
cuadro oscuro, escudo blanco y un visto. Chrome necesita PNG para los íconos del manifest, porque
no acepta SVG. Por eso se generan con un script de Node **sin paquetes**: dibuja con 4×4 muestras
por píxel para suavizar los bordes y escribe el PNG con `node:zlib`.

El script está en **`herramientas/iconos.js`, en la raíz del repo y fuera de `extension/`**: la
extensión no lo usa, y así no se empaqueta con ella. Si se cambia el dibujo, desde la raíz del
proyecto:

```bash
node herramientas/iconos.js
```

Deja los 4 PNG en `extension/iconos/`. `extension/tests/iconos.test.js` comprueba:
- que los PNG guardados tengan **los mismos píxeles** que genera el script;
- el tamaño de cada uno;
- que el manifest los use.

Una prueba de `seguridad.test.js` revisa dos cosas:
- que no exista `extension/herramientas/`;
- que ningún archivo de la extensión mencione el script.

El rojo y el gris se suman a la paleta de la demo solo para la tarjeta. El azul sigue siendo
acción y el naranja, alerta.

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

### ID fijo (paso 4.1)

Chrome calcula el ID de una extensión a partir de la clave **pública** del campo `"key"` del
manifest:
1. SHA-256 de la clave en DER;
2. los primeros 16 bytes, es decir 32 dígitos hex;
3. cada dígito `0–f` se cambia por una letra `a–p`.

Con esa clave en el manifest, el ID es **`kaabamgfaihcpmchpeacpohpchlgildf`** para todo el
equipo. Ese mismo ID es el que se registra en **Google Cloud** para OAuth y la API de Gmail.

| Qué | Dónde | ¿Se sube? |
|---|---|---|
| Clave **pública** (RSA 2048, base64) | `"key"` en `extension/manifest.json` | **Sí.** No es secreta: solo fija el ID |
| Clave **privada** (`.pem`) | Fuera del repo, en el equipo de quien la generó (`%USERPROFILE%\.sicae-ia\sicae-ia-extension.pem`), legible solo por ese usuario | **Nunca.** `.gitignore` ignora `*.pem` y `*.crx` |

- **Para usar la extensión no se necesita la privada:** basta la pública del manifest. La
  privada solo haría falta para empaquetar un `.crx` con el mismo ID. Conviene guardar una copia
  en un gestor de contraseñas.
- **Ver el ID que da el manifest:**

  ```bash
  node herramientas/id-extension.js
  ```

  El script, sin paquetes (solo `node:crypto`), también genera un par nuevo con `--generar
  <ruta.pem>`.
  - Se niega a guardar la privada dentro del repo o encima de un archivo que ya existe.
  - Nunca la muestra.
  - **No hay que volver a generarla:** un par nuevo cambiaría el ID para todos.

**Si ya tenías la extensión cargada con el ID anterior:**
1. En `chrome://extensions`, **quítala y vuelve a cargarla** con "Cargar descomprimida".
2. **Guarda otra vez la URL y la clave en Opciones.** `chrome.storage` es por ID, así que la
   extensión con el ID nuevo empieza vacía.
3. **En tu `.env`,** cambia `SICAE_CORS_ORIGINS` al ID nuevo y reinicia la API.

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
| `storage` | Guardar la URL de la API, la clave y el consentimiento (`{aceptado, version, fecha}`) en `chrome.storage.local` (solo en este equipo). **Nunca el token de Google** |
| `sidePanel` | Abrir el panel lateral (`sidepanel/panel.html`) al hacer clic en el ícono. No da acceso a ningún sitio |
| `identity` (paso 4.2) | Iniciar sesión con Google: `chrome.identity.getAuthToken` pide el token con la cuenta con la que Chrome tiene sesión, en la ventana oficial de Google. La extensión **no ve ni guarda contraseñas**, y el token lo guarda Chrome en su propia caché, no la extensión. Sin este permiso no existe `chrome.identity` |
| `https://mail.google.com/*` | Correr el content script (`content_scripts` del manifest) que lee el correo abierto. Chrome avisa al instalar que la extensión puede leer ese sitio. También deja ver la URL de la pestaña solo si es Gmail |
| `http://127.0.0.1:8000/*` | Llamar a la API que corre en tu equipo |
| `https://oauth2.googleapis.com/*` (paso 4.2) | **Solo** para revocar el token al cerrar sesión (`POST /revoke`) y **leer la respuesta**, para confirmar que Google lo revocó. Sin este permiso la petición se podría enviar, pero no se sabría si funcionó. No da acceso a la cuenta ni al correo |
| `https://openidconnect.googleapis.com/*` (paso 4.2) | **Solo** para leer el correo de la sesión que se muestra en el encabezado: `GET /v1/userinfo`, con el token en la cabecera `Authorization`. Usa el alcance `userinfo.email`, que el usuario ya aceptó en "Revisa los permisos". El correo no se guarda |

**Alcances (scopes) de `oauth2`:** solo `openid` y `https://www.googleapis.com/auth/userinfo.email`,
para saber quién eres por tu correo. **No hay ningún alcance de Gmail**, así que este inicio de
sesión no da acceso a tus correos. El `client_id` no es secreto: en una extensión es público por
diseño, y Google solo lo acepta para el ID fijo `kaabamgfaihcpmchpeacpohpchlgildf`.

**Por qué userinfo y no `chrome.identity.getProfileUserInfo`:**
- `getProfileUserInfo` necesita otro permiso, `identity.email`, que al instalar avisa "Conocer
  tu dirección de correo electrónico";
- además da la cuenta del **perfil de Chrome**, mientras que userinfo da la cuenta que
  **autorizó el token**. Esa es la que usará la API en el paso 4.3. Hoy son la misma, pero
  userinfo es la fuente correcta.

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
  `/analizar`;
- `extension/lib/tarjeta.js`: elegir el estilo, los textos y qué secciones muestra la tarjeta;
- `extension/lib/sesion.js`: inicio y cierre de sesión con Google, consentimiento y qué
  pantalla se ve. Recibe `chrome.identity` y `fetch` como parámetros, así se prueba con dobles.

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
- **`tests/tarjeta.test.js`:** prueba la tarjeta:
  - las 6 combinaciones de categoría × confianza: variante, ícono, título, detalle, consejos y
    prioridad;
  - la etiqueta de prioridad;
  - los motivos: máximo 3, inválidos ignorados, HTML como texto;
  - que ningún texto diga "es seguro";
  - el título de los motivos por categoría y los repetidos (palabra dentro de una frase,
    duplicados exactos, el límite de 3 después de quitarlos);
  - los datos de "CORREO ABIERTO", también sin asunto.
- **`tests/sesion.test.js`:** con un **doble de `chrome.identity` y de `fetch`**, que nunca
  hablan con Google:
  - qué pantalla se ve en cada caso;
  - el consentimiento: los campos exactos y los inválidos;
  - el inicio de sesión: éxito sin devolver el token, y cada mensaje de error;
  - la comprobación de sesión: sin ventana y con tiempo máximo;
  - "Ahora no";
  - el cierre de sesión: el token en el cuerpo del `POST` y nunca en la URL, y qué pasa si
    Google falla o no hay red;
  - el correo del encabezado (`obtenerCorreo`):
    - el token va en `Authorization`, nunca en la URL;
    - se devuelve solo el correo;
    - con 401 reintenta una sola vez;
    - con datos inválidos, error o sin red da `{ok: false}`.
- **`tests/iconos.test.js`:** prueba los íconos de la extensión:
  - el CRC32 propio;
  - que cada PNG tenga firma, tamaño y tipo RGBA correctos;
  - que sus píxeles sean los que genera `herramientas/iconos.js` (en la raíz del repo);
  - que el manifest los use.
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
    `urlApi`, `claveApi` y el consentimiento (`{aceptado, version, fecha}`);
  - que el token de Google nunca vaya a `chrome.storage` ni a la consola;
  - el bloque `oauth2`: solo los alcances `openid` y email;
  - las 3 pantallas del panel: al cargar solo se ve la bienvenida, que ofrece solo Google;
  - que los permisos incluyan "Nunca haremos" y la Ley 1581;
  - que no haya claves escritas en el código;
  - que los íconos SVG no tengan scripts, eventos ni enlaces;
  - el SHA-256 de las fuentes.

Se necesita Node 22 o más nuevo. La CI las corre en cada pull request en **su propio job**
("Pruebas de la extensión (Node)"), en paralelo con el de Python.

## Limitaciones

- **La API todavía no verifica quién eres.** El inicio de sesión del paso 4.2 solo ocurre en la
  extensión; la verificación del token en FastAPI llega en el paso 4.3. Hasta entonces, la API
  sigue protegida solo por `X-API-Key`.
- **La pestaña de Gmail puede ser de otra cuenta.** Gmail permite varias cuentas a la vez
  (`/mail/u/0/`, `/mail/u/1/`…). El panel analiza el correo abierto en la pestaña activa aunque
  sea de una cuenta distinta a la de la sesión que muestra el encabezado. Por ahora no se
  comprueba; se resuelve en el **paso 4.4**.
- **Todavía no hay política de privacidad publicada:** la pantalla de permisos cita la Ley 1581,
  pero no enlaza a una política.
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
