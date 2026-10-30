"""Pruebas de la API con TestClient y un modelo inventado (ver conftest.py).

Correr desde la raíz:  .venv\\Scripts\\python -m pytest api/tests -v
"""

import logging

import pytest

PHISHING = {
    "asunto": "Su paquete está detenido ZQXJ-ASUNTO",
    "cuerpo": "Su paquete está detenido, pague la tasa de envío urgente. ZQXJ-CUERPO",
    "remitente": "Avisos <persona.secreta@example.net>",
    "destinatarios": ["usuario@example.org"],
    "n_urls": 3,
    "n_adjuntos": 0,
}
LEGITIMO = {
    "asunto": "RE: acta de la reunión",
    "cuerpo": "Les comparto el acta de la reunión del comité y el calendario del semestre. "
              "Recuerden que el plazo para la propuesta de tesis vence mañana.",
    "remitente": "Coordinación <coordinacion@uni.example.edu>",
    "destinatarios": ["usuario@example.org"],
    "cabeceras": {"In-Reply-To": "<abc@uni.example.edu>"},
    "n_urls": 1,
    "n_adjuntos": 1,
}


# ----- /salud -----


def test_salud_con_modelo(cliente):
    respuesta = cliente.get("/salud")
    assert respuesta.status_code == 200
    assert respuesta.json() == {"estado": "ok", "modelo_cargado": True, "version": "prueba", "detalle": None}


# ----- /analizar -----


def test_analizar_phishing(cliente):
    respuesta = cliente.post("/analizar", json=PHISHING)
    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert datos["categoria"] == "phishing"
    assert datos["prioridad"] is None
    assert datos["confianza"] in {"alta", "dudosa"}
    assert datos["version"] == "prueba"
    assert datos["motivos"] and all(m["origen"] == "modelo" for m in datos["motivos"])
    assert set(datos) == {"categoria", "confianza", "puntaje", "prioridad", "motivos", "version"}


def test_analizar_legitimo_con_prioridad(cliente):
    respuesta = cliente.post("/analizar", json=LEGITIMO)
    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert datos["categoria"] == "legitimo"
    # dominio importante (2) + urgencia (1) + destinatario único (1) + respuesta (1) = 5 -> alta
    assert datos["prioridad"] == "alta"
    codigos = {m["codigo"] for m in datos["motivos"] if m["origen"] == "prioridad"}
    assert codigos == {"remitente_importante", "urgencia", "destinatario_unico", "respuesta"}


def test_cabeceras_opcionales_no_reemplazan_remitente_ni_destinatarios(cliente):
    # Un "From" en las cabeceras opcionales no gana sobre el campo remitente.
    correo = {**LEGITIMO, "cabeceras": {"from": "otro@example.com", "In-Reply-To": "<x@y>"}}
    datos = cliente.post("/analizar", json=correo).json()
    assert "remitente_importante" in {m["codigo"] for m in datos["motivos"]}


def test_respuesta_no_contiene_texto_ni_direcciones(cliente):
    texto = cliente.post("/analizar", json=PHISHING).text
    for prohibido in ["ZQXJ", "persona.secreta", "example.net", "usuario@example.org"]:
        assert prohibido not in texto


# ----- entradas inválidas -----


@pytest.mark.parametrize(
    "cambio, campo, tipo",
    [
        ({"n_urls": -1}, "n_urls", "greater_than_equal"),
        ({"n_adjuntos": "muchos"}, "n_adjuntos", "int_parsing"),
        ({"asunto": "x" * 1001}, "asunto", "string_too_long"),
        ({"cuerpo": "x" * 50_001}, "cuerpo", "string_too_long"),
        ({"campo_raro": 1}, "campo_raro", "extra_forbidden"),
        ({"destinatarios": ["a@example.org"] * 101}, "destinatarios", "too_long"),
    ],
)
def test_entrada_invalida_da_422_claro(cliente, cambio, campo, tipo):
    respuesta = cliente.post("/analizar", json={**PHISHING, **cambio})
    assert respuesta.status_code == 422
    datos = respuesta.json()
    assert datos["detalle"] == "Entrada inválida"
    assert {"campo": campo, "tipo": tipo} == {k: datos["errores"][0][k] for k in ("campo", "tipo")}
    assert datos["errores"][0]["mensaje"]


def test_falta_un_campo_da_422(cliente):
    correo = {k: v for k, v in PHISHING.items() if k != "cuerpo"}
    datos = cliente.post("/analizar", json=correo).json()
    assert datos["errores"] == [{"campo": "cuerpo", "mensaje": "Falta este campo.", "tipo": "missing"}]


def test_422_no_devuelve_el_contenido_enviado(cliente):
    correo = {**PHISHING, "asunto": "ZQXJ-SECRETO " * 200, "n_urls": -1}
    texto = cliente.post("/analizar", json=correo).text
    assert "ZQXJ" not in texto and "persona.secreta" not in texto


def test_json_mal_formado_da_422(cliente):
    respuesta = cliente.post("/analizar", content="{no es json", headers={"Content-Type": "application/json"})
    assert respuesta.status_code == 422
    assert respuesta.json()["errores"][0]["tipo"] == "json_invalid"


# ----- sin modelo -----


def test_sin_modelo_la_api_arranca_y_salud_lo_dice(cliente_sin_modelo):
    datos = cliente_sin_modelo.get("/salud").json()
    assert datos["estado"] == "sin_modelo" and datos["modelo_cargado"] is False
    assert datos["version"] is None and "no_existe.joblib" in datos["detalle"]


def test_sin_modelo_analizar_da_503(cliente_sin_modelo):
    respuesta = cliente_sin_modelo.post("/analizar", json=PHISHING)
    assert respuesta.status_code == 503
    assert "El modelo no está cargado" in respuesta.json()["detalle"]


# ----- privacidad en los logs -----


def test_los_logs_no_registran_el_correo(cliente, caplog):
    with caplog.at_level(logging.DEBUG):
        cliente.post("/analizar", json=PHISHING)
        cliente.post("/analizar", json={**PHISHING, "n_urls": -1})
    for prohibido in ["ZQXJ", "persona.secreta", "usuario@example.org", "paquete está detenido"]:
        assert prohibido not in caplog.text
