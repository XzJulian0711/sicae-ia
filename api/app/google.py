"""Verificación del token de Google (paso 4.3), solo con la librería estándar (urllib).

La extensión inicia sesión con chrome.identity y manda el token de acceso de Google en
Authorization: Bearer. Aquí se le pregunta a Google si ese token es válido (endpoint tokeninfo)
y se acepta SOLO si:
  - fue emitido para NUESTRA app: aud (y azp, si viene) == SICAE_GOOGLE_CLIENT_ID;
  - no está vencido (exp en el futuro);
  - incluye el alcance de email (userinfo.email);
  - el correo está verificado (email_verified = true);
  - trae el identificador de la cuenta (sub).

Privacidad: de la respuesta solo se devuelve `sub` (identificador numérico de la cuenta). El
correo se mira para comprobar email_verified y se descarta. Nunca se escriben en los logs el
token, el correo ni la respuesta de Google: solo el tipo de error.
"""

import json
import logging
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass

logger = logging.getLogger("sicae.api")

URL_TOKENINFO = "https://oauth2.googleapis.com/tokeninfo"
ALCANCE_EMAIL = "https://www.googleapis.com/auth/userinfo.email"
TIEMPO_ESPERA_S = 5
LARGO_MAX_SUB = 255
LARGO_MAX_TOKEN = 4096


class TokenGoogleInvalido(Exception):
    """El token no sirve: inválido, vencido, de otra app, sin email verificado… (→ 401)."""


class GoogleNoDisponible(Exception):
    """No se pudo preguntar a Google: sin red, tiempo agotado o error del servidor (→ 503)."""


@dataclass(frozen=True)
class IdentidadGoogle:
    sub: str  # identificador estable de la cuenta de Google (no es el correo)


def consultar_tokeninfo(token):
    """Pregunta a Google por el token. Devuelve el JSON de la respuesta (dict).

    El token va en el CUERPO de un POST (formulario), nunca en la URL: así no queda en logs de
    proxies ni en el historial. Lanza TokenGoogleInvalido (4xx) o GoogleNoDisponible (red, 5xx).
    """
    cuerpo = urllib.parse.urlencode({"access_token": token}).encode("ascii")
    peticion = urllib.request.Request(
        URL_TOKENINFO,
        data=cuerpo,
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(peticion, timeout=TIEMPO_ESPERA_S) as respuesta:
            return json.loads(respuesta.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        error.close()
        if 400 <= error.code < 500:
            raise TokenGoogleInvalido("Google rechazó el token.") from None
        raise GoogleNoDisponible(f"Google respondió {error.code}.") from None
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        raise GoogleNoDisponible(type(error).__name__) from None
    except (ValueError, UnicodeDecodeError):
        raise GoogleNoDisponible("Respuesta de Google ilegible.") from None


def _como_entero(valor):
    try:
        return int(valor)
    except (TypeError, ValueError):
        return None


def verificar_token_google(token, client_id, consultar=consultar_tokeninfo, ahora=time.time):
    """Devuelve IdentidadGoogle(sub) si el token cumple todo; si no, lanza TokenGoogleInvalido.

    `consultar` y `ahora` se cambian en las pruebas: así se simula Google sin red.
    """
    if not client_id:
        raise GoogleNoDisponible("Falta SICAE_GOOGLE_CLIENT_ID.")
    if not isinstance(token, str) or not token or len(token) > LARGO_MAX_TOKEN:
        raise TokenGoogleInvalido("Token vacío o demasiado largo.")

    datos = consultar(token)
    if not isinstance(datos, dict):
        raise GoogleNoDisponible("Respuesta de Google inesperada.")

    if datos.get("aud") != client_id:
        raise TokenGoogleInvalido("El token es de otra aplicación (aud).")
    if "azp" in datos and datos["azp"] != client_id:
        raise TokenGoogleInvalido("El token es de otra aplicación (azp).")

    exp = _como_entero(datos.get("exp"))
    if exp is None or exp <= ahora():
        raise TokenGoogleInvalido("El token está vencido.")
    if "expires_in" in datos:
        restante = _como_entero(datos["expires_in"])
        if restante is None or restante <= 0:
            raise TokenGoogleInvalido("El token está vencido.")

    alcances = str(datos.get("scope", "")).split()
    if ALCANCE_EMAIL not in alcances and "email" not in alcances:
        raise TokenGoogleInvalido("El token no incluye el alcance de email.")

    if datos.get("email_verified") not in (True, "true"):
        raise TokenGoogleInvalido("El correo de la cuenta no está verificado.")

    sub = datos.get("sub")
    if not isinstance(sub, str) or not 1 <= len(sub) <= LARGO_MAX_SUB:
        raise TokenGoogleInvalido("Falta el identificador de la cuenta.")
    return IdentidadGoogle(sub=sub)
