"""Orquestador: analiza un correo de punta a punta (paso 1.7).

Flujo de analizar_correo():
  1. Limpia asunto + cuerpo con limpiar_texto() y la lista palabras_minuscula del modelo.
  2. El modelo v1.0 da el puntaje, la clase y los motivos (explicar.py).
     Confianza "dudosa" si |puntaje| < umbral de ml/reports/umbral_confianza.json.
  3. Phishing -> categoría phishing, sin prioridad (el phishing va como alerta).
  4. Si no -> regla de publicidad; y luego la prioridad (publicidad = baja siempre).

PRIVACIDAD: el resultado nunca incluye el texto, el asunto ni las direcciones del correo.
Los motivos de palabra solo nombran términos del vocabulario del modelo («paquete»).
Este módulo no guarda nada en disco.
"""

import json
import sys
from functools import lru_cache
from pathlib import Path

CARPETA_ML = Path(__file__).resolve().parents[1]
if str(CARPETA_ML) not in sys.path:
    sys.path.insert(0, str(CARPETA_ML))

from src.calibrar import RUTA_PROMEDIOS, RUTA_UMBRAL  # noqa: E402
from src.explicar import explicar  # noqa: E402
from src.priority import (  # noqa: E402
    DESTINATARIO_UNICO,
    PUBLICIDAD,
    REMITENTE_IMPORTANTE,
    RESPUESTA,
    URGENCIA,
    asignar_prioridad,
    cargar_config,
)
from src.publicidad import (  # noqa: E402
    FRASE_BAJA,
    LIST_ID,
    LIST_UNSUBSCRIBE,
    LIST_UNSUBSCRIBE_POST,
    PLATAFORMA_MASIVA,
    PRECEDENCE_BULK,
    REMITENTE_MASIVO,
    analizar_publicidad,
)
from src.texto import limpiar_texto  # noqa: E402
from src.train import RUTA_MODELO, cargar_modelo  # noqa: E402

# Etiquetas en español para los códigos de las reglas (los del modelo traen la suya).
ETIQUETAS_PUBLICIDAD = {
    LIST_UNSUBSCRIBE: "Trae enlace para darse de baja (List-Unsubscribe)",
    LIST_UNSUBSCRIBE_POST: "Permite darse de baja con un clic",
    LIST_ID: "Viene de una lista de correo",
    PRECEDENCE_BULK: "Marcado como envío masivo",
    FRASE_BAJA: "Ofrece darse de baja o ver el correo en el navegador",
    REMITENTE_MASIVO: "Remitente de envíos automáticos (noreply, newsletter, info…)",
    PLATAFORMA_MASIVA: "Enviado con una plataforma de correo masivo",
}
ETIQUETAS_PRIORIDAD = {
    REMITENTE_IMPORTANTE: "Remitente marcado como importante",
    URGENCIA: "Menciona un plazo o urgencia",
    DESTINATARIO_UNICO: "Dirigido solo a ti",
    RESPUESTA: "Responde a un correo anterior",
    PUBLICIDAD: "Es un envío masivo: prioridad baja",
}


@lru_cache(maxsize=4)
def cargar_recursos(ruta_modelo=RUTA_MODELO, ruta_umbral=RUTA_UMBRAL, ruta_promedios=RUTA_PROMEDIOS):
    """Modelo, palabras_minuscula, versión, umbral de confianza y promedios estructurales.

    Se cargan una sola vez (caché). Falla con un mensaje claro si falta algún archivo.
    """
    for ruta in (ruta_umbral, ruta_promedios):
        if not Path(ruta).is_file():
            raise FileNotFoundError(f"Falta {ruta}: corra primero  python ml/src/calibrar.py")
    guardado = cargar_modelo(ruta_modelo)
    umbral = json.loads(Path(ruta_umbral).read_text(encoding="utf-8"))
    promedios = json.loads(Path(ruta_promedios).read_text(encoding="utf-8"))
    for nombre, datos in (("umbral", umbral), ("promedios", promedios)):
        assert datos["version_modelo"] == guardado["version"], (
            f"El archivo de {nombre} es de otra versión del modelo: corra calibrar.py"
        )
    return {
        "pipeline": guardado["pipeline"],
        "palabras_minuscula": guardado["palabras_minuscula"],
        "version": guardado["version"],
        "umbral": float(umbral["umbral"]),
        "promedios": promedios["promedios"],
    }


def _motivo(codigo, etiqueta, origen):
    return {"codigo": codigo, "etiqueta": etiqueta, "origen": origen}


def analizar_correo(cabeceras, asunto, cuerpo, n_urls, n_adjuntos, config_prioridad=None, recursos=None):
    """Categoría, confianza, puntaje, prioridad y motivos de un correo.

    cabeceras: dict o email.message.Message. config_prioridad: salida de
    priority.cargar_config() (si es None se carga la del proyecto). recursos: salida de
    cargar_recursos() (si es None se cargan los reales; las pruebas pasan unos inventados).

    Devuelve {"categoria", "confianza", "puntaje", "prioridad", "motivos", "version"}.
    "prioridad" es None si el correo es phishing.
    """
    recursos = recursos or cargar_recursos()
    asunto = asunto if isinstance(asunto, str) else ""
    cuerpo = cuerpo if isinstance(cuerpo, str) else ""

    # 1. Igual que en el entrenamiento: asunto + cuerpo, y la longitud del cuerpo original.
    texto = limpiar_texto(f"{asunto} {cuerpo}", recursos["palabras_minuscula"])
    explicacion = explicar(recursos["pipeline"], texto, n_urls, n_adjuntos, len(cuerpo),
                           promedios=recursos["promedios"])

    # 2. Confianza: cerca de 0 el modelo se equivoca mucho más (ver calibrar.py).
    confianza = "dudosa" if abs(explicacion["puntaje"]) < recursos["umbral"] else "alta"
    motivos = [_motivo(m["codigo"], m["etiqueta"], "modelo") for m in explicacion["motivos"]]

    # 3. Phishing: alerta, sin prioridad.
    if explicacion["clase"] == "phishing":
        categoria, prioridad = "phishing", None
    else:
        # 4. Legítimo para el modelo -> regla de publicidad -> prioridad.
        publicidad = analizar_publicidad(cabeceras, asunto, cuerpo)
        categoria = "publicidad" if publicidad["es_publicidad"] else "legitimo"
        motivos += [_motivo(c, ETIQUETAS_PUBLICIDAD[c], "publicidad") for c in publicidad["motivos"]]
        config = config_prioridad or cargar_config()
        resultado = asignar_prioridad(cabeceras, asunto, cuerpo, config, publicidad["es_publicidad"])
        prioridad = resultado["prioridad"]
        motivos += [_motivo(c, ETIQUETAS_PRIORIDAD[c], "prioridad") for c in resultado["motivos"]]

    return {
        "categoria": categoria,
        "confianza": confianza,
        "puntaje": explicacion["puntaje"],
        "prioridad": prioridad,
        "motivos": motivos,
        "version": recursos["version"],
    }
