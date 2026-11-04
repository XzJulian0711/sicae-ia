"""Pruebas de POST /analizar/lote (paso 4.4, pestaña Bandeja), con modelo y Google inventados.

Correr desde la raíz:  .venv\\Scripts\\python -m pytest api/tests -v
"""

import logging
import sqlite3

import pytest
from conftest import LEGITIMO, PHISHING, ajustes_para, crear_app_prueba, iniciar_sesion
from fastapi.testclient import TestClient

from app import main as modulo_main

MARCA = "ZQXJ7LOTE"  # texto único: no debe aparecer en la base ni en los logs


def correo(texto, **cambios):
    """Correo inventado. Los legítimos llevan 1 adjunto, como los del modelo de prueba
    (conftest: legítimo = 1 adjunto, phishing = 0), para que el modelo inventado los reconozca."""
    legitimo = texto in LEGITIMO
    base = {
        "asunto": f"Acta de la reunión {MARCA}" if legitimo else f"Su paquete está detenido {MARCA}",
        "cuerpo": f"{texto}. {MARCA}",
        "remitente": "persona@uni.example.edu",
        "destinatarios": ["yo@example.org"],
        "cabeceras": {},
        "n_urls": 1,
        "n_adjuntos": 1 if legitimo else 0,
    }
    return {**base, **cambios}


@pytest.fixture
def crear(archivos_modelo, tmp_path):
    """Fábrica de clientes con sesión y consentimiento, con ajustes cambiados."""
    abiertos = []

    def fabricar(con_sesion=True, consentimiento=True, **cambios):
        ajustes = ajustes_para(archivos_modelo, db_path=tmp_path / "sicae.db", **cambios)
        cliente = TestClient(crear_app_prueba(ajustes))
        cliente.__enter__()
        abiertos.append(cliente)
        if con_sesion:
            iniciar_sesion(cliente, consentimiento=consentimiento)
        return cliente

    yield fabricar
    for cliente in abiertos:
        cliente.__exit__(None, None, None)


def test_lote_devuelve_un_resultado_por_correo_en_el_mismo_orden(crear):
    cliente = crear()
    correos = [correo(PHISHING[0]), correo(LEGITIMO[0]), correo(PHISHING[1])]
    respuesta = cliente.post("/analizar/lote", json={"correos": correos})
    assert respuesta.status_code == 200
    resultados = respuesta.json()["resultados"]
    assert [r["categoria"] for r in resultados] == ["phishing", "legitimo", "phishing"]
    # Mismo resultado que /analizar con cada correo por separado.
    assert cliente.post("/analizar", json=correos[1]).json() == resultados[1]


def test_las_cabeceras_ahora_cuentan_publicidad_y_respuesta(crear):
    cliente = crear()
    sin = correo(LEGITIMO[1])
    con_baja = correo(LEGITIMO[1], cabeceras={"List-Unsubscribe": "<mailto:baja@example.net>"})
    respuesta = correo(LEGITIMO[1], cabeceras={"In-Reply-To": "<id-anterior@example.org>"})
    resultados = cliente.post("/analizar/lote", json={"correos": [sin, con_baja, respuesta]}).json()["resultados"]
    assert resultados[0]["categoria"] == "legitimo"
    assert resultados[1]["categoria"] == "publicidad"
    assert "list_unsubscribe" in [m["codigo"] for m in resultados[1]["motivos"]]
    assert "respuesta" in [m["codigo"] for m in resultados[2]["motivos"]]


def test_limites_del_lote(crear):
    cliente = crear()
    assert cliente.post("/analizar/lote", json={"correos": []}).status_code == 422
    assert cliente.post("/analizar/lote", json={"correos": [correo(LEGITIMO[0])] * 51}).status_code == 422
    assert cliente.post("/analizar/lote", json={"correos": [correo(LEGITIMO[0])] * 50}).status_code == 200
    assert cliente.post("/analizar/lote", json={"correos": [correo(LEGITIMO[0])], "otro": 1}).status_code == 422
    # Cada correo tiene los mismos límites que /analizar.
    largo = correo(LEGITIMO[0], asunto="x" * 1001)
    assert cliente.post("/analizar/lote", json={"correos": [largo]}).status_code == 422


def test_el_tope_de_lote_se_puede_configurar(crear):
    cliente = crear(max_lote=3)
    assert cliente.post("/analizar/lote", json={"correos": [correo(LEGITIMO[0])] * 4}).status_code == 422


def test_sin_sesion_o_sin_consentimiento(crear):
    sin_sesion = crear(con_sesion=False)
    assert sin_sesion.post("/analizar/lote", json={"correos": [correo(LEGITIMO[0])]}).status_code == 401
    sin_consentimiento = crear(consentimiento=False)
    assert sin_consentimiento.post("/analizar/lote", json={"correos": [correo(LEGITIMO[0])]}).status_code == 403


def test_sin_modelo_da_503(crear, tmp_path):
    cliente = crear(ruta_modelo=tmp_path / "no_existe.joblib")
    assert cliente.post("/analizar/lote", json={"correos": [correo(LEGITIMO[0])]}).status_code == 503


def test_un_lote_de_50_cuenta_como_una_sola_peticion(crear):
    cliente = crear(rate_limit=4)  # iniciar sesión + consentimiento ya usaron 2
    lote = {"correos": [correo(LEGITIMO[0])] * 50}
    assert cliente.post("/analizar/lote", json=lote).status_code == 200  # 3.ª petición
    assert cliente.post("/analizar/lote", json=lote).status_code == 200  # 4.ª (100 correos en total)
    assert cliente.post("/analizar/lote", json=lote).status_code == 429  # 5.ª


def test_tope_de_bytes_propio_del_lote(crear):
    cliente = crear(max_bytes=200_000, max_bytes_lote=600_000)
    grande = {"correos": [correo(LEGITIMO[0], cuerpo="palabra " * 6_000)] * 5}  # ≈ 250.000 bytes
    assert cliente.post("/analizar/lote", json=grande).status_code == 200
    # /analizar sigue con su tope de 200.000.
    assert cliente.post("/analizar", json=correo(LEGITIMO[0], cuerpo="palabra " * 26_000)).status_code == 413
    enorme = {"correos": [correo(LEGITIMO[0], cuerpo="palabra " * 6_000)] * 15}  # ≈ 750.000 bytes
    respuesta = cliente.post("/analizar/lote", json=enorme)
    assert respuesta.status_code == 413
    assert MARCA not in respuesta.text


def test_lote_de_bytes_menor_que_el_normal_no_arranca(crear):
    with pytest.raises(RuntimeError, match="SICAE_MAX_BYTES_LOTE"):
        crear(con_sesion=False, max_bytes=200_000, max_bytes_lote=100_000)


def test_registra_una_fila_por_correo_sin_texto(crear, tmp_path):
    cliente = crear()
    cliente.post("/analizar/lote", json={"correos": [correo(PHISHING[0]), correo(LEGITIMO[0])]})
    with sqlite3.connect(tmp_path / "sicae.db") as conexion:
        filas = conexion.execute("SELECT categoria FROM analisis ORDER BY id").fetchall()
    assert filas == [("phishing",), ("legitimo",)]
    contenido = (tmp_path / "sicae.db").read_bytes()
    for texto in [MARCA, "persona@uni.example.edu", "yo@example.org"]:
        assert texto.encode("utf-8") not in contenido, texto


def test_si_falla_uno_los_demas_llegan_y_el_log_no_tiene_contenido(crear, monkeypatch, caplog):
    cliente = crear()
    original = modulo_main.analizar_correo

    def falla_con_el_segundo(cabeceras, asunto, *args, **kwargs):
        if "FALLA" in asunto:
            raise ValueError(f"no se pudo con {asunto}")  # el mensaje trae el asunto: no debe ir al log
        return original(cabeceras, asunto, *args, **kwargs)

    monkeypatch.setattr(modulo_main, "analizar_correo", falla_con_el_segundo)
    correos = [correo(PHISHING[0]), correo(LEGITIMO[0], asunto=f"FALLA {MARCA}"), correo(LEGITIMO[1])]
    with caplog.at_level(logging.DEBUG):
        resultados = cliente.post("/analizar/lote", json={"correos": correos}).json()["resultados"]
    assert resultados[0]["categoria"] == "phishing"
    assert resultados[1] == {"error": "No se pudo analizar este correo."}
    assert resultados[2]["categoria"] == "legitimo"
    assert "Error al analizar un correo del lote (ValueError)" in caplog.text
    assert MARCA not in caplog.text and "FALLA" not in caplog.text
