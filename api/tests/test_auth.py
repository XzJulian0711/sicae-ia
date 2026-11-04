"""Pruebas de las sesiones de la API (paso 4.3), con Google SIMULADO (conftest.google_falso).

/auth/google, /consentimiento, /auth/cerrar, DELETE /cuenta, sesiones vencidas, y que la base
de datos y los logs no tengan correos ni tokens en claro.
Correr desde la raíz:  .venv\\Scripts\\python -m pytest api/tests -v
"""

import logging
import sqlite3
from datetime import UTC, datetime, timedelta

import pytest
from conftest import (
    CLIENT_ID,
    CORREO_GOOGLE,
    SUB,
    TOKEN_GOOGLE,
    TOKEN_GOOGLE_2,
    ajustes_para,
    crear_app_prueba,
    iniciar_sesion,
)
from fastapi.testclient import TestClient

from app import usuarios
from app.google import ALCANCE_EMAIL, GoogleNoDisponible, TokenGoogleInvalido, verificar_token_google

CORREO = {
    "asunto": "Su paquete está detenido",
    "cuerpo": "Pague la tasa de envío urgente.",
    "remitente": "avisos@example.net",
    "destinatarios": ["usuario@example.org"],
    "n_urls": 1,
    "n_adjuntos": 0,
}
INICIO = datetime(2026, 11, 5, 8, 0, tzinfo=UTC)


@pytest.fixture
def entorno(archivos_modelo, tmp_path):
    """Cliente SIN sesión, con un reloj de sesiones que la prueba puede adelantar."""
    reloj = {"ahora": INICIO}
    ajustes = ajustes_para(archivos_modelo, db_path=tmp_path / "sicae.db")
    with TestClient(crear_app_prueba(ajustes, reloj_sesiones=lambda: reloj["ahora"])) as cliente:
        yield cliente, reloj, tmp_path / "sicae.db"


def login(cliente, token=TOKEN_GOOGLE):
    return cliente.post("/auth/google", headers={"Authorization": f"Bearer {token}"})


def con(token):
    return {"Authorization": f"Bearer {token}"}


def filas(db, tabla):
    with sqlite3.connect(db) as conexion:
        return conexion.execute(f"SELECT * FROM {tabla}").fetchall()  # noqa: S608 (tabla fija)


# ----- POST /auth/google -----


def test_token_de_google_valido_crea_sesion_de_8_horas(entorno):
    cliente, _, db = entorno
    respuesta = login(cliente)
    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert set(datos) == {"token_sesion", "expira", "consentimiento_version"}
    assert len(datos["token_sesion"]) >= 43
    assert datetime.fromisoformat(datos["expira"]) == INICIO + timedelta(hours=8)
    assert datos["consentimiento_version"] is None
    assert len(filas(db, "usuarios")) == 1 and len(filas(db, "sesiones")) == 1


def test_token_de_google_invalido_o_ausente_da_401(entorno):
    cliente, _, db = entorno
    for respuesta in [login(cliente, "token-de-otra-app"), cliente.post("/auth/google"),
                      cliente.post("/auth/google", headers={"Authorization": "Basic abc"})]:
        assert respuesta.status_code == 401
        assert respuesta.json() == {"detalle": "No autorizado."}
    assert filas(db, "usuarios") == []


def test_google_caido_da_503(archivos_modelo, tmp_path):
    def google_caido(token):
        raise GoogleNoDisponible("URLError")

    ajustes = ajustes_para(archivos_modelo, db_path=tmp_path / "sicae.db")
    with TestClient(crear_app_prueba(ajustes, verificar_google=google_caido)) as cliente:
        respuesta = login(cliente)
    assert respuesta.status_code == 503
    assert "Google" in respuesta.json()["detalle"]


def test_volver_a_entrar_reusa_el_usuario_y_actualiza_el_acceso(entorno):
    cliente, reloj, db = entorno
    login(cliente)
    reloj["ahora"] = INICIO + timedelta(hours=1)
    login(cliente)
    [usuario] = filas(db, "usuarios")
    assert usuario[1] == SUB
    assert usuario[3] == (INICIO + timedelta(hours=1)).isoformat()  # ultimo_acceso
    assert len(filas(db, "sesiones")) == 2  # dos sesiones distintas, mismo usuario


# ----- consentimiento y acceso a /analizar -----


def test_sin_consentimiento_analizar_da_403_y_con_el_200(entorno):
    cliente, _, db = entorno
    token = login(cliente).json()["token_sesion"]
    assert cliente.post("/analizar", json=CORREO, headers=con(token)).status_code == 403
    assert cliente.get("/estadisticas", headers=con(token)).status_code == 200  # no procesa correos

    assert cliente.post("/consentimiento", json={"version": "1"}, headers=con(token)).status_code == 204
    assert cliente.post("/analizar", json=CORREO, headers=con(token)).status_code == 200
    usuario = filas(db, "usuarios")[0]
    assert usuario[4] == "1" and usuario[5] == INICIO.isoformat()  # versión y fecha
    # Al volver a entrar, /auth/google informa la versión aceptada.
    assert login(cliente).json()["consentimiento_version"] == "1"


def test_consentimiento_valida_la_version_y_exige_sesion(entorno):
    cliente, _, _ = entorno
    token = login(cliente).json()["token_sesion"]
    for malo in [{"version": ""}, {"version": "x" * 21}, {"version": "1; DROP"}, {}, {"version": "1", "otro": 2}]:
        assert cliente.post("/consentimiento", json=malo, headers=con(token)).status_code == 422, malo
    assert cliente.post("/consentimiento", json={"version": "1"}).status_code == 401


def test_analizar_y_estadisticas_sin_sesion_o_inventada_dan_401(entorno):
    cliente, _, _ = entorno
    for cabeceras in [{}, con("inventada"), con("x" * 5000)]:
        assert cliente.post("/analizar", json=CORREO, headers=cabeceras).status_code == 401
        assert cliente.get("/estadisticas", headers=cabeceras).status_code == 401


# ----- vencimiento, cierre y borrado -----


def test_sesion_vencida_da_401_y_se_borra(entorno):
    cliente, reloj, db = entorno
    token = iniciar_sesion(cliente)
    assert cliente.post("/analizar", json=CORREO).status_code == 200

    reloj["ahora"] = INICIO + timedelta(hours=8, seconds=1)
    respuesta = cliente.post("/analizar", json=CORREO)
    assert respuesta.status_code == 401 and respuesta.json() == {"detalle": "No autorizado."}
    assert filas(db, "sesiones") == []
    assert cliente.post("/analizar", json=CORREO, headers=con(token)).status_code == 401


def test_crear_una_sesion_borra_las_vencidas_de_todos(entorno):
    """Las sesiones vencidas se borran al crear una nueva, aunque nadie las vuelva a usar."""
    cliente, reloj, db = entorno
    vieja = login(cliente).json()["token_sesion"]  # usuario A
    assert [s[0] for s in filas(db, "sesiones")] == [usuarios.hash_token(vieja)]

    reloj["ahora"] = INICIO + timedelta(hours=8, seconds=1)  # la de A ya venció
    nueva = login(cliente, TOKEN_GOOGLE_2).json()["token_sesion"]  # usuario B: otra cuenta

    # Solo queda la de B: la de A se borró SIN haberla usado.
    assert [s[0] for s in filas(db, "sesiones")] == [usuarios.hash_token(nueva)]
    assert len(filas(db, "usuarios")) == 2  # los usuarios no se borran, solo sus sesiones vencidas


def test_una_sesion_que_no_vencio_no_se_borra_al_crear_otra(entorno):
    cliente, reloj, db = entorno
    login(cliente)
    reloj["ahora"] = INICIO + timedelta(hours=7, minutes=59)  # todavía vigente
    login(cliente, TOKEN_GOOGLE_2)
    assert len(filas(db, "sesiones")) == 2


def test_cerrar_sesion_invalida_esa_sesion(entorno):
    cliente, _, db = entorno
    token = iniciar_sesion(cliente)
    otra = login(cliente).json()["token_sesion"]  # otra sesión del mismo usuario
    assert cliente.post("/auth/cerrar", headers=con(token)).status_code == 204
    assert cliente.get("/estadisticas", headers=con(token)).status_code == 401
    assert cliente.post("/auth/cerrar", headers=con(token)).status_code == 401
    assert cliente.get("/estadisticas", headers=con(otra)).status_code == 200  # la otra sigue
    assert len(filas(db, "sesiones")) == 1


def test_borrar_cuenta_borra_el_usuario_y_todas_sus_sesiones(entorno):
    cliente, _, db = entorno
    token = iniciar_sesion(cliente)
    otra = login(cliente).json()["token_sesion"]
    cliente.post("/analizar", json=CORREO)

    assert cliente.delete("/cuenta", headers=con(token)).status_code == 204
    assert filas(db, "usuarios") == [] and filas(db, "sesiones") == []
    for sesion in (token, otra):
        assert cliente.get("/estadisticas", headers=con(sesion)).status_code == 401
    assert cliente.delete("/cuenta", headers=con(token)).status_code == 401
    # Los análisis no estaban ligados al usuario: el registro anónimo sigue.
    assert len(filas(db, "analisis")) == 1
    # Si vuelve a entrar, es un usuario nuevo y debe aceptar otra vez.
    assert login(cliente).json()["consentimiento_version"] is None


# ----- privacidad: base de datos y logs -----


def google_realista(token):
    """La verificación REAL (verificar_token_google) con un tokeninfo simulado que SÍ trae el
    correo: así se prueba que el correo de Google no llega a la base ni a los logs."""
    def tokeninfo(_token):
        if _token != TOKEN_GOOGLE:
            raise TokenGoogleInvalido("rechazado")
        return {"aud": CLIENT_ID, "azp": CLIENT_ID, "sub": SUB, "scope": f"openid {ALCANCE_EMAIL}",
                "exp": str(int(INICIO.timestamp()) + 3600), "email": CORREO_GOOGLE, "email_verified": "true"}

    return verificar_token_google(token, CLIENT_ID, consultar=tokeninfo, ahora=INICIO.timestamp)


def test_la_base_no_tiene_correos_ni_tokens_en_claro(archivos_modelo, tmp_path):
    db = tmp_path / "sicae.db"
    ajustes = ajustes_para(archivos_modelo, db_path=db)
    with TestClient(crear_app_prueba(ajustes, verificar_google=google_realista,
                                     reloj_sesiones=lambda: INICIO)) as cliente:
        token = iniciar_sesion(cliente)
        cliente.post("/analizar", json=CORREO)

    contenido = db.read_bytes()
    for secreto in [CORREO_GOOGLE, TOKEN_GOOGLE, token, "avisos@example.net", "usuario@example.org"]:
        assert secreto.encode("utf-8") not in contenido, secreto
    # Solo está el hash de la sesión (64 hex) y el identificador de la cuenta.
    [sesion] = filas(db, "sesiones")
    assert sesion[0] == usuarios.hash_token(token) and len(sesion[0]) == 64
    with sqlite3.connect(db) as conexion:
        columnas = [c[1] for c in conexion.execute("PRAGMA table_info(usuarios)")]
        columnas_analisis = [c[1] for c in conexion.execute("PRAGMA table_info(analisis)")]
    assert columnas == ["id", "google_sub", "creado", "ultimo_acceso", "consentimiento_version", "consentimiento_fecha"]
    # Los análisis NO se ligan al usuario: sin columna de usuario.
    assert columnas_analisis == ["id", "fecha", "categoria", "puntaje", "confianza", "prioridad", "version_modelo"]


def test_los_logs_no_tienen_tokens_ni_correos(archivos_modelo, tmp_path, caplog):
    def google_caido(token):
        raise GoogleNoDisponible("URLError")

    ajustes = ajustes_para(archivos_modelo, db_path=tmp_path / "sicae.db")
    with caplog.at_level(logging.DEBUG):
        with TestClient(crear_app_prueba(ajustes, verificar_google=google_realista,
                                         reloj_sesiones=lambda: INICIO)) as cliente:
            token = iniciar_sesion(cliente)
            cliente.post("/analizar", json=CORREO)
            cliente.post("/auth/cerrar")
            login(cliente, "token-malo")
        with TestClient(crear_app_prueba(ajustes, verificar_google=google_caido)) as cliente:
            login(cliente)
    for secreto in [TOKEN_GOOGLE, token, CORREO_GOOGLE, "token-malo"]:
        assert secreto not in caplog.text, secreto
    assert "No se pudo verificar con Google (GoogleNoDisponible)" in caplog.text


def test_la_sesion_dura_lo_configurado(archivos_modelo, tmp_path):
    ajustes = ajustes_para(archivos_modelo, db_path=tmp_path / "sicae.db", duracion_sesion_horas=2)
    with TestClient(crear_app_prueba(ajustes, reloj_sesiones=lambda: INICIO)) as cliente:
        expira = login(cliente).json()["expira"]
    assert datetime.fromisoformat(expira) == INICIO + timedelta(hours=2)
