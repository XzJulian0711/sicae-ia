"""Prioridad de un correo legítimo por REGLAS (paso 1.6): alta, media o baja.

Se usan reglas y no un modelo porque no hay correos etiquetados con prioridad y porque la
prioridad es personal: lo importante para un usuario no lo es para otro. Las reglas,
los puntos, las palabras y los umbrales están en ml/config/prioridad.json, no en el código.
Si existe ml/config/prioridad.local.json (fuera de Git), se usa ese en lugar del otro.

Solo se aplica a correos LEGÍTIMOS: el phishing tiene su propia alerta y la publicidad
va siempre con prioridad baja (es_publicidad=True). Ver docs/metricas.md.
"""

import json
import re
import sys
from email.utils import getaddresses, parseaddr
from pathlib import Path

CARPETA_ML = Path(__file__).resolve().parents[1]
if str(CARPETA_ML) not in sys.path:
    sys.path.insert(0, str(CARPETA_ML))

from src.publicidad import normalizar_cabeceras, sin_tildes  # noqa: E402

# prioridad.json va en Git con las listas vacías. Si existe prioridad.local.json (ignorado
# por Git), se usa EN LUGAR del de Git: ahí cada usuario pone sus remitentes reales.
CARPETA_CONFIG = CARPETA_ML / "config"
NOMBRE_CONFIG = "prioridad.json"
NOMBRE_CONFIG_LOCAL = "prioridad.local.json"
RUTA_CONFIG = CARPETA_CONFIG / NOMBRE_CONFIG
RUTA_CONFIG_LOCAL = CARPETA_CONFIG / NOMBRE_CONFIG_LOCAL

PRIORIDADES = ["alta", "media", "baja"]

# Códigos de los motivos (nunca texto del correo).
REMITENTE_IMPORTANTE = "remitente_importante"  # el usuario lo marcó como importante
URGENCIA = "urgencia"  # palabras de plazo o urgencia ("vence", "mañana")
DESTINATARIO_UNICO = "destinatario_unico"  # va solo al usuario, no a un grupo
RESPUESTA = "respuesta"  # responde a un correo anterior (conversación activa)
PUBLICIDAD = "publicidad"  # la regla de publicidad lo marcó: prioridad baja siempre

CLAVES_CONFIG = {"remitentes_importantes", "dominios_importantes", "palabras_urgencia", "puntos", "umbrales"}
REGLAS = [REMITENTE_IMPORTANTE, URGENCIA, DESTINATARIO_UNICO, RESPUESTA]


def ruta_config(carpeta=CARPETA_CONFIG):
    """prioridad.local.json si existe en la carpeta; si no, prioridad.json. No se mezclan."""
    local = Path(carpeta) / NOMBRE_CONFIG_LOCAL
    return local if local.is_file() else Path(carpeta) / NOMBRE_CONFIG


def cargar_config(ruta=None, carpeta=CARPETA_CONFIG):
    """Lee la configuración de prioridad y comprueba que esté completa.

    Sin ruta, usa ruta_config(carpeta): el archivo local si existe, o el de Git.
    Remitentes y dominios quedan en minúscula; las palabras, en minúscula y sin tildes.
    """
    ruta = Path(ruta) if ruta is not None else ruta_config(carpeta)
    config = json.loads(ruta.read_text(encoding="utf-8"))
    faltan = CLAVES_CONFIG - set(config)
    assert not faltan, f"Faltan claves en {ruta}: {sorted(faltan)}"
    assert set(REGLAS) <= set(config["puntos"]), f"Faltan puntos en {ruta}: {REGLAS}"
    umbrales = config["umbrales"]
    assert {"alta", "media"} <= set(umbrales), f"Faltan umbrales en {ruta}"
    assert umbrales["alta"] > umbrales["media"] >= 1, "Debe cumplirse alta > media >= 1"
    return {
        **config,
        "remitentes_importantes": [r.strip().lower() for r in config["remitentes_importantes"]],
        "dominios_importantes": [d.strip().lower().lstrip("@") for d in config["dominios_importantes"]],
        "palabras_urgencia": [sin_tildes(p.strip()) for p in config["palabras_urgencia"]],
    }


def _es_remitente_importante(cab, config):
    """El remitente está en la lista, o su dominio (o un subdominio de él) está en la lista."""
    _, direccion = parseaddr(cab.get("from", ""))
    direccion = direccion.lower()
    if not direccion or "@" not in direccion:
        return False
    if direccion in config["remitentes_importantes"]:
        return True
    dominio = direccion.rsplit("@", 1)[1]
    return any(dominio == d or dominio.endswith("." + d) for d in config["dominios_importantes"])


def _tiene_urgencia(asunto, cuerpo, config):
    """Alguna palabra de urgencia como palabra completa ("hoy" sí, "hoyo" no)."""
    texto = re.sub(r"\s+", " ", sin_tildes(f"{asunto} {cuerpo}"))
    return any(
        re.search(r"(?<!\w)" + re.escape(palabra) + r"(?!\w)", texto)
        for palabra in config["palabras_urgencia"]
    )


def _es_destinatario_unico(cab):
    """Una sola dirección en To, sin Cc ni List-Id: el correo es para el usuario, no para un grupo."""
    destinatarios = [d for _, d in getaddresses([cab.get("to", "")]) if d]
    return len(destinatarios) == 1 and "cc" not in cab and "list-id" not in cab


def asignar_prioridad(cabeceras, asunto, cuerpo, config, es_publicidad=False):
    """Prioridad de un correo legítimo: {"prioridad", "puntaje", "motivos"}.

    Suma los puntos de config["puntos"] por cada regla que se cumple y compara con
    config["umbrales"]: puntaje >= alta -> "alta"; >= media -> "media"; si no, "baja".
    Si es_publicidad es True, la prioridad es "baja" siempre (se agrega el motivo
    "publicidad"; el puntaje y los demás motivos se dejan para ver qué se ignoró).
    """
    cab = normalizar_cabeceras(cabeceras)
    asunto = asunto if isinstance(asunto, str) else ""
    cuerpo = cuerpo if isinstance(cuerpo, str) else ""

    cumple = {
        REMITENTE_IMPORTANTE: _es_remitente_importante(cab, config),
        URGENCIA: _tiene_urgencia(asunto, cuerpo, config),
        DESTINATARIO_UNICO: _es_destinatario_unico(cab),
        RESPUESTA: "in-reply-to" in cab,
    }
    motivos = [regla for regla in REGLAS if cumple[regla]]
    puntaje = sum(config["puntos"][regla] for regla in motivos)

    umbrales = config["umbrales"]
    if es_publicidad:
        prioridad = "baja"
        motivos.append(PUBLICIDAD)
    elif puntaje >= umbrales["alta"]:
        prioridad = "alta"
    elif puntaje >= umbrales["media"]:
        prioridad = "media"
    else:
        prioridad = "baja"
    return {"prioridad": prioridad, "puntaje": puntaje, "motivos": motivos}
