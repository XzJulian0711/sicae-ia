"""Pruebas de la verificación del token de Google (paso 4.3), con Google SIMULADO (sin red).

verificar_token_google recibe `consultar` (lo que respondería tokeninfo) y `ahora`: así se prueba
cada regla sin hablar con Google. consultar_tokeninfo se prueba cambiando urllib.request.urlopen.
Correr desde la raíz:  .venv\\Scripts\\python -m pytest api/tests -v
"""

import io
import json
import urllib.error
import urllib.parse

import pytest

from app import google
from app.google import (
    ALCANCE_EMAIL,
    URL_TOKENINFO,
    GoogleNoDisponible,
    IdentidadGoogle,
    TokenGoogleInvalido,
    consultar_tokeninfo,
    verificar_token_google,
)

CLIENT_ID = "123456-prueba.apps.googleusercontent.com"
AHORA = 1_800_000_000  # segundos (reloj fijo)
TOKEN = "ya29.token-inventado"


def respuesta_valida(**cambios):
    """Lo que responde tokeninfo para un token bueno de nuestra app (inventado)."""
    datos = {
        "azp": CLIENT_ID,
        "aud": CLIENT_ID,
        "sub": "100000000000000000001",
        "scope": f"openid {ALCANCE_EMAIL}",
        "exp": str(AHORA + 3000),
        "expires_in": "3000",
        "email": "persona.de.prueba@example.org",
        "email_verified": "true",
        "access_type": "online",
    }
    datos.update(cambios)
    return {k: v for k, v in datos.items() if v is not None}


def verificar(datos):
    return verificar_token_google(TOKEN, CLIENT_ID, consultar=lambda token: datos, ahora=lambda: AHORA)


def test_token_valido_devuelve_solo_el_sub():
    identidad = verificar(respuesta_valida())
    assert identidad == IdentidadGoogle(sub="100000000000000000001")
    assert not hasattr(identidad, "email")  # el correo se descarta


@pytest.mark.parametrize("cambios, motivo", [
    ({"aud": "999-otra-app.apps.googleusercontent.com"}, "aud de otra app"),
    ({"azp": "999-otra-app.apps.googleusercontent.com"}, "azp de otra app"),
    ({"aud": None}, "sin aud"),
    ({"exp": str(AHORA - 1)}, "vencido"),
    ({"exp": str(AHORA)}, "vence justo ahora"),
    ({"exp": None}, "sin exp"),
    ({"exp": "mañana"}, "exp raro"),
    ({"expires_in": "0"}, "expires_in en 0"),
    ({"scope": "openid"}, "sin alcance de email"),
    ({"scope": None}, "sin scope"),
    ({"email_verified": "false"}, "email sin verificar"),
    ({"email_verified": False}, "email sin verificar (booleano)"),
    ({"email_verified": None}, "sin email_verified"),
    ({"sub": None}, "sin sub"),
    ({"sub": ""}, "sub vacío"),
    ({"sub": "x" * 256}, "sub demasiado largo"),
])
def test_tokens_que_no_cumplen_se_rechazan(cambios, motivo):
    with pytest.raises(TokenGoogleInvalido):
        verificar(respuesta_valida(**cambios))


def test_acepta_email_verified_booleano_y_alcance_corto():
    assert verificar(respuesta_valida(email_verified=True, scope="openid email")).sub


def test_token_vacio_o_enorme_no_se_consulta():
    consultas = []
    for token in ["", None, "x" * 5000]:
        with pytest.raises(TokenGoogleInvalido):
            verificar_token_google(token, CLIENT_ID, consultar=consultas.append, ahora=lambda: AHORA)
    assert consultas == []


def test_sin_client_id_configurado():
    with pytest.raises(GoogleNoDisponible):
        verificar_token_google(TOKEN, "", consultar=lambda t: respuesta_valida(), ahora=lambda: AHORA)


def test_google_caido_se_propaga():
    def caido(token):
        raise GoogleNoDisponible("URLError")

    with pytest.raises(GoogleNoDisponible):
        verificar_token_google(TOKEN, CLIENT_ID, consultar=caido, ahora=lambda: AHORA)


# ----- consultar_tokeninfo: la petición HTTP real, con urlopen simulado -----


class RespuestaFalsa(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()


def test_consultar_manda_el_token_en_el_cuerpo_de_un_post(monkeypatch):
    vistas = []

    def urlopen_falso(peticion, timeout):
        vistas.append((peticion, timeout))
        return RespuestaFalsa(json.dumps(respuesta_valida()).encode("utf-8"))

    monkeypatch.setattr(google.urllib.request, "urlopen", urlopen_falso)
    assert consultar_tokeninfo(TOKEN)["aud"] == CLIENT_ID

    peticion, timeout = vistas[0]
    assert peticion.full_url == URL_TOKENINFO  # la URL no lleva el token
    assert TOKEN not in peticion.full_url
    assert peticion.get_method() == "POST"
    assert urllib.parse.parse_qs(peticion.data.decode("ascii")) == {"access_token": [TOKEN]}
    assert timeout == google.TIEMPO_ESPERA_S


@pytest.mark.parametrize("error, esperado", [
    (urllib.error.HTTPError(URL_TOKENINFO, 400, "Bad Request", {}, io.BytesIO(b"{}")), TokenGoogleInvalido),
    (urllib.error.HTTPError(URL_TOKENINFO, 503, "Unavailable", {}, io.BytesIO(b"{}")), GoogleNoDisponible),
    (urllib.error.URLError("sin red"), GoogleNoDisponible),
    (TimeoutError(), GoogleNoDisponible),
])
def test_consultar_traduce_los_errores(monkeypatch, error, esperado):
    def urlopen_que_falla(peticion, timeout):
        raise error

    monkeypatch.setattr(google.urllib.request, "urlopen", urlopen_que_falla)
    with pytest.raises(esperado) as info:
        consultar_tokeninfo(TOKEN)
    assert TOKEN not in str(info.value)  # el mensaje no repite el token


def test_consultar_con_respuesta_ilegible(monkeypatch):
    monkeypatch.setattr(google.urllib.request, "urlopen", lambda peticion, timeout: RespuestaFalsa(b"<html>"))
    with pytest.raises(GoogleNoDisponible):
        consultar_tokeninfo(TOKEN)
