# Bitácora de decisiones (trabajo con IA)

Registro de las decisiones del equipo que cambian las reglas del proyecto, en especial las de
la sección "Alcance" de [`CLAUDE.md`](../CLAUDE.md), que no se cambian sin aprobación del equipo.
Cada entrada dice la fecha, quién la aprobó, qué cambió y por qué.

---

## 2026-11-04 · Regla de borrado y envío de correos (paso 4.4)

- **Aprobada por:** el equipo completo.
- **Dónde:** `CLAUDE.md`, sección "Alcance (no cambiar sin aprobación del equipo)".
- **Regla anterior:**

  > Nunca borrar ni enviar correos reales. Limpieza y envío son SIMULADOS.

- **Regla nueva:**

  > Nunca borrar de forma definitiva ni enviar correos. Mover a la papelera solo con
  > confirmación explícita y opción de deshacer (paso 4.5). Probar solo con la cuenta de Gmail
  > del proyecto.

- **Por qué:**
  - Desde el paso 4.4 la extensión lee la bandeja con la API de Gmail.
  - El paso 4.5 propondrá liberar espacio moviendo publicidad a la papelera, que en Gmail se
    puede deshacer durante 30 días. Para eso la regla anterior, que lo hacía todo simulado,
    ya no alcanza.
  - Siguen prohibidos el borrado definitivo y el envío de correos.
- **Qué cambia en el paso 4.4:** nada se mueve ni se borra. El 4.4 es **solo lectura**: usa el
  alcance `gmail.readonly`, que no permite modificar, borrar ni enviar.

---

## 2026-11-04 · Liberar espacio y cuarentena con `gmail.modify` (paso 4.5)

- **Aplica la regla** de la entrada anterior; **no cambia** la sección "Alcance" de `CLAUDE.md`.
- **Permiso de Google:** el alcance `gmail.readonly` se cambia por **`gmail.modify`**, que incluye
  leer y además deja mover a la papelera y poner etiquetas.
  - **Nunca** se pide `https://mail.google.com/`: es el único alcance que permite borrar de forma
    definitiva.
  - `gmail.modify` sí permite enviar. Por eso la extensión solo acepta cuatro `POST` a Gmail
    (`trash`, `untrash`, `batchModify` y `labels`), y una prueba revisa todo el código.
  - El texto de los permisos sube a la **versión "3"**: "Mover correos a la papelera o a
    cuarentena solo cuando lo confirmas. Se puede deshacer. Nunca borramos de forma definitiva."
- **Papelera con `messages.trash`, no con `batchModify`:**
  - según la documentación oficial (consultada el 4 nov. 2026), `trash` "mueve el mensaje a la
    papelera" y `untrash` lo saca;
  - `batchModify` solo dice que agrega y quita etiquetas. Se usa solo para la cuarentena.
  - **Revisado otra vez tras el 429 de la prueba** (4 nov. 2026). La guía de etiquetas dice que
    `TRASH` "se puede aplicar a mano", y con `batchModify` gastaría mucho menos cuota (50
    unidades por hasta 1.000 correos, contra 20 por cada `trash`). Pero no está documentado que
    equivalga a `messages.trash`, por ejemplo en el vaciado a los 30 días. **Se mantiene `trash`
    uno por uno**, ahora con reintentos.
- **Cuota y reintentos** (corrección tras la prueba del 4.5): Gmail respondió 429 al leer 73
  correos justo después de la Bandeja, porque la cuota es de 6.000 unidades por minuto y leer un
  correo completo cuesta 60.
  - Ante 429, 5xx o 403 de límite se reintenta **hasta 5 veces** con espera exponencial y
    aleatoria (1 s a 16 s más jitter, tope 32 s; `Retry-After` si viene, hasta 60 s).
  - Se bajó a **3 pedidos a la vez**, y no se vuelve a leer lo que la Bandeja ya leyó.
  - Cada búsqueda nueva limpia el resultado anterior; Deshacer sigue disponible.
- **Cómo se eligen los correos** (decisión del equipo):
  - los **orígenes se suman (O)**: publicidad detectada, Promociones, Spam y "Todo el correo";
  - las **condiciones filtran (Y)**: antigüedad y tamaño;
  - **no se busca en todo el correo por defecto**: hay que marcar al menos un origen, y "Todo el
    correo" no viene marcado y muestra el aviso "Incluye correos personales y de trabajo:
    revisa la lista con cuidado.";
  - **exclusiones, siempre:** destacados, importantes, prioridad alta y phishing (y los que no
    se pudieron clasificar).
- **Se clasifican todos los candidatos** en lotes de 50 con `/analizar/lote`, con progreso y
  Cancelar. Esos análisis **no se registran en `/estadisticas`** (`registrar: false`), para no
  inflar los conteos.
- **Deshacer:** `untrash` de los mismos identificadores, que viven solo en la memoria del panel.
- **Cuarentena de phishing:** etiqueta "SICAE/Cuarentena" y quitar de Recibidos, con "Devolver a
  Recibidos". Nunca va a la papelera.
- **Registro en la API** (`POST /acciones`): solo fecha, acción, cantidad y MB. Sin
  identificadores de correo, remitentes ni usuario.
- **Nunca hay borrado definitivo:** SICAE-IA no vacía la papelera; Gmail lo hace solo a los 30
  días.

---

## 2026-11-04 · Pruebas de acciones solo en la cuenta y el perfil de pruebas (paso 4.5)

- **Equipo:** el equipo fue informado.
- **Dónde:** `CLAUDE.md`, sección "Alcance (no cambiar sin aprobación del equipo)".
- **Regla nueva** (se agrega; las demás del Alcance no cambian):

  > Las pruebas de acciones (papelera, cuarentena) se hacen SOLO en
  > sicae.pruebas.2026@gmail.com, en el perfil de Chrome "SICAE pruebas".

- **Por qué:** reduce el riesgo. Las acciones que mueven correos, aunque se puedan deshacer, se
  prueban en una cuenta y un perfil de Chrome **separados**, nunca en cuentas personales ni de
  trabajo. Así un error del prototipo no toca correos reales.
- **Qué implica:**
  - esa cuenta tiene que estar en la lista de **usuarios de prueba** de la pantalla de
    consentimiento OAuth en Google Cloud;
  - la extensión se carga y se prueba en el perfil "SICAE pruebas";
  - `docs/extension.md` lo dice en "Liberar espacio y cuarentena" y en los pasos de Google Cloud.

---

## 2026-11-08 · Redacción con IA: Ollama local y modo demostración con Gemini (paso 6.2)

- **Aprobada por:** el equipo.
- **Dónde:** `CLAUDE.md`, sección "Alcance (no cambiar sin aprobación del equipo)".
- **Regla nueva** (se agrega; las demás del Alcance no cambian):

  > Redacción con IA (paso 6.2): por defecto Ollama local (nada sale del equipo). Modo
  > demostración con Gemini (capa gratuita) solo para la cuenta de prueba (SICAE_DEMO_CUENTA) y
  > datos de prueba, con las direcciones de correo enmascaradas. Google puede usar y leer lo
  > enviado.

- **Proveedor por defecto: Ollama en el propio equipo** (`gemma4:e4b`).
  - Solo se acepta `http://127.0.0.1:<puerto>`, sin proxies y sin seguir redirecciones.
  - **Sin razonamiento (`"think": false`)**: en las pruebas del equipo, `gemma4:e4b` tardó
    35–73 s con razonamiento y 1,4 s sin él.
  - Según la documentación de Ollama (consultada el 8 nov. 2026), `think` y `keep_alive` existen
    en la API nativa `/api/chat`. El endpoint compatible con OpenAI no acepta `keep_alive`, así
    que **se usa la API nativa**.
  - `keep_alive` es de 10 min por defecto, para no recargar el modelo en cada borrador.
- **Modo demostración: Gemini, capa gratuita**, por su endpoint compatible con OpenAI.
  - Solo con `SICAE_DEMO_API_KEY` y solo si el `google_sub` de la sesión es `SICAE_DEMO_CUENTA`.
  - Modelo por defecto: `gemini-3.5-flash-lite`. En los modelos Gemini 3 el razonamiento no se
    puede apagar; se pide `reasoning_effort: "minimal"`.
  - Los términos de la capa gratuita (vigentes desde el 23 mar. 2026) dicen que Google usa lo
    enviado para mejorar sus productos, que *"human reviewers may read, annotate, and process
    your API input and output"* y *"Do not submit sensitive, confidential, or personal
    information"*.
  - **Por eso:** solo la cuenta y los datos de prueba; las direcciones de correo se cambian por
    `[correo]`; nunca se envían el remitente, los destinatarios ni las cabeceras; y si Ollama
    falla, nunca se pasa a Gemini solo.
- **Inyección de instrucciones:**
  - el correo va como datos entre marcas;
  - el mensaje de sistema ordena ignorar las instrucciones que vengan dentro;
  - las marcas falsas se neutralizan;
  - del borrador se quitan los enlaces que no estaban en la indicación del usuario.
- **Registro:** solo fecha, proveedor, modelo, segundos y si salió bien. Nunca la indicación, el
  correo ni el borrador. Límite de 20 borradores por usuario por hora.
- **Consentimiento:** redactar es una finalidad nueva (Ley 1581), así que `/redactar` exige el
  consentimiento **"4"**. La política sigue en la versión 3 con una sección 11 que lo anuncia;
  la política y el texto de "Revisa los permisos" suben juntos a la versión 4 en el paso 6.3.
