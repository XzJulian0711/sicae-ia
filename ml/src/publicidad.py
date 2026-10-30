"""Detección de publicidad por REGLAS (paso 1.8). No usa el modelo de ML.

La publicidad se reconoce sobre todo por CÓMO se envió el correo (cabeceras de envío
masivo), no por lo que dice. Una regla es fiable y fácil de explicar en el documento.

En el sistema la regla se aplica SOLO a los correos que el modelo no clasificó como
phishing: el phishing imita a la publicidad ("darse de baja" sale en 187 correos de
phishing de SpaPhish y en 7 legítimos). Ver docs/metricas.md.

- analizar_publicidad(): dice si un correo es publicidad, con puntaje y motivos.
- leer_eml(): lee un archivo .eml y devuelve cabeceras, asunto y cuerpo de texto.
"""

import re
import sys
import unicodedata
from email import policy
from email.parser import BytesParser
from email.utils import parseaddr
from pathlib import Path

CARPETA_ML = Path(__file__).resolve().parents[1]
if str(CARPETA_ML) not in sys.path:
    sys.path.insert(0, str(CARPETA_ML))

from src.texto import limpiar_texto  # noqa: E402

# ---------------------------------------------------------------------------
# Señales FUERTES: una sola basta para decir "publicidad".
# Las agrega el programa de envío masivo; un correo personal o transaccional normal no
# las lleva. Un phisher también podría ponerlas, por eso en el sistema esta regla va
# DESPUÉS del modelo de phishing.
# ---------------------------------------------------------------------------

# List-Unsubscribe: enlace o dirección para darse de baja de una lista. Gmail y Yahoo lo
# exigen a los remitentes masivos desde 2024.
LIST_UNSUBSCRIBE = "list_unsubscribe"
# List-Unsubscribe-Post: baja "con un clic" (RFC 8058). Solo tiene sentido en envíos masivos.
LIST_UNSUBSCRIBE_POST = "list_unsubscribe_post"
# List-Id: identifica la lista de correo que envió el mensaje (RFC 2919).
LIST_ID = "list_id"
# Precedence: bulk / list: el servidor marca el correo como envío masivo o de lista.
PRECEDENCE_BULK = "precedence_bulk"

SENALES_FUERTES = [LIST_UNSUBSCRIBE, LIST_UNSUBSCRIBE_POST, LIST_ID, PRECEDENCE_BULK]

# ---------------------------------------------------------------------------
# Señales DÉBILES: se necesitan 2 o más TIPOS distintos.
# Cada una sola aparece también en correos que no son publicidad.
# ---------------------------------------------------------------------------

# Frases de baja o de "ver en el navegador" en el asunto o el cuerpo. Débil porque el
# phishing las copia para parecer un boletín: "darse de baja" está en 187 correos de
# phishing de SpaPhish y en 7 legítimos.
FRASE_BAJA = "frase_baja"
# Remitente tipo noreply, newsletter, marketing, promociones o info@. Débil porque los
# avisos transaccionales legítimos (recibos, cambio de contraseña) también salen de
# noreply, y el phishing usa info@ o noreply para parecer oficial.
REMITENTE_MASIVO = "remitente_masivo"
# Cabecera de una plataforma de envío masivo (Mailchimp, SendGrid, Brevo, Mailjet, Amazon
# SES). Débil porque esas plataformas también envían correos transaccionales y los
# phishers abusan de cuentas en ellas.
PLATAFORMA_MASIVA = "plataforma_masiva"

SENALES_DEBILES = [FRASE_BAJA, REMITENTE_MASIVO, PLATAFORMA_MASIVA]

PESO_FUERTE = 2
PESO_DEBIL = 1
UMBRAL = 2  # una fuerte (2) o dos débiles (1 + 1)

# Frases sin tildes y en minúscula: el texto se compara también sin tildes.
FRASES_BAJA = [
    "darse de baja", "darte de baja", "dar de baja",
    "cancelar suscripcion", "cancelar la suscripcion", "cancelar tu suscripcion",
    "anular la suscripcion",
    "unsubscribe",
    "ver este correo en el navegador", "ver en el navegador", "view in browser",
]
# Parte local del remitente (antes de @) que CONTIENE alguna de estas palabras...
REMITENTES_CONTIENE = [
    "noreply", "no-reply", "no_reply", "donotreply", "do-not-reply",
    "newsletter", "marketing", "promociones", "promo",
]
# ...o que es EXACTAMENTE una de estas ("info@", pero no "informacion@").
REMITENTES_EXACTOS = ["info"]
# X-Mailer que contiene el nombre de una plataforma de envío masivo.
MAILERS_MASIVOS = ["mailchimp", "sendgrid", "brevo", "sendinblue", "mailjet", "amazon ses"]
# Cabeceras propias de cada plataforma (basta con que existan).
CABECERAS_PLATAFORMA = [
    "x-mc-user",  # Mailchimp
    "x-sg-eid", "x-sg-id",  # SendGrid
    "x-mailin-eid", "x-sib-id", "x-mailin-campaign",  # Brevo (antes Sendinblue)
    "x-mj-mid", "x-mailjet-campaign",  # Mailjet
    "x-ses-outgoing",  # Amazon SES
]


def _sin_tildes(texto):
    """'Suscripción' -> 'suscripcion' (minúsculas, sin acentos)."""
    descompuesto = unicodedata.normalize("NFKD", texto.lower())
    return "".join(c for c in descompuesto if not unicodedata.combining(c))


def normalizar_cabeceras(cabeceras):
    """Dict {nombre en minúscula: valor como texto}. Acepta un dict o un email.message.Message.

    Si una cabecera se repite, se queda la primera.
    """
    if cabeceras is None:
        return {}
    pares = cabeceras.items()
    normalizadas = {}
    for nombre, valor in pares:
        normalizadas.setdefault(str(nombre).lower(), str(valor))
    return normalizadas


def _senales_fuertes(cab):
    motivos = []
    if "list-unsubscribe" in cab:
        motivos.append(LIST_UNSUBSCRIBE)
    if "list-unsubscribe-post" in cab:
        motivos.append(LIST_UNSUBSCRIBE_POST)
    if "list-id" in cab:
        motivos.append(LIST_ID)
    if cab.get("precedence", "").strip().lower() in ("bulk", "list"):
        motivos.append(PRECEDENCE_BULK)
    return motivos


def _tiene_frase_baja(asunto, cuerpo):
    texto = _sin_tildes(f"{asunto} {cuerpo}")
    texto = re.sub(r"\s+", " ", texto)
    return any(frase in texto for frase in FRASES_BAJA)


def _es_remitente_masivo(cab):
    _, direccion = parseaddr(cab.get("from", ""))
    local = direccion.split("@")[0].lower() if "@" in direccion else ""
    if not local:
        return False
    return local in REMITENTES_EXACTOS or any(p in local for p in REMITENTES_CONTIENE)


def _es_plataforma_masiva(cab):
    mailer = cab.get("x-mailer", "").lower()
    if any(nombre in mailer for nombre in MAILERS_MASIVOS):
        return True
    if any(nombre in cab for nombre in CABECERAS_PLATAFORMA):
        return True
    # Amazon SES deja "amazonses" en Feedback-ID o en el Message-ID.
    return "amazonses" in cab.get("feedback-id", "").lower() or (
        "amazonses" in cab.get("message-id", "").lower()
    )


def analizar_publicidad(cabeceras, asunto, cuerpo):
    """Dice si un correo es publicidad según las señales de envío masivo.

    Devuelve {"es_publicidad": bool, "puntaje": int, "motivos": [códigos]}.
    - Cada señal fuerte suma PESO_FUERTE (2); una sola basta.
    - Cada TIPO de señal débil suma PESO_DEBIL (1); se necesitan 2 o más.
    Los motivos son códigos (por ejemplo "list_unsubscribe"), nunca texto del correo.
    """
    cab = normalizar_cabeceras(cabeceras)
    asunto = asunto if isinstance(asunto, str) else ""
    cuerpo = cuerpo if isinstance(cuerpo, str) else ""

    fuertes = _senales_fuertes(cab)
    debiles = []
    if _tiene_frase_baja(asunto, cuerpo):
        debiles.append(FRASE_BAJA)
    if _es_remitente_masivo(cab):
        debiles.append(REMITENTE_MASIVO)
    if _es_plataforma_masiva(cab):
        debiles.append(PLATAFORMA_MASIVA)

    puntaje = PESO_FUERTE * len(fuertes) + PESO_DEBIL * len(debiles)
    es_publicidad = len(fuertes) >= 1 or len(debiles) >= 2
    return {"es_publicidad": es_publicidad, "puntaje": puntaje, "motivos": fuertes + debiles}


# ---------------------------------------------------------------------------
# Lectura de archivos .eml
# ---------------------------------------------------------------------------


def _texto_de_parte(parte):
    """Contenido de una parte de texto. Si el charset falla, decodifica a mano."""
    try:
        return parte.get_content()
    except (LookupError, UnicodeDecodeError):
        datos = parte.get_payload(decode=True) or b""
        return datos.decode(parte.get_content_charset() or "utf-8", errors="replace")


def leer_eml(ruta):
    """Lee un archivo .eml con la librería email de Python.

    Devuelve (cabeceras, asunto, cuerpo):
    - cabeceras: dict {nombre en minúscula: valor} (la primera si se repite).
    - asunto: texto del Subject ("" si no hay).
    - cuerpo: la parte de texto plano. Si solo hay HTML, se limpia con limpiar_texto()
      (quita etiquetas, pasa a minúsculas). Si no hay texto, "".
    """
    with open(ruta, "rb") as archivo:
        mensaje = BytesParser(policy=policy.default).parse(archivo)

    cabeceras = normalizar_cabeceras(mensaje)
    asunto = str(mensaje.get("subject", "") or "")

    parte = mensaje.get_body(preferencelist=("plain",))
    if parte is not None:
        cuerpo = _texto_de_parte(parte)
    else:
        parte = mensaje.get_body(preferencelist=("html",))
        cuerpo = limpiar_texto(_texto_de_parte(parte)) if parte is not None else ""
    return cabeceras, asunto, cuerpo
