# Política de privacidad de SICAE-IA

- **Versión:** 3 (la misma del consentimiento que aceptas en "Revisa los permisos")
- **Vigente desde:** 4 de noviembre de 2026
- **Normas:** Ley 1581 de 2012 y Decreto 1377 de 2013 (protección de datos personales en
  Colombia).

SICAE-IA es un **prototipo académico**: una extensión de Chrome y una API que clasifican correos
de Gmail en legítimo, publicidad o posible phishing. Esta política describe **solo lo que el
sistema hace hoy**. Si algo cambia en lo que se pide, cambia la versión y el panel vuelve a
pedir tu consentimiento.

## 1. Responsable

- **Quiénes:** el equipo del proyecto de grado de Ingeniería de Sistemas de la **Fundación
  Universitaria Los Libertadores**:
  - Julian Camilo Cárdenas Torres;
  - Juan Sebastián Vásquez Peña;
  - Stephanie Murillo Urrego;
  - Mateo Enrique Bermejo Ramírez.
- **Correo de contacto:** sicae.pruebas.2026@gmail.com (la cuenta del proyecto).
- **Domicilio, dirección y teléfono:** Pendiente: lo completa el equipo.
- **Quién atiende peticiones, consultas y reclamos:** el equipo del proyecto, en ese correo.

## 2. Qué datos se tratan y para qué

| Dato | Para qué | Dónde queda |
|---|---|---|
| **Identificador de tu cuenta de Google** (`sub`, un número; **no** es tu correo) | Reconocerte cuando inicias sesión | Base de la API (tabla `usuarios`) |
| **Fecha de creación y del último acceso** | Saber cuándo se creó tu usuario y cuándo lo usaste por última vez | Base de la API (`usuarios`) |
| **Versión y fecha del consentimiento** | Saber qué texto aceptaste y cuándo (es la prueba de tu autorización) | Base de la API (`usuarios`) y tu navegador |
| **Tu correo electrónico** | Mostrarlo en el encabezado del panel | **No se guarda**: se pide a Google cada vez |
| **El contenido de tus correos** (asunto, cuerpo, remitente, destinatarios, enlaces, cantidad de adjuntos y algunas cabeceras) | Clasificarlos | **Solo en memoria**, mientras se analizan. No se guarda |
| **Registros anónimos de análisis**: fecha, categoría, puntaje, confianza, prioridad y versión del modelo | Estadísticas y resultados de la tesis | Base de la API (`analisis`), **sin** usuario ni texto |
| **Registros anónimos de acciones**: fecha, acción (papelera, deshacer, cuarentena, devolver), cantidad y MB | Estadísticas y resultados de la tesis | Base de la API (`acciones`), **sin** usuario ni identificadores de correo |

Además, para funcionar:
- **la sesión con la API** se guarda en la API **solo como hash** (SHA-256) y vence a las 8 h. En
  tu navegador, el token de esa sesión vive en la **memoria** de Chrome
  (`chrome.storage.session`) mientras el navegador está abierto, y se borra al cerrarlo;
- **en tu navegador** también quedan la dirección de la API y el consentimiento aceptado
  (`chrome.storage.local`);
- **la dirección IP** de cada petición se recuerda **en memoria** durante 1 minuto para el límite
  de peticiones por minuto. Como la API corre en tu equipo, es la dirección local (127.0.0.1).
  No se guarda en la base.

## 3. Qué NO se guarda

- El texto de los correos, el asunto, el remitente, los destinatarios, los enlaces ni las
  cabeceras.
- Tu correo electrónico ni tu nombre.
- El token de Google: lo administra Chrome, no SICAE-IA.
- El token de sesión en claro: la API guarda solo su hash.
- Un hash del contenido de los correos ni los motivos de cada clasificación.
- Los identificadores de los correos que mueves: los que se usan para "Deshacer" viven solo en
  la memoria del panel y se pierden al cerrarlo.

Los registros de errores de la API dicen solo el tipo de error, sin contenido. La consola de la
API muestra la dirección local, el método y la ruta de cada petición (por ejemplo
`POST /analizar`), y no se escribe en ningún archivo.

## 4. Dónde se procesa

- **En tu equipo.** La extensión solo se comunica con la API en `http://127.0.0.1:8000`, es
  decir, en el mismo computador. Allí corren el modelo de clasificación y la base de datos
  (`api/data/sicae.db`).
- **Google**, solo para:
  - iniciar sesión (ventana oficial de Google) y verificarla (`tokeninfo`): de la respuesta se
    usa solo el identificador; el correo se descarta;
  - mostrar tu correo en el panel (`userinfo`);
  - leer y mover tus correos con la API de Gmail;
  - revocar el acceso cuando cierras sesión.
- **No se envía nada a servicios de inteligencia artificial externos.** El modelo es propio y
  corre en la API local. Con esta versión (3) la redacción con IA no está disponible; el modo
  demostración de la sección 11 pedirá aceptar la versión 4.
- El archivo del modelo se descarga **una vez** desde las publicaciones (Releases) del
  repositorio en GitHub, sin enviar datos tuyos.

## 5. Permisos de Google y para qué sirve cada uno

| Permiso | Para qué |
|---|---|
| `openid` y `userinfo.email` | Saber quién eres al iniciar sesión y mostrar tu correo en el panel |
| `gmail.modify` | Leer tus correos para clasificarlos (Bandeja y Liberar espacio), moverlos a la papelera o sacarlos de ella, y poner o quitar la etiqueta de cuarentena |

Google describe `gmail.modify` como «leer, redactar y enviar». Es el permiso más pequeño que
existe para mover a la papelera. **SICAE-IA nunca envía correos ni los borra de forma
definitiva**: el código solo permite mover a la papelera, sacar de ella y cambiar etiquetas, y
las pruebas del proyecto lo revisan.

## 6. Acciones sobre tu correo

- Solo se hacen **cuando tú lo confirmas**.
- **Mover a la papelera:** se puede **deshacer** desde el panel o desde la Papelera de Gmail
  durante 30 días. Después, Gmail la vacía sola; SICAE-IA nunca la vacía.
- **Cuarentena** (correos con posible phishing): solo pone la etiqueta "SICAE/Cuarentena" y lo
  quita de Recibidos. Se deshace con "Devolver a Recibidos" o quitando la etiqueta en Gmail.
- **Nunca** hay borrado definitivo ni envío de correos.
- De cada acción se registra solo la fecha, el tipo de acción, la cantidad y los MB.

## 7. Tus derechos y cómo ejercerlos

Según el artículo 8 de la Ley 1581 de 2012, tienes derecho a:
- **conocer, actualizar y rectificar** tus datos;
- **pedir la prueba de la autorización** que diste;
- **ser informado** del uso que se les da;
- **revocar la autorización** o **pedir que se supriman** tus datos;
- **acceder gratis** a tus datos;
- **presentar quejas** ante la Superintendencia de Industria y Comercio (SIC).

**Cómo ejercerlos:**
- **Suprimir tus datos y revocar la autorización:** en las Opciones de la extensión, pulsa
  **"Retirar consentimiento"**. En este orden:
  1. borra tu usuario y todas tus sesiones en la API (`DELETE /cuenta`);
  2. borra la sesión y el consentimiento guardados en tu navegador;
  3. **revoca el acceso de SICAE-IA a tu cuenta de Google**: quita el token de la caché de
     Chrome y le pide a Google que lo revoque, igual que "Cerrar sesión".

  Si la API está apagada, igual hace los pasos 2 y 3, y el mensaje te dice que vuelvas a
  intentarlo para borrar tu cuenta. Si Google no confirma la revocación, el mensaje te pide
  quitar el acceso a mano en
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
- **Quitar solo el acceso de Google, sin borrar tu cuenta:** pulsa **"Cerrar sesión"** o entra a
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions) y quita
  SICAE-IA.
- **Conocer, actualizar o rectificar tus datos, o pedir la prueba de tu autorización:** escribe a
  sicae.pruebas.2026@gmail.com.
  - Hoy no hay una pantalla para ver tus datos. Los que existen son los de la tabla de la
    sección 2: un identificador y fechas que genera el sistema.
- **Plazos** (Ley 1581):
  - **consultas:** se responden en máximo **10 días hábiles** (prorrogables 5 más, avisando el
    motivo), según el artículo 14;
  - **reclamos:** se resuelven en máximo **15 días hábiles** (prorrogables 8 más, avisando el
    motivo), según el artículo 15.

**Sobre los registros anónimos:** los registros de análisis y de acciones no tienen usuario ni
contenido, así que no se pueden asociar a ti. Por eso no se borran al retirar el consentimiento.

## 8. Conservación (período de vigencia de la base de datos)

| Datos | Cuánto tiempo |
|---|---|
| **Sesiones** | 8 horas. Las vencidas se borran solas, al usarlas y cada vez que se abre una sesión nueva |
| **Datos del usuario** (identificador de Google, fechas, consentimiento) | Hasta que retires el consentimiento o hasta el fin del proyecto de grado, **lo que ocurra primero** |
| **Registros de análisis, de acciones y de borradores con IA** (anónimos, sin texto; los de borradores, desde la sección 11) | Hasta el fin del proyecto, porque se usan para los resultados de la tesis |

**Al terminar el proyecto, el equipo borra el archivo `api/data/sicae.db`** en cada equipo donde
se haya usado. Esto es **un compromiso del equipo, no algo automático del código**: el sistema
solo borra solas las sesiones vencidas.

## 9. Seguridad

- Los tokens de sesión se guardan solo como hash. El token de Google nunca se guarda en la
  extensión ni en la API.
- Los tokens van en la cabecera `Authorization`, nunca en la dirección (URL).
- Desde el navegador, solo la extensión puede llamar a la API: ninguna otra página web (CORS
  cerrado). La API también limita las peticiones por minuto y pide una sesión válida.
- Los registros de errores no tienen contenido de correos, correos electrónicos ni tokens.
- La base de datos no se sube al repositorio (está en `.gitignore`).
- La extensión no carga código de internet.

## 10. Prototipo académico en modo de prueba

- SICAE-IA es un **prototipo de un proyecto de grado**, no un servicio público.
- La pantalla de consentimiento de Google está en **modo de prueba**: solo pueden entrar las
  cuentas que el equipo agregó como usuarios de prueba.
- Las acciones que mueven correos se prueban solo en la cuenta de pruebas del proyecto.
- Esta es la **versión 3**, vigente desde el 4 de noviembre de 2026. Si cambia lo que se pide, se
  publica una versión nueva y el panel vuelve a pedir el consentimiento.

## 11. Redacción con IA (todavía no disponible en la extensión)

La API ya puede proponer un **borrador de respuesta** (`POST /redactar`, paso 6.2), pero la
extensión todavía no lo usa. **Para usarlo habrá que aceptar la versión 4** de esta política y
de "Revisa los permisos" (paso 6.3): la API lo rechaza con cualquier versión anterior, porque
redactar es una finalidad nueva.

**Qué recibe la IA:** tu indicación (lo que quieres decir, máximo 500 caracteres), el tono, el
asunto y el inicio del cuerpo del correo que respondes (por defecto, hasta 4.000 caracteres).
**Nunca** el remitente, los destinatarios ni las cabeceras.

**Dónde se procesa:**
- **Por defecto, en tu equipo, con Ollama.** La API solo acepta Ollama en `127.0.0.1`, sin
  proxies: **nada sale de tu computador.**
- **Modo demostración (Gemini, de Google), solo para la cuenta de prueba del proyecto.** Se usa
  únicamente si se pide expresamente y si la sesión es de esa cuenta (sicae.pruebas.2026@gmail.com);
  con cualquier otra cuenta se rechaza. Si Ollama falla, **nunca** se pasa a Gemini solo.
  - **Qué se envía a Google:** la indicación, el tono, el asunto y el inicio del cuerpo, con
    **cada dirección de correo cambiada por `[correo]`**.
  - **Lo que dicen los términos de Google** para la capa gratuita (vigentes desde el 23 de marzo
    de 2026): Google **usa lo enviado y lo generado para mejorar sus productos**, y **personas
    pueden leerlo, anotarlo y procesarlo**. Google pide no enviar información sensible,
    confidencial ni personal. Por eso este modo es **solo para datos de prueba**.

**Qué se registra:** solo la fecha, el proveedor (`ollama` o `demostracion`), el modelo, los
segundos que tardó y si salió bien. **Nunca** tu indicación, el correo ni el borrador, ni quién
lo pidió.

**Límite:** 20 borradores por persona por hora.

**El borrador es solo una propuesta:** SICAE-IA no envía correos. De él se quitan los enlaces que
no estaban en tu indicación, y lo que diga el correo recibido se trata como datos, no como
instrucciones para la IA.
