"""Pruebas del registro de análisis (paso 2.3): qué se guarda y, sobre todo, qué NO.

Cada prueba usa una base de datos nueva en tmp_path.
Correr desde la raíz:  .venv\\Scripts\\python -m pytest api/tests -v
"""

import logging
import sqlite3

import pytest
from conftest import CLAVE, ajustes_para, crear_app_prueba
from fastapi.testclient import TestClient

from app import registro

COLUMNAS = ["id", "fecha", "categoria", "puntaje", "confianza", "prioridad", "version_modelo"]

# Un correo con un marcador único en TODOS los campos de texto.
MARCADOR = "ZQXJ7MARCA"
CORREO_MARCADO = {
    "asunto": f"Su paquete está detenido {MARCADOR}",
    "cuerpo": f"Pague la tasa de envío urgente en https://{MARCADOR.lower()}.example.net/pago {MARCADOR}",
    "remitente": f"Avisos <{MARCADOR.lower()}@example.net>",
    "destinatarios": [f"{MARCADOR.lower()}-destino@example.org"],
    "cabeceras": {"List-Id": f"<{MARCADOR.lower()}.example.net>"},
    "n_urls": 1,
    "n_adjuntos": 0,
}
LEGITIMO = {
    "asunto": "Acta de la reunión",
    "cuerpo": "Les comparto el acta de la reunión del comité y el calendario del semestre.",
    "remitente": "coordinacion@uni.example.edu",
    "destinatarios": ["usuario@example.org"],
    "n_urls": 1,
    "n_adjuntos": 1,
}


def filas(ruta):
    with sqlite3.connect(ruta) as conexion:
        return conexion.execute("SELECT * FROM analisis").fetchall()


# ----- esquema -----


def test_tabla_tiene_exactamente_las_7_columnas(tmp_path):
    ruta = tmp_path / "sub" / "sicae.db"  # la carpeta no existe: inicializar la crea
    registro.inicializar(ruta)
    with sqlite3.connect(ruta) as conexion:
        columnas = [fila[1] for fila in conexion.execute("PRAGMA table_info(analisis)")]
    assert columnas == COLUMNAS


def test_check_rechaza_valores_no_permitidos(tmp_path):
    ruta = tmp_path / "sicae.db"
    bueno = {"categoria": "phishing", "puntaje": 1.2, "confianza": "alta", "prioridad": None, "version": "v1.0"}
    assert registro.registrar(ruta, bueno) == 1
    for campo, valor in [("categoria", "spam"), ("confianza", "media"), ("prioridad", "urgente")]:
        with pytest.raises(sqlite3.IntegrityError):
            registro.registrar(ruta, {**bueno, campo: valor})


def test_estadisticas_vacias_son_ceros(tmp_path):
    assert registro.estadisticas(tmp_path / "sicae.db") == {
        "total": 0,
        "por_categoria": {"legitimo": 0, "publicidad": 0, "phishing": 0},
        "por_prioridad": {"alta": 0, "media": 0, "baja": 0, "sin_prioridad": 0},
    }


# ----- qué se guarda al analizar -----


def test_analizar_guarda_una_fila_solo_con_el_resultado(cliente, tmp_path):
    datos = cliente.post("/analizar", json=CORREO_MARCADO).json()
    [fila] = filas(tmp_path / "sicae.db")
    _, fecha, categoria, puntaje, confianza, prioridad, version = fila
    assert fecha.endswith("+00:00")  # UTC
    assert (categoria, confianza, prioridad, version) == (
        datos["categoria"], datos["confianza"], datos["prioridad"], datos["version"]
    )
    assert puntaje == pytest.approx(datos["puntaje"])


def test_el_texto_del_correo_no_aparece_en_el_archivo_db(cliente, tmp_path):
    cliente.post("/analizar", json=CORREO_MARCADO)
    cliente.post("/analizar", json=LEGITIMO)
    contenido = (tmp_path / "sicae.db").read_bytes()
    for texto in [MARCADOR, MARCADOR.lower(), "paquete", "example.net", "usuario@example.org", "https://"]:
        assert texto.encode("utf-8") not in contenido, texto
        assert texto.encode("utf-16-le") not in contenido, texto
    # No quedan archivos auxiliares de SQLite con datos sueltos.
    assert sorted(p.name for p in tmp_path.iterdir()) == ["sicae.db"]


def test_si_falla_el_registro_la_respuesta_igual_llega(archivos_modelo, tmp_path, caplog):
    # db_path apunta a una CARPETA: SQLite no puede abrirla como base de datos.
    ajustes = ajustes_para(archivos_modelo, db_path=tmp_path)
    with caplog.at_level(logging.DEBUG), TestClient(crear_app_prueba(ajustes), headers={"X-API-Key": CLAVE}) as cliente:
        respuesta = cliente.post("/analizar", json=CORREO_MARCADO)
    assert respuesta.status_code == 200 and respuesta.json()["categoria"] == "phishing"
    assert "No se pudo registrar el análisis (OperationalError)" in caplog.text
    assert MARCADOR not in caplog.text and MARCADOR.lower() not in caplog.text


# ----- /estadisticas -----


def test_estadisticas_cuenta_por_categoria_y_prioridad(cliente):
    cliente.post("/analizar", json=CORREO_MARCADO)
    legitimo = cliente.post("/analizar", json=LEGITIMO).json()
    datos = cliente.get("/estadisticas").json()
    assert datos["total"] == 2
    assert datos["por_categoria"] == {"legitimo": 1, "publicidad": 0, "phishing": 1}
    assert datos["por_prioridad"]["sin_prioridad"] == 1  # el phishing
    assert datos["por_prioridad"][legitimo["prioridad"]] == 1
    assert sum(datos["por_prioridad"].values()) == 2


def test_estadisticas_pide_clave(cliente):
    assert cliente.get("/estadisticas", headers={"X-API-Key": "otra"}).status_code == 401
