"""Diagnóstico de un análisis, SOLO con números (paso 7.1, prueba funcional).

Para entender por qué el mismo correo da resultados distintos en Analizar (página de Gmail) y en
Bandeja (API de Gmail), se separa el puntaje del modelo en sus partes. El modelo v1.0 es lineal,
así que la separación es EXACTA (ver ml/sicae_ml/explicar.py):

    puntaje = base + aporte_texto + aporte_n_urls + aporte_n_adjuntos + aporte_long_cuerpo

No cambia el modelo ni las reglas: usa la misma limpieza y las mismas contribuciones que
analizar_correo(). Devuelve SOLO números: nunca palabras, el asunto, el cuerpo ni direcciones.
La API lo ofrece solo a la cuenta de prueba (SICAE_DEMO_CUENTA) y no lo registra.
"""

from sicae_ml.explicar import ESTRUCTURAL, PALABRA, contribuciones
from sicae_ml.texto import limpiar_texto

DECIMALES = 4


def diagnosticar(asunto, cuerpo, n_urls, n_adjuntos, recursos):
    """Partes del puntaje de un correo → dict de números (ver el docstring del módulo)."""
    asunto = asunto if isinstance(asunto, str) else ""
    cuerpo = cuerpo if isinstance(cuerpo, str) else ""
    # Igual que analizar_correo(): asunto + cuerpo limpios, y la longitud del cuerpo original.
    texto = limpiar_texto(f"{asunto} {cuerpo}", recursos["palabras_minuscula"])
    base, lista = contribuciones(recursos["pipeline"], texto, n_urls, n_adjuntos, len(cuerpo),
                                 recursos["promedios"])

    palabras = [item for item in lista if item["tipo"] == PALABRA]
    estructurales = {item["nombre"]: item["contribucion"] for item in lista if item["tipo"] == ESTRUCTURAL}
    aporte_texto = sum(item["contribucion"] for item in palabras)
    puntaje = base + aporte_texto + sum(estructurales.values())

    return {
        "puntaje": round(puntaje, DECIMALES),
        "base": round(base, DECIMALES),
        "aporte_texto": round(aporte_texto, DECIMALES),
        "aporte_n_urls": round(estructurales.get("n_urls", 0.0), DECIMALES),
        "aporte_n_adjuntos": round(estructurales.get("n_adjuntos", 0.0), DECIMALES),
        "aporte_long_cuerpo": round(estructurales.get("long_cuerpo", 0.0), DECIMALES),
        "n_urls": int(n_urls),
        "n_adjuntos": int(n_adjuntos),
        "long_cuerpo": len(cuerpo),
        "largo_texto_limpio": len(texto),
        "terminos": len(palabras),  # cuántos términos del vocabulario aparecen (no cuáles)
    }
