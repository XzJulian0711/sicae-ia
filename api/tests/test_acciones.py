"""Pruebas del paso 4.5 en la API: POST /acciones y /analizar/lote con registrar=false.

Correr desde la raíz:  .venv\\Scripts\\python -m pytest api/tests -v
"""

import sqlite3

import pytest
from conftest import LEGITIMO, PHISHING, ajustes_para, crear_app_prueba, iniciar_sesion
from fastapi.testclient import TestClient


def correo(texto, legitimo):
    return {
        "asunto": "Acta de la reunión" if legitimo else "Su paquete está detenido",
        "cuerpo": texto,
        "remitente": "persona@uni.example.edu",
        "destinatarios": ["yo@example.org"],
        "n_urls": 1,
        "n_adjuntos": 1 if legitimo else 0,
    }


@pytest.fixture
def crear(archivos_modelo, tmp_path):
    abiertos = []

    def fabricar(con_sesion=True, consentimiento=True):
        ajustes = ajustes_para(archivos_modelo, db_path=tmp_path / "sicae.db")
        cliente = TestClient(crear_app_prueba(ajustes))
        cliente.__enter__()
        abiertos.append(cliente)
        if con_sesion:
            iniciar_sesion(cliente, consentimiento=consentimiento)
        return cliente

    yield fabricar
    for cliente in abiertos:
        cliente.__exit__(None, None, None)


def filas(db, tabla):
    with sqlite3.connect(db) as conexion:
        return conexion.execute(f"SELECT * FROM {tabla}").fetchall()  # noqa: S608 (tabla fija)


def columnas(db, tabla):
    with sqlite3.connect(db) as conexion:
        return [c[1] for c in conexion.execute(f"PRAGMA table_info({tabla})")]


# ----- POST /acciones -----


def test_registra_solo_fecha_accion_cantidad_y_mb(crear, tmp_path):
    cliente = crear()
    for accion in ["papelera", "deshacer_papelera", "cuarentena", "devolver_cuarentena"]:
        assert cliente.post("/acciones", json={"accion": accion, "cantidad": 40, "mb": 12.5}).status_code == 204
    db = tmp_path / "sicae.db"
    assert columnas(db, "acciones") == ["id", "fecha", "accion", "cantidad", "mb"]  # sin ids, remitentes ni usuario
    assert [(f[2], f[3], f[4]) for f in filas(db, "acciones")] == [
        ("papelera", 40, 12.5), ("deshacer_papelera", 40, 12.5), ("cuarentena", 40, 12.5), ("devolver_cuarentena", 40, 12.5),
    ]


@pytest.mark.parametrize("cuerpo", [
    {"accion": "borrar_definitivo", "cantidad": 1, "mb": 0},
    {"accion": "papelera", "cantidad": -1, "mb": 0},
    {"accion": "papelera", "cantidad": 501, "mb": 0},
    {"accion": "papelera", "cantidad": 1, "mb": -0.1},
    {"accion": "papelera", "cantidad": 1, "mb": 1, "ids": ["18c0ffee"]},
    {"accion": "papelera", "cantidad": 1, "mb": 1, "remitente": "a@example.org"},
    {"accion": "papelera"},
])
def test_acciones_invalidas_dan_422(crear, cuerpo):
    assert crear().post("/acciones", json=cuerpo).status_code == 422


def test_acciones_exige_sesion_y_consentimiento(crear):
    cuerpo = {"accion": "papelera", "cantidad": 1, "mb": 0.1}
    assert crear(con_sesion=False).post("/acciones", json=cuerpo).status_code == 401
    assert crear(consentimiento=False).post("/acciones", json=cuerpo).status_code == 403


# ----- /analizar/lote con registrar=false -----


def test_lote_con_registrar_false_no_escribe_en_el_registro(crear, tmp_path):
    cliente = crear()
    lote = {"correos": [correo(PHISHING[0], False), correo(LEGITIMO[0], True)]}

    respuesta = cliente.post("/analizar/lote", json={**lote, "registrar": False})
    assert respuesta.status_code == 200
    assert [r["categoria"] for r in respuesta.json()["resultados"]] == ["phishing", "legitimo"]
    assert filas(tmp_path / "sicae.db", "analisis") == []
    assert cliente.get("/estadisticas").json()["total"] == 0

    # Por defecto (o con true) sí se registra, como en el paso 4.4.
    cliente.post("/analizar/lote", json=lote)
    cliente.post("/analizar/lote", json={**lote, "registrar": True})
    assert cliente.get("/estadisticas").json()["total"] == 4


def test_registrar_debe_ser_booleano(crear):
    lote = {"correos": [correo(LEGITIMO[0], True)], "registrar": "no"}
    assert crear().post("/analizar/lote", json=lote).status_code == 422
