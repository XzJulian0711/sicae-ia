"""Pruebas de la seguridad de la API (paso 2.4).

Clave de API, arranque sin clave, CORS, tamaño máximo (413), límite por IP (429),
cabeceras de seguridad y /docs según el modo.
Correr desde la raíz:  .venv\\Scripts\\python -m pytest api/tests -v
"""

import pytest
from conftest import CLAVE, ORIGEN_PERMITIDO, ajustes_para
from fastapi.testclient import TestClient

from app.config import Ajustes
from app.main import crear_app
from app.seguridad import LimitePeticiones

CORREO = {
    "asunto": "Su paquete está detenido",
    "cuerpo": "Pague la tasa de envío urgente.",
    "remitente": "avisos@example.net",
    "destinatarios": ["usuario@example.org"],
    "n_urls": 1,
    "n_adjuntos": 0,
}
CABECERAS = {
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
}


@pytest.fixture
def crear_cliente(archivos_modelo, tmp_path):
    """Fábrica: cliente con ajustes cambiados. Por defecto NO envía la clave."""
    abiertos = []

    def crear(con_clave=False, reloj=None, **cambios):
        ajustes = ajustes_para(archivos_modelo, db_path=tmp_path / "sicae.db", **cambios)
        cliente = TestClient(crear_app(ajustes, reloj=reloj),
                             headers={"X-API-Key": CLAVE} if con_clave else {})
        cliente.__enter__()  # ejecuta el lifespan
        abiertos.append(cliente)
        return cliente

    yield crear
    for cliente in abiertos:
        cliente.__exit__(None, None, None)


def tiene_cabeceras_de_seguridad(respuesta):
    return all(respuesta.headers.get(nombre) == valor for nombre, valor in CABECERAS.items())


# ----- clave de API -----


def test_sin_clave_o_con_clave_mala_da_401_generico(crear_cliente):
    cliente = crear_cliente()
    sin_clave = cliente.post("/analizar", json=CORREO)
    mala = cliente.post("/analizar", json=CORREO, headers={"X-API-Key": "clave-incorrecta"})
    assert sin_clave.status_code == mala.status_code == 401
    assert sin_clave.json() == mala.json() == {"detalle": "No autorizado."}  # no dice cuál falló
    assert sin_clave.headers["www-authenticate"] == "ApiKey"


def test_con_clave_correcta_da_200(crear_cliente):
    cliente = crear_cliente()
    respuesta = cliente.post("/analizar", json=CORREO, headers={"X-API-Key": CLAVE})
    assert respuesta.status_code == 200 and respuesta.json()["categoria"] == "phishing"


def test_salud_es_publica(crear_cliente):
    assert crear_cliente().get("/salud").status_code == 200


# ----- arranque -----


def test_sin_sicae_api_key_la_app_no_arranca(archivos_modelo, tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)  # así no se lee un .env real del proyecto
    monkeypatch.delenv("SICAE_API_KEY", raising=False)
    ajustes = Ajustes(ruta_modelo=archivos_modelo / "modelo.joblib", db_path=tmp_path / "sicae.db")
    assert ajustes.api_key is None
    with pytest.raises(RuntimeError, match="Falta SICAE_API_KEY"):
        with TestClient(crear_app(ajustes)):
            pass


def test_clave_de_ejemplo_no_arranca_en_produccion(crear_cliente):
    with pytest.raises(RuntimeError, match="valor de ejemplo"):
        crear_cliente(api_key="cambia-esto", modo="produccion")
    assert crear_cliente(api_key="cambia-esto", modo="desarrollo").get("/salud").status_code == 200


def test_cors_con_asterisco_no_arranca(crear_cliente):
    with pytest.raises(RuntimeError, match="no puede ser"):
        crear_cliente(cors_origins="chrome-extension://a, *")


def test_variables_de_entorno(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("SICAE_API_KEY", "clave-secreta-de-entorno")
    monkeypatch.setenv("SICAE_CORS_ORIGINS", "chrome-extension://a , chrome-extension://b,")
    monkeypatch.setenv("SICAE_RATE_LIMIT", "7")
    monkeypatch.setenv("SICAE_DB_PATH", str(tmp_path / "otra.db"))
    ajustes = Ajustes()
    assert ajustes.origenes_cors == ["chrome-extension://a", "chrome-extension://b"]
    assert ajustes.rate_limit == 7 and ajustes.db_path == tmp_path / "otra.db"
    assert ajustes.api_key.get_secret_value() == "clave-secreta-de-entorno"
    assert "clave-secreta-de-entorno" not in repr(ajustes)  # SecretStr la oculta


# ----- CORS -----


def test_cors_solo_para_el_origen_permitido(crear_cliente):
    cliente = crear_cliente()
    previa = {"Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type,x-api-key"}

    permitida = cliente.options("/analizar", headers={"Origin": ORIGEN_PERMITIDO, **previa})
    assert permitida.headers.get("access-control-allow-origin") == ORIGEN_PERMITIDO
    assert "x-api-key" in permitida.headers.get("access-control-allow-headers", "").lower()

    otra = cliente.options("/analizar", headers={"Origin": "https://sitio-malo.example", **previa})
    assert "access-control-allow-origin" not in otra.headers

    assert cliente.get("/salud", headers={"Origin": ORIGEN_PERMITIDO}).headers.get(
        "access-control-allow-origin") == ORIGEN_PERMITIDO
    assert "access-control-allow-origin" not in cliente.get(
        "/salud", headers={"Origin": "https://sitio-malo.example"}).headers


# ----- tamaño máximo -----


def test_cuerpo_grande_da_413_sin_repetir_el_contenido(crear_cliente):
    cliente = crear_cliente(con_clave=True, max_bytes=1_000)
    respuesta = cliente.post("/analizar", json={**CORREO, "cuerpo": "SECRETOGRANDE " * 200})
    assert respuesta.status_code == 413
    assert respuesta.json() == {"detalle": "La petición es demasiado grande."}
    assert "SECRETOGRANDE" not in respuesta.text
    assert tiene_cabeceras_de_seguridad(respuesta)


def test_cuerpo_grande_por_partes_sin_content_length_da_413(crear_cliente):
    cliente = crear_cliente(con_clave=True, max_bytes=1_000)

    def partes():  # un generador: httpx lo envía por partes, sin Content-Length
        yield b'{"asunto": "x", "cuerpo": "'
        for _ in range(50):
            yield b"SECRETOGRANDE " * 10
        yield b'"}'

    respuesta = cliente.post("/analizar", content=partes(), headers={"Content-Type": "application/json"})
    assert respuesta.status_code == 413
    assert "SECRETOGRANDE" not in respuesta.text


def test_cuerpo_justo_en_el_limite_pasa(crear_cliente):
    cliente = crear_cliente(con_clave=True, max_bytes=200_000)
    assert cliente.post("/analizar", json=CORREO).status_code == 200


# ----- límite de peticiones por IP -----


def test_pasar_el_limite_da_429_con_retry_after(crear_cliente):
    ahora = [1000.0]
    cliente = crear_cliente(rate_limit=3, reloj=lambda: ahora[0])
    assert [cliente.get("/salud").status_code for _ in range(3)] == [200, 200, 200]

    ahora[0] += 20  # 20 s después: las 3 siguen dentro de la ventana de 60 s
    bloqueada = cliente.get("/salud")
    assert bloqueada.status_code == 429
    assert bloqueada.headers["retry-after"] == "40"  # la más vieja sale en 40 s
    assert "Demasiadas peticiones" in bloqueada.json()["detalle"]
    assert tiene_cabeceras_de_seguridad(bloqueada)

    ahora[0] += 41  # ya pasaron más de 60 s desde las primeras: la ventana se libera
    assert cliente.get("/salud").status_code == 200


def test_las_ips_viejas_se_borran_de_la_memoria():
    ahora = [0.0]
    limite = LimitePeticiones(app=None, por_minuto=5, reloj=lambda: ahora[0])
    for ip in ["10.0.0.1", "10.0.0.2", "10.0.0.3"]:
        limite._anotar(ip)
    assert limite.ips_en_memoria == 3

    ahora[0] = 30.0  # nadie ha salido de la ventana de 60 s: no se borra nada
    limite._anotar("10.0.0.4")
    assert limite.ips_en_memoria == 4

    ahora[0] = 61.0  # las 3 primeras ya no tienen peticiones en los últimos 60 s
    limite._anotar("10.0.0.5")
    assert set(limite.tiempos) == {"10.0.0.4", "10.0.0.5"}


def test_el_limite_cuenta_todas_las_rutas(crear_cliente):
    cliente = crear_cliente(rate_limit=2)
    cliente.get("/salud")
    cliente.post("/analizar", json=CORREO)  # 401, pero cuenta igual
    assert cliente.get("/salud").status_code == 429


# ----- cabeceras de seguridad y /docs -----


def test_cabeceras_de_seguridad_en_200_y_401(crear_cliente):
    cliente = crear_cliente()
    assert tiene_cabeceras_de_seguridad(cliente.get("/salud"))
    assert tiene_cabeceras_de_seguridad(cliente.post("/analizar", json=CORREO))  # 401


def test_docs_solo_en_modo_desarrollo(crear_cliente):
    produccion = crear_cliente(modo="produccion")
    for ruta in ["/docs", "/redoc", "/openapi.json"]:
        assert produccion.get(ruta).status_code == 404
    desarrollo = crear_cliente(modo="desarrollo")
    assert desarrollo.get("/docs").status_code == 200
    assert desarrollo.get("/openapi.json").status_code == 200
