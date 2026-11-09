# Extensión de Chrome de SICAE-IA

Pasos 3.1 a 4.4. La extensión tiene:
- un **panel lateral**, con el diseño del demo, que **analiza el correo abierto en Gmail**,
  muestra el resultado y prueba la conexión con la API;
- una página de **Opciones** para la URL de la API y la sesión.

Desde el paso 4.3 **no hay clave de API**: se entra con la cuenta de Google y la API verifica
la sesión (ver "Sesión con la API").

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
2. **Ponlo en el archivo `.env` de la API** (en la raíz del proyecto), junto con el client ID
   de Google (paso 4.3). Los dos están en `.env.example` y **no son secretos**:

   ```
   SICAE_CORS_ORIGINS=chrome-extension://kaabamgfaihcpmchpeacpohpchlgildf
   SICAE_GOOGLE_CLIENT_ID=402160823752-0k9972f1flplq91cul9j9rmhiu4v3osm.apps.googleusercontent.com
   ```

   Sin `SICAE_GOOGLE_CLIENT_ID` la API no arranca. **`SICAE_API_KEY` ya no se usa**: si sigue en
   tu `.env`, se ignora y puedes borrarla.

   Así la API acepta explícitamente a la extensión (CORS). **Nunca uses `*`**: la API no arranca
   con ese valor. Como el ID es el mismo para todos, ya no hace falta una lista de IDs.
3. **Reinicia la API** (`uvicorn app.main:app --app-dir api --reload`), porque `.env` se lee al
   arrancar.
4. **Configura la extensión** (solo si cambiaste la URL): clic derecho en el ícono → **Opciones**,
   o en el panel: el menú de la cuenta → **Opciones**, o el enlace **Opciones** de la bienvenida. **URL de la API:** `http://127.0.0.1:8000`. Es el
   valor por defecto y, por ahora, el **único** aceptado (ver "Qué URL acepta"). Ya no hay campo
   de clave.
5. **Prueba:** abre el panel (clic en el ícono), despliega **Estado de la conexión** al final y
   pulsa **Probar conexión**. Se hacen dos peticiones:
   1. **`GET /salud`**, que es pública: ¿responde la API? ¿está cargado el modelo?
   2. **`GET /estadisticas` con la sesión** (`Authorization: Bearer`): ¿la API acepta tu sesión?
      Si no hay una, se abre antes (`POST /auth/google`). Solo se usa el código de la respuesta;
      **los conteos no se leen ni se muestran**. Esta segunda petición solo se hace si la primera
      respondió.

**Primera línea: la conexión**

| Resultado | Qué significa |
|---|---|
| 🔵 "Conectado · modelo v1.0" | La API responde y el modelo está cargado |
| 🟠 "Conectado, pero el modelo no está disponible" | La API responde, pero falta el modelo o no pasó la verificación de SHA-256 (`python -m sicae_ml.descargar_modelo`) |
| 🟠 "Sin conexión con la API…" | La API está apagada, la URL está mal o tardó más de 5 s |
| 🟠 "La API respondió de forma inesperada…" | La URL apunta a algo que no es la API de SICAE-IA |

**Segunda línea: la sesión con la API** (paso 4.3)

| Resultado | Qué significa |
|---|---|
| 🔵 "Sesión correcta." | La API aceptó tu sesión |
| 🟠 "La API no aceptó la sesión: vuelve a iniciar sesión." | 401 incluso después de renovar la sesión una vez |
| 🟠 "La API no pudo confirmar tu cuenta con Google…" | `/auth/google` respondió 401: el token de Google no es de esta app, venció o la cuenta no tiene el correo verificado |
| 🟠 "La API no pudo verificar tu cuenta con Google…" | 503: la API no pudo hablar con Google (sin red en el equipo de la API) |
| 🟠 "Tu sesión de Google terminó…" | Chrome ya no tiene token de Google: vuelve a iniciar sesión en el panel |
| 🟠 "Demasiadas pruebas seguidas…" | Se pasó el límite de peticiones por minuto de la API (429): espera un minuto |
| 🟠 "No se pudo comprobar la sesión." | Otro error. Por ejemplo, el registro de la API no está disponible |

## Inicio de sesión y consentimiento (paso 4.2)

Sigue el demo: la página 2 es la bienvenida, la 3 los permisos y la 7 el diagrama del flujo.
Desde el paso 4.3 la API **verifica** el inicio de sesión: ver "Sesión con la API".

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
- **Permisos:** muestra **solo lo que se pide hoy**:
  - identificarte con tu correo de Google;
  - desde el paso 4.4, **"Leer tus correos para clasificarlos. No guardamos su contenido."**;
  - desde el paso 4.5, **"Mover correos a la papelera o a cuarentena solo cuando lo confirmas.
    Se puede deshacer. Nunca borramos de forma definitiva."**, con la aclaración "Google
    describe este permiso como «leer, redactar y enviar». Es el mínimo que existe para mover a
    la papelera; SICAE-IA nunca envía ni borra correos de forma definitiva." La aclaración **no
    sube la versión** del consentimiento, porque no pide nada nuevo;
  - desde el paso 6.3, **"Redactar borradores con un modelo de IA que funciona en tu equipo; el
    texto no sale de él. Solo se guarda en Gmail como borrador si tú lo pides, y nunca se
    envía."**, con la nota **"Modo demostración (opcional, solo la cuenta de prueba del
    proyecto): envía el texto a Google Gemini."** La nota se muestra **siempre**: para saber si
    el modo demostración está disponible habría que abrir la sesión de la API **antes** de
    aceptar, y eso guardaría el `google_sub` de alguien que todavía no aceptó.

  Los cuatro son obligatorios, porque el permiso de Gmail es uno solo (`gmail.modify`, que
  incluye leer). Los recordatorios se pedirán aparte cuando existan. Incluye "Nunca
  haremos…" y el texto de la **Ley 1581 de 2012**, con el enlace **"Política de privacidad"**
  (paso 4.6), que abre [docs/privacidad.md](privacidad.md) en GitHub, en una pestaña nueva:
  - es un `<a>` normal con `target="_blank"` y `rel="noopener noreferrer"`: no carga nada
    remoto, y `noreferrer` evita mandar la dirección de la extensión;
  - **no necesita ningún permiso**: los `host_permissions` solo cuentan para `fetch` y para los
    content scripts, y la CSP limita lo que la página carga, no a dónde se navega;
  - apunta a la rama `main`, así que funciona después de unir el PR;
  - **la versión de la política es la del consentimiento ("4")**, y una prueba lo revisa. El
    enlace no sube la versión, porque no pide nada nuevo.
- **Qué se guarda al aceptar:** solo `{aceptado: true, version: "4", fecha}`, en
  `chrome.storage.local` (`lib/sesion.js` → `crearConsentimiento`).
  - Si cambia el texto de los permisos, se sube la versión y se vuelve a pedir.
  - En el **paso 4.4 pasó de la versión "1" a la "2"**, porque se agregó la lectura de correos.
  - En el **paso 4.5 pasó a la "3"**, porque se agregó mover a la papelera y a cuarentena.
  - En el **paso 6.3 pasó a la "4"**, porque se agregó redactar con IA (una finalidad nueva).
    Quien aceptó una versión anterior vuelve a ver "Revisa los permisos". La API también exige
    el "4" para `/redactar`.
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
- la caché de tokens, `chrome.storage` (URL, consentimiento y sesión de la API) y las extensiones también
  son **por perfil**.

Así nunca se mezclan tokens, consentimientos ni claves de cuentas distintas. Elegir otra cuenta
dentro del mismo perfil necesitaría el permiso `identity.email` y un selector de cuentas que
Chrome no ofrece de forma estable a las extensiones.

**En Opciones → "Sesión y consentimiento"** ("Cerrar sesión" también está en el menú de la cuenta):
- **Cerrar sesión:**
  1. cierra la sesión de la API (`POST /auth/cerrar`) y la borra de `chrome.storage.session`;
  2. quita el token de Google de la caché de Chrome (`removeCachedAuthToken`);
  3. lo revoca en `https://oauth2.googleapis.com/revoke`, con el token en el cuerpo de un
     `POST` y nunca en la URL.

  Si Google no confirma, o no hay red, la caché igual queda limpia y el mensaje pide **quitar el
  acceso a mano en myaccount.google.com/permissions**.
- **Retirar consentimiento** (`retirarConsentimiento` en `lib/sesion.js`), en este orden:
  1. **borra tu cuenta en la API** con `DELETE /cuenta`: tu usuario y todas sus sesiones. Va
     primero porque, si hace falta abrir sesión en la API, se necesita el token de Google;
  2. en este equipo borra `{aceptado, version, fecha}` y la sesión;
  3. **desde el paso 4.6, también revoca el acceso de Google**, igual que "Cerrar sesión"
     (`cerrarSesion`): quita el token de la caché y lo revoca, con el token en el cuerpo del
     `POST`.
  - Los pasos 2 y 3 se hacen **siempre**: también con la API apagada o sin una URL válida de la
    API. El mensaje (`mensajeRetiro`) tiene una parte de la API y otra de Google.
  - Si Google no confirma la revocación, el mensaje pide quitar el acceso a mano en
    **myaccount.google.com/permissions**.
  - La próxima vez que abras el panel verás la bienvenida.

## Sesión con la API (paso 4.3)

La API ya no usa una clave compartida (`SICAE_API_KEY` / `X-API-Key`): cada persona entra con su
cuenta de Google y la API **verifica** ese inicio de sesión.

1. **La extensión** pide el token de Google (sin ventana) y lo manda a `POST /auth/google` en
   `Authorization: Bearer`.
2. **La API** se lo pregunta a Google con el endpoint `tokeninfo`. El token va en el cuerpo de un
   `POST`, nunca en la URL, y la consulta espera 5 s como máximo. **Solo lo acepta si:**
   - es de nuestra app: `aud` y `azp` iguales a `SICAE_GOOGLE_CLIENT_ID`;
   - no está vencido;
   - incluye el alcance de email;
   - el correo está verificado.
3. **La API** crea su propia **sesión**: un token aleatorio (`secrets.token_urlsafe(32)`) que
   **dura 8 h** (`SICAE_DURACION_SESION_HORAS`). Lo devuelve una sola vez, con su vencimiento.
4. **La extensión**:
   - registra el consentimiento (`POST /consentimiento`, con la versión del texto);
   - manda la sesión en `Authorization: Bearer` a `/analizar` y `/estadisticas`.
5. **Si la API responde 401** (sesión vencida o cerrada), la extensión pide una nueva **una vez**
   y reintenta. El usuario no tiene que hacer nada, mientras Chrome tenga el token de Google.

`/analizar` exige además el consentimiento registrado; si falta, responde **403**. Así no se
procesa el correo de alguien que no aceptó (Ley 1581). Ante un 403, la extensión decide con
`queHacerAnte403()`:
- **lo registra sola y reintenta una vez** solo si en este equipo hay un consentimiento aceptado
  de la **misma versión** del texto actual;
- si no lo hay, o es de otra versión, **no registra nada** y vuelve a mostrar **"Revisa los
  permisos"**. Un 401 de la API siempre dice lo mismo,
"No autorizado.", para no revelar si la sesión no existía, venció o se cerró.

**Qué se guarda y dónde**

| Dónde | Qué | Qué **no** |
|---|---|---|
| API, tabla `usuarios` (SQLite) | `id`, `google_sub` (el identificador numérico de la cuenta que da Google), `creado`, `ultimo_acceso`, `consentimiento_version` y `consentimiento_fecha` | **El correo**, el nombre ni el token de Google |
| API, tabla `sesiones` | El **hash SHA-256** del token de sesión, `usuario_id`, `creada` y `expira` | El token en claro: si alguien copiara la base, no podría usar las sesiones |
| API, tabla `analisis` | Lo de siempre: categoría, puntaje, confianza, prioridad y versión | **No se liga al usuario** |
| Extensión, `chrome.storage.local` | `urlApi` y `{aceptado, version, fecha}` | Ni tokens ni el correo |
| Extensión, `chrome.storage.session` | La sesión de la API, `{token, expira}`. Vive en memoria, se borra al cerrar el navegador y los content scripts no la pueden leer | Nunca va a `local` |
| Ningún lado | El token de **Google** | — |

Ni la API ni la extensión escriben tokens ni correos en los logs o en la consola. Las pruebas lo
revisan, y también revisan los bytes del archivo `.db`.

**Cuánto dura y cómo termina la sesión**
- **Dura 8 horas** desde que se crea.
  - Una sesión vencida da 401 y se borra de la base; la extensión pide otra sola.
  - Las sesiones vencidas **de todos los usuarios** también se borran cada vez que se crea una
    nueva, aunque nadie las vuelva a usar. Una prueba lo comprueba.
- **Cerrar sesión** la invalida en la API (`POST /auth/cerrar`).
- **Cerrar el navegador** borra la copia de la extensión (`chrome.storage.session`).

**Cómo se borra la cuenta**

**Opciones → Retirar consentimiento** llama a `DELETE /cuenta`:
- borra tu fila de `usuarios` y, en cascada, **todas** tus sesiones;
- los análisis no se borran, porque nunca estuvieron ligados a ti;
- después la extensión revoca el acceso de Google (paso 4.6);
- si vuelves a entrar, eres un usuario nuevo y se te piden otra vez los permisos.

## Bandeja: "Tu bandeja hoy" (paso 4.4)

Sigue el demo (página 4) con SICAE-IA. Se abre con **Bandeja** en la barra inferior.

1. **Actualizar** lee los **últimos 50 correos de Recibidos** con la **API de Gmail**:
   - `users.messages.list` y luego `messages.get` de cada uno, como máximo 3 a la vez por la
     cuota de Gmail (ver "Cuota de Gmail y reintentos");
   - el progreso se ve como "Leyendo correos 12 de 50…".
2. Los clasifica todos en **un solo** `POST /analizar/lote`, mientras dice "Clasificando…".
3. Muestra:

| Parte | Qué muestra |
|---|---|
| **3 tarjetas** | Cuántos correos hay de prioridad **Alta** (en azul), **Media** y **Baja**. El phishing no cuenta: no tiene prioridad |
| **Aviso naranja** | Solo si hay phishing: "N correos con posible phishing." + **Ver motivos**, que despliega esos correos. Al pulsar uno se abre **su tarjeta** en la pestaña Analizar, con el resultado del lote, sin volver a leer Gmail |
| **Prioridad alta** | Hasta 10 correos: remitente · hora ("8:14", "ayer" o "5 nov") y asunto. También se pueden abrir |
| **Sobrecarga de publicidad** | Cuántos correos de publicidad hay y cuánto ocupan. Más abajo se explica cómo se cuenta |
| **Revisar y liberar espacio** | Abre "Liberar espacio" (paso 4.5, ver la sección siguiente) |
| **Último análisis** | La hora del último "Actualizar" |

**Cómo se cuenta la publicidad:**
- **cantidad** = los correos de la categoría **Promociones** de toda la cuenta (`labels.get` da el
  total exacto y cuesta 1 unidad de cuota), **más** los que el modelo detectó como publicidad
  entre los 50 y no están ya en Promociones;
- **tamaño** = la suma de `sizeEstimate` de hasta **100** correos de Promociones, más los
  detectados. Si Promociones tiene más de 100, el texto dice "**al menos** X MB".

**Qué se lee:**
- solo **Recibidos**, los últimos 50;
- el asunto, el remitente, Para y CC, el cuerpo en texto (el HTML se convierte a texto), los
  enlaces (`href` y `src`) y la cantidad de adjuntos;
- y **ahora sí las cabeceras** `List-Unsubscribe`, `List-Unsubscribe-Post`, `List-Id`,
  `Precedence` e `In-Reply-To`.

**Qué no se lee:**
- el contenido de los adjuntos;
- otras carpetas;
- más de 50 correos;
- otras cabeceras.

**Qué no se guarda:** nada de lo leído.
- Los correos y los resultados viven solo en la memoria del panel mientras está abierto: ni
  `chrome.storage` ni la consola.
- La API **no guarda texto**: del lote queda la misma fila de registro de siempre por correo
  (categoría, puntaje, confianza, prioridad y versión).
- Ni el token de Gmail ni nada de lo leído va a la URL: el token va solo en `Authorization`.

**Ahora sí se ven las cabeceras.** Desde la API de Gmail llegan las cabeceras que la página no
muestra. Por eso, **en Bandeja**:
- la publicidad se reconoce también por las señales fuertes (`List-Unsubscribe`, `List-Id`,
  `Precedence: bulk`);
- la regla de prioridad "es una respuesta" (`In-Reply-To`) sí funciona.

Desde el paso 7.1, **Analizar** también lee con la API de Gmail, así que tiene las mismas
cabeceras. Solo en su respaldo (la página) faltan.

**Errores:**

| Caso | Mensaje |
|---|---|
| Sin el permiso de Gmail (no se aceptó el alcance) | "Falta el permiso para leer tus correos…" + botón **Dar permiso**, que abre la ventana de Google. No se reintenta. Desde el paso 4.5 el botón también está en Liberar espacio y en la cuarentena: ahí, al aceptar, **no se repite la acción sola** ("Listo, ya tienes el permiso. Vuelve a intentarlo."); en la Bandeja sí se vuelve a leer |
| Token de Google vencido | Se renueva solo una vez; si sigue: "Tu sesión de Google venció…" |
| La Gmail API no está habilitada en Google Cloud | "La API de Gmail no está habilitada…" |
| Cuota de Gmail (429, 5xx o 403 de límite) | Primero se reintenta solo, hasta 5 veces, y el progreso dice "Gmail pidió esperar, reintentando…". Solo si sigue fallando: "Gmail limitó las consultas: espera un minuto…" |
| Sin internet | "Sin conexión a internet…" |
| API apagada | "Sin conexión con la API…": los correos se leen, pero no se clasifican |
| 401, 403 o 503 de la API | Los de siempre: la sesión se renueva una vez y, sin consentimiento válido, vuelve "Revisa los permisos" |

**La pestaña de Gmail de otra cuenta** (la limitación del paso 4.2, ahora resuelta):
- **Bandeja** usa el token de la sesión, así que siempre lee la cuenta de la sesión.
- **Analizar** compara la cuenta de la pestaña con la de la sesión, sin permisos nuevos:
  - Gmail pone la cuenta en el **título** de la pestaña ("Recibidos - x@gmail.com - Gmail");
  - si no coinciden: "Esta pestaña de Gmail es de otra cuenta…" y no se analiza;
  - si el título no trae la cuenta, se analiza igual.

## Liberar espacio y cuarentena (paso 4.5)

**La regla (CLAUDE.md, aprobada por el equipo):** nunca se borra de forma definitiva ni se envía
un correo. Solo se **mueve a la papelera**, con confirmación y con **Deshacer**, o a
**cuarentena**, que es solo una etiqueta. Las pruebas de estas acciones se hacen **solo** en
la cuenta de pruebas `sicae.pruebas.2026@gmail.com`, en el **perfil de Chrome "SICAE pruebas"**
(CLAUDE.md; ver la bitácora).

### Cómo se deshace cada acción

| Acción | Qué hace en Gmail | Cómo se deshace |
|---|---|---|
| **Mover a la papelera** (Liberar espacio) | `users.messages.trash`, uno por correo | **Deshacer** en el panel (`untrash` de esos mismos correos), o desde la **Papelera de Gmail** durante 30 días. Después Gmail la vacía solo |
| **Mover a cuarentena** (tarjeta de phishing) | Pone la etiqueta **"SICAE/Cuarentena"** y quita **Recibidos** (`batchModify`). **Nunca** va a la papelera | **Devolver a Recibidos** en el panel, o en Gmail: abrir la etiqueta SICAE/Cuarentena, y quitarle la etiqueta y moverlo a Recibidos |

### Qué correos se buscan

Se abre con **Revisar y liberar espacio** en la Bandeja.

- **Orígenes (se suman, O).** Hay que marcar **al menos uno**; si no, dice "Marca al menos un
  origen para buscar." y no busca:
  - **Publicidad detectada:** la del último análisis de la Bandeja;
  - **Promociones de Gmail** (`CATEGORY_PROMOTIONS`);
  - **Spam** (`SPAM`, con `includeSpamTrash=true`, porque Gmail deja fuera el spam si no);
  - **Todo el correo:** **no** viene marcado. Al elegirlo aparece el aviso "Incluye correos
    personales y de trabajo: revisa la lista con cuidado." Como ya incluye a los demás, se hace
    una sola búsqueda sin etiqueta.
- **Condiciones (filtran, Y), opcionales:**
  - "más antiguos que N meses" (1 a 120) → búsqueda `older_than:Nm`;
  - "más grandes que N MB" (1 a 50) → búsqueda `larger:NM`.

  En Promociones, Spam y Todo el correo las condiciones van en la búsqueda `q` de Gmail. En la
  publicidad detectada se aplican en el panel, con la fecha y el tamaño que ya se conocen.
- **Cuántos revisar:** 10, 25, 50, 100 u "Otro" (de 1 a 500). Es el **máximo** de correos que se
  revisan, los más recientes primero.
- **Lo que la Bandeja ya leyó no se vuelve a pedir a Gmail:** si un correo encontrado está entre
  los del último "Actualizar", se usa esa copia en memoria, con su resultado. Así se gasta menos
  cuota.

Ejemplo: Promociones + Spam, más antiguos que 6 meses → (Promociones **o** Spam) **y** más de 6
meses.

### Exclusiones (siempre)

Nunca se ofrecen para la papelera:
1. los **destacados** (`STARRED`) y los **importantes** (`IMPORTANT`), por sus etiquetas;
2. los de **posible phishing** y los de **prioridad alta**. Para saberlo, **se clasifican todos**
   los encontrados en lotes de 50 con `/analizar/lote`, con progreso ("Clasificando 100 de
   300…") y un botón **Cancelar**. Cancelar para antes del siguiente lote o pedido, y no mueve
   nada;
3. los que **no se pudieron clasificar**: sin saber si es phishing, no se ofrece.

Los excluidos no se muestran; se dice cuántos y por qué: "Se excluyeron 7: 3 destacados,
2 importantes, 1 de prioridad alta y 1 de posible phishing."

**Estos análisis no cuentan en `/estadisticas`:** el lote se envía con `registrar: false`, para no
inflar los conteos con una limpieza. Los de la Bandeja y Analizar se siguen registrando.

### Elegir, confirmar y mover

1. La lista sale **agrupada por remitente**, del que más pesa al que menos. Cada grupo tiene una
   casilla ("Tienda — 12 correos · 3,4 MB") y **Ver correos**, que despliega cada correo con su
   propia casilla. Arriba están **Seleccionar todo** y el total elegido.
2. **Mover a la papelera…** abre una confirmación (`<dialog>`, se cierra con Escape):
   "Vas a mover 40 correos (12 MB) a la papelera. Se puede deshacer. La papelera sigue ocupando
   espacio hasta que Gmail la vacía sola a los 30 días."
3. Se mueven 3 a la vez, con progreso. Si Gmail pide esperar, cada correo se reintenta solo
   (hasta 5 veces). **Si alguno sigue fallando, se pasa a los demás** y al final dice "Se
   movieron 38 de 40 a la papelera. 2 no se pudieron mover: inténtalo de nuevo más tarde."
4. Aparece **Deshacer**, que saca de la papelera **esos mismos** correos. Los identificadores
   están **solo en la memoria del panel**: no van a `chrome.storage` ni a la API, y se pierden al
   cerrarlo (entonces se deshace desde la Papelera de Gmail).
5. **Cada búsqueda nueva limpia lo anterior:** el error, los excluidos, la lista y el texto del
   último movimiento. Así nunca se ven a la vez un error nuevo y un resultado viejo. Si todavía
   se puede deshacer, queda solo el botón "Deshacer el último movimiento (40 correos)". Si un
   movimiento nuevo no logra mover ninguno, se conserva el Deshacer anterior.

### Cuota de Gmail y reintentos

Según la [documentación de Gmail](https://developers.google.com/workspace/gmail/api/reference/quota)
(consultada el 4 nov. 2026), cada usuario tiene **6.000 unidades por minuto**:

| Pedido | Costo |
|---|---|
| `messages.get` completo (`format=full`) | 60 |
| `messages.get` mínimo | 20 |
| `messages.trash` | 20 |
| `messages.untrash` | 5 |
| `messages.batchModify` | 50 |
| `messages.list` | 5 |

Una "Actualizar" de la Bandeja gasta unas 5.000 unidades (50 lecturas completas y 100 mínimas de
Promociones). Si justo después se buscan 73 correos para limpiar, se pasa el límite del minuto y
Gmail responde **429**. Por eso:
- se hacen **3 pedidos a la vez** (antes 5); el límite de pedidos simultáneos es de toda la cuenta;
- ante **429, 500, 502, 503, 504** o un **403 que traiga `rateLimitExceeded` o
  `userRateLimitExceeded`** (y ninguna otra razón), se **reintenta hasta 5 veces** con espera exponencial y aleatoria:
  1 s, 2 s, 4 s, 8 s y 16 s, más hasta 1 s al azar, con un tope de 32 s. Así lo recomienda Google
  ("Handle errors"), empezando en al menos 1 s. El azar evita que los 3 pedidos que fallaron
  juntos reintenten en el mismo instante;
- si Gmail manda la cabecera **`Retry-After`**, se espera lo que pide, entre 1 s y 60 s como
  máximo;
- mientras tanto, el progreso dice "Gmail pidió esperar, reintentando…";
- **solo al agotar los reintentos** se muestra el error;
- **no se reintenta** ante 400, 404, ningún otro 403 ni "sin red", porque repetir daría lo
  mismo. El 401 tiene su propia renovación (una vez);
- **el 403 de permiso insuficiente** (`insufficientPermissions`,
  `ACCESS_TOKEN_SCOPE_INSUFFICIENT`), por ejemplo si se aceptó la versión 2 y todavía falta
  `gmail.modify`, sale **enseguida**, sin esperas, y muestra **Dar permiso** en la Bandeja, en
  Liberar espacio y en la cuarentena. Al mover a la papelera dice "falta el permiso de Gmail" en
  lugar de "inténtalo más tarde";
- **crear la etiqueta de cuarentena** solo se reintenta con 429 o 403 de límite. Con un 5xx la
  etiqueta pudo haberse creado, y repetir el pedido daría un duplicado.

**¿Y mover a la papelera con `batchModify` (etiqueta `TRASH`)?** Gastaría mucho menos (50
unidades por hasta 1.000 correos), pero **no se usa**:
- la [guía de etiquetas](https://developers.google.com/workspace/gmail/api/guides/labels) dice que
  `TRASH` "se puede aplicar a mano";
- pero la referencia de `batchModify` solo dice que "modifica las etiquetas" y no menciona la
  papelera;
- la única operación documentada como "mueve el mensaje a la papelera" es `messages.trash`;
- no está documentado que sean equivalentes (por ejemplo, el vaciado a los 30 días). Se queda
  `trash` uno por uno, con reintentos.

### Cuarentena de phishing

- Sale el botón **Mover a cuarentena** en la tarjeta de **phishing**, en Analizar y en la que se
  abre desde la Bandeja.
- Busca la etiqueta "SICAE/Cuarentena" (`labels.list`); si no existe, la crea
  (`labels.create`). Después aparece **Devolver a Recibidos**.
- **El identificador del correo:** desde la Bandeja ya se tiene. Desde Analizar, el content
  script lo lee de `data-legacy-message-id` (`gmail/selectores.js`), solo si tiene forma de
  identificador de Gmail. Si no lo encuentra: "Ábrelo desde la Bandeja para moverlo a
  cuarentena."

### Qué se registra en la API

`POST /acciones` (con sesión y consentimiento) guarda **solo** `fecha, accion, cantidad, mb`, con
`accion` = `papelera`, `deshacer_papelera`, `cuarentena` o `devolver_cuarentena`. **Sin
identificadores de correo, sin remitentes y sin usuario.** Si el registro falla, la acción en
Gmail ya se hizo, y el panel solo avisa.

## Redactar (paso 6.3)

Sigue el demo (página 6) con SICAE-IA. Se abre con **Redactar** en la barra inferior y usa
`POST /redactar` de la API (paso 6.2). Exige el consentimiento **v4**.

1. **Respondiendo a:** el asunto y el remitente del correo abierto en Gmail, leídos con el
   content script de siempre. Se comprueba que la pestaña sea de la cuenta de la sesión. Si no hay
   un correo abierto: "Abre un correo en Gmail para responderlo." y el botón **Leer el correo
   abierto**.
2. **¿Qué quieres decir?:** hasta 500 caracteres, con contador ("123/500", en `aria-live`).
3. **Tono:** Formal (elegido por defecto), Breve o Cordial. Son radios nativos con forma de botón.
4. **Generar:** muestra "Generando borrador… La primera vez puede tardar mientras carga el
   modelo." y deja el borrador en un **campo editable** (`<textarea>`, con `.value`).
5. **Regenerar · Copiar · Insertar como borrador.** Debajo: "Nada se envía sin tu revisión." y
   el proveedor y los segundos ("Ollama (gemma4:e4b) en tu equipo · 1,4 s").
6. **Avisos:** si `/redactar` quitó enlaces que no estaban en tu indicación, o recortó el
   cuerpo, se dice. Los avisos los arma la extensión con los números de la respuesta.

**Insertar como borrador** (`users.drafts.create`, permiso `gmail.modify`), en el **mismo
hilo**, como pide la guía "Threads" de la API de Gmail:
- el `threadId`, el `Message-ID`, `References`, `Subject` y `From` se piden a la API con
  `messages.get` (`format=metadata` y esos `metadataHeaders`), sin adivinarlos. El id del
  mensaje lo lee el content script (`data-legacy-message-id`, paso 4.5);
- el MIME se arma a mano (`lib/redaccion.js` → `armarMime`):
  - `From`: tu correo (la documentación no dice que Gmail lo complete solo);
  - `To`: el remitente original;
  - `Subject`: "Re: …" sin duplicar el "Re:", codificado según el RFC 2047 si no es ASCII;
  - `In-Reply-To` y `References`;
  - el cuerpo en UTF-8 y base64, y el mensaje entero en base64url;
- **inyección de cabeceras:** cada valor se limpia de saltos de línea y caracteres de control, y
  los `Message-ID` y las direcciones se validan. Un asunto con "\r\nBcc: …" no agrega nada;
- se manda `POST /drafts` con `{message: {raw, threadId}}`. **Nunca se envía**:
  `/drafts/send` y `/messages/send` están bloqueadas en el cliente;
- al terminar: "**Borrador guardado en Gmail. Revísalo antes de enviarlo.**" y un enlace
  **Abrir Borradores en Gmail** de la **misma cuenta** (`/mail/u/N/#drafts`, sacado de la
  URL de la pestaña y validado).

**Copiar** usa `navigator.clipboard.writeText` **dentro del clic**. Según MDN, en Chromium
*"writing requires either the clipboard-write permission or transient activation"*: con el
clic basta, así que **no se pide `clipboardWrite`** (que mostraría el aviso "Modificar los datos
que copias y pegas"). Si el navegador lo rechaza, se selecciona el texto y se pide Ctrl+C.

**Modo demostración (Gemini):**
- el interruptor **solo aparece** si `GET /redactar/proveedores` dice que **esta sesión**
  puede usarlo (hay clave y es la cuenta de prueba), y viene **apagado**;
- **cada vez** que se genera con él, se abre un diálogo con **Cancelar**: "El texto se envía a
  Google Gemini (capa gratuita). Personas de Google pueden leerlo. Úsalo solo con correos de
  prueba." Cancelar (o Escape) no envía nada.

**Errores** (mensajes fijos de la extensión, según el `codigo` que manda la API):

| Caso | Mensaje |
|---|---|
| Ollama apagado o no instalado | "No se pudo conectar con Ollama. Si no lo tienes, descárgalo de ollama.com; si ya lo tienes, ábrelo." + enlace **Descargar Ollama** |
| Modelo no descargado | "Falta el modelo: en una terminal ejecuta «ollama pull gemma4:e4b»." (el modelo que dice la API) |
| Tiempo agotado | "La IA tardó demasiado. Inténtalo de nuevo." |
| Límite (20 por hora) | "Llegaste al límite de borradores por hora. Inténtalo en N min." |
| Sin el consentimiento v4 | Vuelve a "Revisa los permisos" |
| Pestaña de Gmail de otra cuenta | "Esta pestaña de Gmail es de otra cuenta…" (el de siempre) |
| Falta el permiso de Gmail al insertar | El mensaje de siempre + **Dar permiso** |

**Qué NO hace:**
- no envía correos (ni puede: el cliente bloquea `send`);
- no guarda el correo, la indicación ni el borrador: viven solo en la memoria del panel (ni
  `chrome.storage` ni la consola), salvo el borrador que tú guardes en Gmail;
- no cita el correo original ni agrega adjuntos;
- no usa `Reply-To`: Para es siempre el remitente original.

## Prueba funcional: diagnóstico y exportar (paso 7.1)

Dos herramientas para la prueba funcional, **solo con la API en `SICAE_MODO=desarrollo` y la
cuenta de prueba del proyecto**. La API lo decide con `GET /diagnostico/disponible`, la misma
regla del modo demostración (`SICAE_DEMO_CUENTA`). Con cualquier otra cuenta no aparecen, y en
producción esa ruta ni existe (404), así que tampoco. Ver docs/metricas.md, "Herramientas de
prueba: solo en desarrollo".

- **Cuándo aparecen.** El panel solo pregunta después de un análisis o de "Actualizar" en la
  Bandeja, así que no llama a la API antes del consentimiento. Al cerrar sesión se ocultan otra
  vez.
- **"Comparar página y API"**, debajo de la tarjeta de Analizar:
  - lee el correo abierto de la página (el respaldo de Analizar) y el mismo mensaje con la API
    de Gmail (lo que usan Analizar y la Bandeja);
  - arma los dos igual (`armarPeticionGmail`) y los envía a `POST /diagnostico`. Así la única
    diferencia es de dónde se leyó;
  - muestra una tabla **solo con números**:
    - enlaces, adjuntos y largo del cuerpo de cada camino;
    - si el cuerpo vino recortado;
    - el puntaje y cuánto aporta cada parte: el texto, los enlaces, los adjuntos y el largo.

  Nada del texto del correo se muestra ni se guarda.
- **"Exportar CSV (cuenta de prueba)"**, en la Bandeja:
  - descarga **local** de la última Bandeja (`sicae-bandeja-AAAA-MM-DD.csv`), con `asunto`,
    `categoria`, `confianza`, `prioridad` y `cuerpo_completo`;
  - **sin remitentes ni cuerpos**;
  - no pasa por la API y no pide el permiso `downloads`;
  - si un asunto empieza con `=`, `+`, `-` o `@`, se le antepone `'` para que la hoja de cálculo
    no lo ejecute como fórmula.
- **"Mensaje recortado".** Con un correo de más de ~102 KB, Gmail muestra "[Mensaje recortado]
  Ver todo el mensaje" y solo carga el inicio. `gmail/lector.js` lo detecta por el enlace con
  `view=lg` (`SICAE_MARCAS` en `gmail/selectores.js`). Si Gmail cambia ese enlace, el diagnóstico
  dirá "no" en un correo recortado: hay que revisarlo con **Inspeccionar**.

### Analizar lee con la API de Gmail (paso 7.1)

El diagnóstico mostró que el mismo correo daba resultados distintos en Analizar y en la Bandeja
(ver "Hallazgo" en `docs/metricas.md`). La causa: la página de Gmail mete cosas que no son del
correo, como el aviso "[Mensaje recortado] Ver todo el mensaje" y su enlace. Por eso:

1. **Analizar usa el mismo lector que la Bandeja.** El content script lee la página solo para
   sacar el id del mensaje (`data-legacy-message-id`, como Redactar). Con ese id, el panel lee
   el mensaje con la API de Gmail (`leerMensajes` → `interpretarMensaje`) y arma la petición
   con `armarPeticionGmail`, la misma función que usan la Bandeja y Liberar espacio. Mismo
   cuerpo, enlaces, adjuntos, cabeceras y límite de tamaño (el de cada correo del lote, unos
   40 KB). Una prueba comprueba que, para el mismo correo simulado, Analizar y la Bandeja envían
   **exactamente** lo mismo.
2. **La página es solo el respaldo**, si no hay id, si falta el permiso de Gmail, si no hay red o
   si Gmail falla. El token se pide **sin ventana** (`interactive: false`): Analizar nunca abre
   la de Google. En el respaldo, `gmail/lector.js` no lee ni cuenta lo que agrega Gmail, y
   quita **solo esos nodos exactos, nunca sus contenedores**:
   - el enlace "Ver todo el mensaje" (`view=lg`);
   - el texto del aviso justo antes del enlace, si es algo corto entre corchetes
     ("[Mensaje recortado]");
   - el botón "•••" del texto citado (`div.ajR`) y su imagen.

   Para eso **recorre el cuerpo solo leyendo** (`textoSin()`): no copia ni cambia la página,
   salta esos nodos y lo que Gmail tiene oculto, y pone los saltos de línea como `innerText`. Si
   Gmail no agregó nada, el cuerpo es el `innerText` de siempre.

   **Por qué solo los nodos exactos.** Antes se restaba el texto del contenedor del aviso. Gmail
   puede poner el aviso en el **mismo contenedor que el texto del correo**, y con un correo corto
   eso borraba el cuerpo entero: el diagnóstico daba 0 caracteres en la página contra 731 con la
   API. Una prueba con HTML inventado reproduce ese caso.

   **Protección.** Si después de limpiar el cuerpo queda vacío y antes no lo estaba, se usa el
   `innerText` de siempre quitando solo el texto exacto del aviso ("[Mensaje recortado]", "Ver
   todo el mensaje"), y el correo se marca con `limpiezaParcial`.

   La tarjeta muestra una nota gris con un texto fijo (`notaRespaldo()` en `lib/correo.js`):
   - "Leído desde la página de Gmail (no se pudo usar la API de Gmail)…";
   - con la protección, agrega: "No se pudo separar del todo el aviso de Gmail del texto del
     correo…".
3. **Adjuntos reales.** Ver "Qué se lee y qué no".

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
| **Encabezado** | Escudo en un cuadro oscuro, "SICAE-IA", la cuenta (menú con **Opciones** y **Cerrar sesión**) y el botón del **tema** (luna en el tema claro, sol en el oscuro), que alterna claro/oscuro |
| **Analizar este correo** | Botón azul (acción). El panel no lee el correo solo: espera el clic |
| **Estado vacío** | Antes de analizar, en el lugar del resultado: escudo gris y "Abre un correo en Gmail y pulsa Analizar este correo." Desaparece al mostrar un resultado, y vuelve si la lectura falla. Nunca se ven los dos a la vez (`vistaResultado()` en `lib/tarjeta.js`) |
| **CORREO ABIERTO** | Asunto (o "(Sin asunto)") y remitente leídos de Gmail. Se ve aunque la API falle |
| **Franja de resultado** | Ícono + título en color, con consejos, prioridad, motivos y la nota (ver la tabla siguiente) |
| **Estado de la conexión** | Sección plegable (`<details>`) con "Probar conexión" y sus dos líneas |
| **Barra inferior** | **Bandeja** (paso 4.4, ver "Bandeja") · **Analizar** · **Redactar** (paso 6.3, ver "Redactar") |

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
  es decorativo (`aria-hidden`), porque el título ya lo dice.
- **En el resto del panel:**
  - los íconos son decorativos (`aria-hidden`);
  - el botón del tema, que solo tiene ícono, se llama "Cambiar a tema oscuro" o "Cambiar a tema
    claro" (`aria-label` y `title`, según el tema actual);
  - el menú de la cuenta se abre con el foco en el primer ítem (Opciones), se recorre con ↑/↓ y
    se cierra con Esc;
  - en la barra inferior, la pestaña abierta (Analizar, Bandeja o Redactar) tiene
    `aria-current="page"`.
- **Más contrastes,** todos ≥ 7:1:
  - rótulos, remitente y pestañas inactivas, gris `#475569` sobre blanco o sobre el fondo
    `#f6f6f4`;
  - la pestaña activa, azul sobre `#eff6ff`: 6,2:1.
- El borde claro del botón redondo es decorativo: lo que identifica al botón es el sol o la luna,
  con el color del texto.

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
4. Se envía `POST /analizar` con la sesión de la API en `Authorization: Bearer`. La sesión se
   abre o se renueva sola si hace falta.

| Mensaje | Qué significa |
|---|---|
| 🟠 "Abre un correo en Gmail para analizarlo." | La pestaña activa no es Gmail, o es la bandeja sin un correo abierto |
| 🟠 "Recarga la pestaña de Gmail (F5)…" | La pestaña se abrió antes de instalar o actualizar la extensión: todavía no tiene el content script |
| 🟠 "No se encontró el remitente / el texto del correo…" | El correo no terminó de cargar, o Gmail cambió su página (ver `gmail/selectores.js`) |
| 🟠 "El correo es muy largo: se analizó solo el inicio." | El cuerpo se recortó para no pasar los límites de la API: 50.000 caracteres de cuerpo **o** 200.000 bytes de la petición completa, lo que llegue primero |
| 🟠 "La API no aceptó la sesión…" | 401 incluso después de renovar la sesión: vuelve a iniciar sesión |
| (vuelve "Revisa los permisos") | 403: la API no tiene registrado tu consentimiento. Si en este equipo hay uno aceptado de la versión actual, la extensión lo registra y reintenta una vez; si no, te pide aceptar otra vez |
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
| Cuerpo | Con la API de Gmail: la parte `text/plain` (o el HTML pasado a texto). En el respaldo: el texto que se ve en pantalla, sin el aviso de recorte ni el "•••" de Gmail |
| Cantidad de enlaces (`n_urls`) | `href` de los enlaces y `src` de las imágenes, **sin repetidos**: así cuenta `url_count` en SpaPhish, incluidos `#` y `mailto:`. Con la API, los del HTML completo; en el respaldo, los del cuerpo sin los de Gmail. Las direcciones se cuentan pero no se envían |
| Cantidad de adjuntos (`n_adjuntos`) | Solo los **adjuntos reales**: `Content-Disposition: attachment`, o sin esa cabecera y sin `Content-ID`. Las imágenes de una firma (en línea) no cuentan (paso 7.1). En el respaldo, las tarjetas de adjuntos. No se abren |
| Cabeceras | Con la API: `List-Unsubscribe`, `List-Unsubscribe-Post`, `List-Id`, `Precedence` e `In-Reply-To`. En el respaldo no se ven |

Desde el paso 7.1, Analizar lee **con la API de Gmail** (como la Bandeja) y la página es solo
el respaldo: ver "Analizar lee con la API de Gmail (paso 7.1)".

**No se lee:**
- otras cabeceras (como `Received` o `Reply-To`);
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
2. **Guarda otra vez la URL en Opciones, si la cambiaste.** `chrome.storage` es por ID, así que la
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
| `storage` | Guardar la URL de la API y el consentimiento (`{aceptado, version, fecha}`) en `chrome.storage.local`, y la sesión de la API en `chrome.storage.session` (memoria). **Nunca el token de Google** |
| `sidePanel` | Abrir el panel lateral (`sidepanel/panel.html`) al hacer clic en el ícono. No da acceso a ningún sitio |
| `identity` (paso 4.2) | Iniciar sesión con Google: `chrome.identity.getAuthToken` pide el token con la cuenta con la que Chrome tiene sesión, en la ventana oficial de Google. La extensión **no ve ni guarda contraseñas**, y el token lo guarda Chrome en su propia caché, no la extensión. Sin este permiso no existe `chrome.identity` |
| `https://mail.google.com/*` | Correr el content script (`content_scripts` del manifest) que lee el correo abierto. Chrome avisa al instalar que la extensión puede leer ese sitio. También deja ver la URL de la pestaña solo si es Gmail |
| `http://127.0.0.1:8000/*` | Llamar a la API que corre en tu equipo |
| `https://oauth2.googleapis.com/*` (paso 4.2) | **Solo** para revocar el token al cerrar sesión (`POST /revoke`) y **leer la respuesta**, para confirmar que Google lo revocó. Sin este permiso la petición se podría enviar, pero no se sabría si funcionó. No da acceso a la cuenta ni al correo |
| `https://openidconnect.googleapis.com/*` (paso 4.2) | **Solo** para leer el correo de la sesión que se muestra en el encabezado: `GET /v1/userinfo`, con el token en la cabecera `Authorization`. Usa el alcance `userinfo.email`, que el usuario ya aceptó en "Revisa los permisos". El correo no se guarda |
| `https://gmail.googleapis.com/*` (pasos 4.4, 4.5 y 6.3) | La API de Gmail, con el token en la cabecera `Authorization`: **leer** (`GET`) la bandeja y los correos a revisar, y **solo cinco `POST`**: `/messages/{id}/trash`, `/messages/{id}/untrash`, `/messages/batchModify` (cuarentena), `/labels` (crear "SICAE/Cuarentena") y `/drafts` (crear un borrador, paso 6.3; **nunca** `/drafts/send`). Cualquier otra ruta se rechaza **antes** de llamar a Gmail. Sin este permiso no se podrían leer las respuestas de Gmail |

**Alcances (scopes) de `oauth2`:**

| Alcance | Para qué |
|---|---|
| `openid` y `https://www.googleapis.com/auth/userinfo.email` | Saber quién eres por tu correo (pasos 4.2 y 4.3) |
| `https://www.googleapis.com/auth/gmail.modify` (paso 4.5; en el 4.4 era `gmail.readonly`) | **Leer** tus correos (Analizar desde el paso 7.1, Bandeja y Liberar espacio), **moverlos a la papelera** y sacarlos, y **poner o quitar etiquetas** (cuarentena). Una prueba revisa que sean exactamente estos tres alcances, sin `mail.google.com/` ni otros de Gmail (`gmail.send`, `gmail.compose`…) |

**Por qué `gmail.modify` y no `https://mail.google.com/`** (según la
[lista oficial de alcances](https://developers.google.com/workspace/gmail/api/auth/scopes),
consultada el 4 nov. 2026):
- `https://mail.google.com/` es el acceso **completo**, el único que permite **borrar de forma
  definitiva** (`messages.delete`, `batchDelete`). La regla del proyecto lo prohíbe.
- `gmail.modify` permite leer, escribir y enviar, pero "**no permite el borrado inmediato y
  definitivo** de hilos y mensajes, saltándose la papelera". Es el alcance más pequeño que deja
  usar `messages.trash` y `untrash`.
- **Pero `gmail.modify` sí permite enviar.** Por eso el cliente de `lib/gmail.js` solo acepta las
  cinco rutas `POST` de la tabla anterior (`RUTAS_POST_PERMITIDAS`). Las pruebas revisan:
  - que en **todo el código** (extensión, API y `herramientas`) no aparezcan `batchDelete`,
    `messages.delete`, `threads.delete`, `emptyTrash` ni el alcance `mail.google.com/`;
  - que `lib/gmail.js` no tenga rutas con `/delete`, `/send` ni `/import`, que `/drafts` aparezca
    solo para **crear** (nunca `/drafts/send` ni `/drafts/{id}`), y que `post()` rechace esas
    rutas sin llamar a Gmail.
- La papelera usa `messages.trash` y **no** `batchModify`: la documentación de `batchModify` solo
  habla de agregar y quitar etiquetas, mientras que `trash` está documentado para mover a la
  papelera. `batchModify` se usa solo para la cuarentena.

**Por qué en el paso 4.4 se usó `gmail.readonly` y no un alcance más reducido** (historia; desde
el 4.5 se usa `gmail.modify`):
- **`gmail.messages.readonly`** aparece en la consola de Google Cloud, al agregar permisos a la
  pantalla de consentimiento, con la descripción "Leer tus correos electrónicos". Pero **no
  está** en la [lista oficial de alcances de la Gmail API](https://developers.google.com/workspace/gmail/api/auth/scopes)
  (consultada el 4 nov. 2026).
  - Por eso no está documentado qué permite: si da el cuerpo del correo ni si acepta la búsqueda
    `q`.
  - No lo usamos: nos quedamos con `gmail.readonly`, que sí está documentado.
  - Si Google lo documenta más adelante, se puede revisar.
- **`gmail.metadata`**, el otro alcance de lectura reducido (este sí documentado), solo da
  etiquetas y cabeceras, **sin el cuerpo**. Con él:
  - `messages.get` no acepta los
    [formatos `FULL` ni `RAW`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/Format);
  - `messages.list` no acepta la
    [búsqueda `q`](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/list).

  Sin el cuerpo, el modelo no puede clasificar el correo ni contar sus enlaces y adjuntos.
  Además, también es "restringido", así que tampoco evita la verificación de Google.

El `client_id` no es secreto: en una extensión es público por diseño, y Google solo lo acepta para
el ID fijo `kaabamgfaihcpmchpeacpohpchlgildf`.

**`gmail.modify` es un alcance "restringido" para Google** (igual que `gmail.readonly`):
- con la pantalla de consentimiento en **modo de prueba** funciona para los **usuarios de prueba**
  del proyecto;
- publicar la extensión para cualquiera exigiría la verificación de Google y una evaluación de
  seguridad.

**Pasos en Google Cloud** (los hace el equipo, una vez):
1. **APIs y servicios → Biblioteca → Gmail API → Habilitar.** Si no, Gmail responde 403 y el panel
   dice "La API de Gmail no está habilitada…".
2. **Pantalla de consentimiento de OAuth → Permisos (scopes) →** agregar `.../auth/gmail.modify`
   (paso 4.5). `.../auth/gmail.readonly` ya no se pide y se puede quitar. **No** agregar
   `https://mail.google.com/`.
3. Probar **solo** con la cuenta de Gmail del proyecto (CLAUDE.md). Las acciones (papelera,
   cuarentena), **solo** en `sicae.pruebas.2026@gmail.com`, en el perfil de Chrome "SICAE
   pruebas". Esa cuenta tiene que estar en la lista de **usuarios de prueba** de la pantalla de
   consentimiento.

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

- **No hay claves en la extensión** (paso 4.3): la sesión de la API la entrega la API después de
  verificar con Google, y vive solo en `chrome.storage.session`. Una prueba revisa que no quede
  `X-API-Key` en ningún archivo.
- **Texto solo con `textContent`,** nunca `innerHTML`. Una prueba revisa que no aparezca
  `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval` ni `new Function`.
- **`fetch` con tiempo máximo:** cada petición pasa por `pedir()`, con `AbortSignal.timeout(5000)`,
  `cache: "no-store"` y sin cookies (`credentials: "omit"`).
- **Cada token solo viaja donde hace falta:**
  - `/salud` se pide sin nada;
  - el token de Google va solo a Google y a `POST /auth/google`;
  - la sesión de la API va en `Authorization: Bearer` a `/analizar`, `/analizar/lote`,
    `/acciones`, `/estadisticas` (de la que solo se usa el código), `/consentimiento`,
    `/auth/cerrar` y `DELETE /cuenta`.
- **Ningún borrado definitivo** (paso 4.5): la única llamada `DELETE` de todo el código es
  `DELETE /cuenta` de nuestra API. A Gmail solo se le hacen `GET` y los cinco `POST` permitidos
  (ver "Permisos"). Ninguno envía correos.
- **Lo que se mueve no se guarda:** los identificadores para Deshacer viven en una variable del
  panel (`ultimoMovimiento`), nunca en `chrome.storage` ni en la API.
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

- Usa **Sora** para los títulos y **DM Sans** para el texto, con **azul para las acciones** y
  **naranja para las alertas** (en el tema claro, `#1d4ed8` y `#c2410c`).
- Los dos colores tienen contraste AA en los dos temas (ver "Tema claro y oscuro").
- Los botones y campos muestran el foco con un borde azul, para quien navega con el teclado.
- **Paso 4.5:** mover a la papelera y a cuarentena son acciones de **alerta**, así que su botón
  es naranja (`.boton-alerta`). Contrastes calculados:
  - blanco sobre `#c2410c`: 5,18:1; sobre `#9a3412` (al pasar el mouse): 7,31:1;
  - deshabilitado, `#475569` sobre `#f1f5f9`: 6,92:1 (sin opacidad);
  - el total elegido, azul sobre `#eff6ff`: 6,16:1;
  - el borde de los campos numéricos, `#64748b` sobre blanco: 4,76:1 (mínimo 3:1 para
    controles).

### Tema claro y oscuro

- **El botón redondo del encabezado alterna el tema.** Muestra la luna en el tema claro ("pasar a
  oscuro") y el sol en el oscuro. Ya no abre Opciones: Opciones está en el menú de la cuenta y en
  un enlace pequeño de la bienvenida (así se llega también sin sesión).
- **Por defecto se sigue el tema del sistema** (`prefers-color-scheme`), y también sus cambios
  mientras el panel está abierto.
- **Si la persona elige uno, se guarda** en `chrome.storage.local` con la clave `tema`: solo la
  palabra `claro` u `oscuro` (`guardarTema` rechaza cualquier otro valor). Es una preferencia,
  no un dato del correo. Desde ahí, manda sobre el sistema.
- **Opciones usa el mismo tema** y lo sigue si se cambia en el panel (`chrome.storage.onChanged`).
- **Cómo funciona.** `lib/tema.js` pone `data-tema="claro"` u `"oscuro"` en `<html>`, y
  `estilos/sicae.css` cambia **todas** las variables de color:
  - el tema oscuro está dos veces con los mismos valores: en `@media (prefers-color-scheme:
    dark)` (para que no se vea un destello claro antes de que corra el JS) y en
    `:root[data-tema="oscuro"]`. Una prueba revisa que sean iguales;
  - **no hay colores fijos** fuera de los bloques de variables. En el HTML, solo el logo, que es
    igual en los dos temas, como el ícono de la extensión; en el tema oscuro el cuadro del logo
    lleva un borde para distinguirse del fondo;
  - los íconos de la tarjeta se dibujan con una **máscara** del SVG y el color de la variante
    (`--tarjeta-color`). Antes eran `<img>` con el color fijo: el azul `#1d4ed8` no llega a 3:1
    sobre ningún fondo oscuro;
  - en el tema oscuro, los botones de color son claros con texto oscuro (`--texto-sobre-color`).
- **Contraste AA calculado, no a ojo.** `tests/tema.test.js` lee las variables de los dos temas
  y calcula la razón de contraste de cada par (fórmula de WCAG 2.x): texto ≥ 4,5:1; controles e
  íconos ≥ 3:1. Con `node --test extension/tests/tema.test.js` se ve la razón de cada par. Los
  más bajos:

  | Par | Claro | Oscuro |
  |---|---|---|
  | Naranja sobre naranja suave (avisos, precaución) | 4,88 | 9,28 |
  | Texto de ejemplo de los campos sobre el fondo | 4,76 | 5,71 |
  | Azul sobre azul tenue ("Nunca haremos") | 5,77 | 5,74 |
  | Rojo sobre rojo suave (phishing, riesgo alto) | 5,91 | 8,51 |
  | Gris de la tarjeta de publicidad sobre su fondo | 9,45 | 8,40 |
  | Texto de los botones azules | 6,70 | 9,90 |

- **Campos de Opciones:** su borde era `#cbd5e1` (1,5:1, menos del 3:1 de un control). Ahora es el
  de los demás campos (`--borde-control`).

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
- `extension/lib/logica.js`: validar la URL, e interpretar `/salud` y la prueba de la sesión;
- `extension/lib/correo.js`: armar la petición, recortar, contar enlaces e interpretar
  `/analizar`;
- `extension/lib/tarjeta.js`: elegir el estilo, los textos y qué secciones muestra la tarjeta;
- `extension/lib/sesion.js`: inicio y cierre de sesión con Google, consentimiento y qué
  pantalla se ve. Recibe `chrome.identity` y `fetch` como parámetros, así se prueba con dobles;
- `extension/lib/gmail.js` y `extension/lib/bandeja.js` (paso 4.4): la API de Gmail y los
  conteos de la Bandeja;
- `extension/lib/limpieza.js` (paso 4.5): orígenes, condiciones, exclusiones, agrupado y textos
  de "Liberar espacio".

Se prueba con el ejecutor que trae Node, **sin npm ni paquetes**:

```bash
node --test "extension/tests/*.test.js"
```

- **`tests/logica.test.js`:** casos válidos e inválidos de la URL (incluidos `localhost`, otro
  puerto y https), de las respuestas de `/salud` y de los códigos de `/estadisticas`
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
  - la sesión con la API (paso 4.3), con un doble de la API y de `chrome.storage.session`:
    - `/auth/google` recibe el token de Google en `Bearer` y devuelve solo la sesión de la API;
    - si la API responde 401, se renueva una sola vez;
    - si la sesión guardada sigue vigente, no se llama a la API;
    - `/consentimiento`, `/auth/cerrar` y `DELETE /cuenta`;
    - cerrar sesión y retirar el consentimiento, también con la API apagada;
    - retirar el consentimiento (paso 4.6), con un registro del orden: `DELETE /cuenta` → borra
      lo local → quita el token de la caché → lo revoca (token en el cuerpo). También: Google no
      confirma (400 o sin red, con el mensaje de myaccount), API apagada, sin URL de la API, sin
      sesión de Google, y las 9 combinaciones de `mensajeRetiro`;
  - el correo del encabezado (`obtenerCorreo`):
    - el token va en `Authorization`, nunca en la URL;
    - se devuelve solo el correo;
    - con 401 reintenta una sola vez;
    - con datos inválidos, error o sin red da `{ok: false}`.
- **`tests/gmail.api.test.js`** (paso 4.4): la lectura con la **API de Gmail simulada**, con
  mensajes inventados en el formato JSON de Gmail:
  - cómo se lee cada mensaje: texto plano, `multipart`, solo HTML, adjuntos, Para + CC, las
    cabeceras y su recorte, base64url con tildes y emoji, y `charset`;
  - que el cliente solo haga GET, con el token en `Authorization` y nunca en la URL;
  - que con 401 se renueve una sola vez;
  - los errores: 403 de alcance, Gmail API apagada, 429, sin red;
  - que lea como máximo 3 a la vez, con progreso;
  - los **reintentos** (sin esperar de verdad: la espera se inyecta):
    - un 429 que se recupera, y un 429 permanente: 1 + 5 intentos, esperas crecientes y recién
      ahí el error de cuota;
    - `Retry-After` en segundos, como fecha HTTP, exagerado (queda en 60 s) o inválido (se usa
      el backoff);
    - el 503 y el 403 de límite se reintentan; 400, 404, el 403 de permiso y "sin red" no;
    - **el 403 se reintenta solo con `rateLimitExceeded` o `userRateLimitExceeded`**: con el
      cuerpo real de "permiso insuficiente" hay 1 solo pedido, ninguna espera y el código
      `sin_permiso` (el de Dar permiso), también en la Bandeja, la papelera (`sinPermiso: true`),
      Deshacer y la cuarentena; un 403 con `RESOURCE_EXHAUSTED` tampoco se reintenta;
    - crear la etiqueta no se repite ante un 500; el 401 no gasta reintentos;
    - en `trash`, un correo con 429 permanente queda en "no se pudieron mover" y los demás se
      mueven;
  - Promociones: con tope, sin la categoría y con error;
  - paso 4.5:
    - `post()` acepta solo las cinco rutas y rechaza las demás (`/delete`, `/send`,
      `/drafts/send`, `batchDelete`…) **sin llamar a Gmail**;
    - la búsqueda: etiquetas, `q` e `includeSpamTrash`; páginas hasta el tope; cancelar;
    - la papelera con **fallos parciales** (sigue con los demás) y **Deshacer** con los mismos
      identificadores;
    - la cuarentena: crea la etiqueta si falta, la reusa si existe, quita `INBOX`, **nunca llama
      a `trash`**, y "Devolver a Recibidos".
- **`tests/seguridad.test.js`** también revisa que cada búsqueda empiece con
  `limpiarResultadoPrevio()`, que esa función no borre lo que se puede deshacer, y que todos los
  clientes de Gmail del panel avisen los reintentos.
  - paso 6.3: **mismo hilo** (`datosParaResponder` pide `format=metadata` con `Message-ID`,
    `References`, `Subject` y `From`, y `crearBorrador` manda `POST /drafts` con
    `{message: {raw, threadId}}`), y `raw` o `threadId` raros se rechazan sin llamar a Gmail.
- **`tests/redaccion.test.js`** (paso 6.3): el MIME (cabeceras exactas, CRLF, UTF-8 de ida y
  vuelta, líneas de base64 de 76), el RFC 2047 (palabras de ≤ 75 sin partir un emoji), la
  **inyección de cabeceras**, "Re:" sin duplicar, `References`, el enlace a Borradores, y cada
  `codigo` de `/redactar` con su mensaje fijo (nunca el `detalle` de la API).
- **`tests/limpieza.test.js`** (paso 4.5):
  - nada marcado por defecto (tampoco "Todo el correo"), su aviso, y que sin origen no se busque;
  - los límites: cantidad 1–500, meses 1–120, MB 1–50;
  - las combinaciones O e Y y las búsquedas de Gmail que salen de ellas;
  - las exclusiones (destacados, importantes, phishing, prioridad alta, sin clasificar) y su
    texto;
  - el agrupado por remitente, los totales y los lotes de 50;
  - los textos de confirmación (MB y los 30 días) y de resultado.
- **`tests/bandeja.test.js`** (paso 4.4):
  - los conteos y las listas de phishing y de prioridad alta;
  - los formatos de hora y de tamaño;
  - el texto del aviso;
  - la publicidad, con "al menos" y sin contar dos veces un correo;
  - la cuenta del título de la pestaña de Gmail.
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
    `urlApi` y el consentimiento (`{aceptado, version, fecha}`) en `local`, y la sesión de la API
    solo en `chrome.storage.session`;
  - que `X-API-Key` ya no aparezca y que Opciones no tenga campo de clave;
  - que el token de Google nunca vaya a `chrome.storage` ni a la consola;
  - el bloque `oauth2`: exactamente `openid`, email y `gmail.modify`, sin `mail.google.com/`;
  - **ningún borrado definitivo en todo el código** (paso 4.5): ni `batchDelete`,
    `messages.delete`, `threads.delete` ni `emptyTrash`, y un solo `DELETE` (`/cuenta`);
  - que la cuarentena use `batchModify` y nunca `trash`, y que los identificadores de Deshacer
    no vayan a `chrome.storage`;
  - las 3 pantallas del panel: al cargar solo se ve la bienvenida, que ofrece solo Google;
  - que los permisos incluyan "Nunca haremos" y la Ley 1581;
  - el enlace a la política (paso 4.6): uno solo, en "Revisa los permisos", en pestaña nueva y
    sin referrer. Es la **única** excepción a "no carga nada de internet", y no agrega permisos;
  - `docs/privacidad.md`: su versión es `VERSION_CONSENTIMIENTO`; tiene lo que pide el art. 13
    del Decreto 1377 (Responsable con correo, domicilio aunque sea "Pendiente…", quién atiende,
    finalidad, derechos y cómo ejercerlos, fecha de vigencia y conservación); y dice lo que hace
    el sistema (las horas de sesión se comparan con `config.py`);
  - que no haya claves escritas en el código;
  - que los íconos SVG no tengan scripts, eventos ni enlaces;
  - el SHA-256 de las fuentes.

Se necesita Node 22 o más nuevo. La CI las corre en cada pull request en **su propio job**
("Pruebas de la extensión (Node)"), en paralelo con el de Python.

## Limitaciones

- **La API necesita internet para abrir sesión:** verifica cada inicio de sesión con Google. Si
  Google no responde, `/auth/google` da 503. Las sesiones ya abiertas siguen sirviendo hasta que
  vencen.
- **Bandeja lee solo los últimos 50 de Recibidos.** El tamaño de la publicidad se mide en hasta
  100 correos de Promociones; si hay más, dice "al menos".
- **"Actualizar" vuelve a registrar los mismos correos** en `/estadisticas`: las estadísticas
  cuentan análisis, no correos únicos. No se deduplica, porque haría falta guardar un
  identificador o un hash del correo.
- **El permiso de Google es más amplio de lo que usamos** (paso 4.5). Google describe
  `gmail.modify` como «leer, redactar y enviar». Es el mínimo que existe para mover a la
  papelera: `messages.trash` solo acepta `gmail.modify` o `https://mail.google.com/`, y este
  último también permite borrar de forma definitiva. Que SICAE-IA nunca envíe ni borre de forma
  definitiva lo garantiza **el código** (solo cinco rutas `POST` permitidas, ninguna de envío,
  revisadas por las pruebas), no el permiso. La pantalla "Revisa los permisos" lo aclara.
- **Deshacer se pierde al cerrar el panel** (paso 4.5): los identificadores movidos están solo en
  memoria. Después de cerrarlo, se recuperan desde la Papelera de Gmail (30 días).
- **La papelera sigue ocupando espacio** hasta que Gmail la vacía sola a los 30 días. SICAE-IA
  nunca la vacía.
- **Cuarentena desde Analizar** depende de `data-legacy-message-id` en la página de Gmail. Si Gmail
  lo cambia, el botón pide abrir el correo desde la Bandeja.
- **Cuota de Gmail:** mover 500 correos son 500 pedidos (`trash` es de uno en uno), o sea 10.000
  unidades: más que la cuota de un minuto. Los reintentos esperan a que Gmail deje seguir. Si un
  correo falla después de 5 reintentos, queda como "no se pudo mover" y se puede volver a
  intentar.
- **Clasificar para limpiar lleva tiempo:** con 500 correos son 500 lecturas (30.000 unidades,
  unos 5 minutos de cuota) y 10 lotes.
- **Cancelar no corta una espera en curso:** se detiene antes del siguiente pedido, pero si un
  pedido está esperando para reintentar, primero termina esa espera (como máximo 32 s, o 60 s
  con `Retry-After`).
- **Charset:** el cuerpo se decodifica con el `charset` de cada parte si el navegador lo conoce;
  si no, como UTF-8, y algún carácter podría verse mal.
- **Redactar (paso 6.3):** para insertar el borrador hace falta el id del mensaje que la
  extensión lee de la página de Gmail (`data-legacy-message-id`). Si Gmail lo cambia, el panel
  pide copiar el borrador y pegarlo a mano. Para es siempre el remitente original (no se usa
  `Reply-To`). La primera generación puede tardar mientras Ollama carga el modelo.
- **La cuenta de la pestaña sale del título de Gmail.** Si Gmail cambia ese formato, Analizar no
  podrá comprobarla y analizará igual.
- **La sesión de la API está en la memoria de Chrome** (`chrome.storage.session`) mientras el
  navegador está abierto. Quien use tu sesión del sistema operativo podría usarla hasta que venza
  (8 h). Cerrar sesión la invalida, y cerrar el navegador la borra.
- **Solo funciona con la API en `http://127.0.0.1:8000`.** Para usar otra dirección hay que
  agregarla en `host_permissions` del manifest **y** en `ORIGENES_PERMITIDOS`. Una API que no
  esté en tu equipo debería usar https, para que la sesión no viaje sin cifrar.
- **Respaldo de Analizar (paso 7.1).** Si no se puede usar la API de Gmail (sin id, sin
  permiso, sin red), Analizar lee la página, y el resultado puede variar un poco respecto a la
  Bandeja (la tarjeta lo avisa):
  - el cuerpo es solo lo que se ve: el texto citado oculto detrás de "•••" no entra, y si Gmail
    recortó el correo, solo el inicio;
  - el aviso de recorte y el "•••" se quitan por su enlace (`view=lg`), el texto entre
    corchetes de al lado y su clase (`div.ajR`). Si Gmail los cambia, se vuelven a contar: hay
    que revisarlo con **Inspeccionar**;
  - el recorrido que arma el texto se parece a `innerText`, pero no es idéntico: decide los
    saltos de línea por la etiqueta (`div`, `p`, `br`…), no por el CSS de Gmail.
- **Analizar usa el límite de tamaño del lote** (unos 40 KB por correo, paso 7.1), para enviar
  lo mismo que la Bandeja. Un cuerpo más largo se recorta, y la tarjeta lo avisa.
- **En el respaldo no se ven las cabeceras** (`List-Unsubscribe`, `List-Id`,
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
