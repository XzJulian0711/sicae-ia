"""Pruebas de ml/sicae_ml/sistema.py: los tres caminos (phishing, publicidad, legítimo).

No usan el modelo real: pasan recursos inventados (un SVM entrenado con correos inventados),
así funcionan aunque clasificador.joblib no exista (por ejemplo, en CI).
Correr desde la raíz:  .venv\\Scripts\\python -m pytest ml/tests -v
"""

import json
from email.message import EmailMessage

import pytest

from sicae_ml.calibrar import promedios_estructurales
from sicae_ml.features import COLUMNAS_ENTRADA
from sicae_ml.sistema import analizar_correo
from sicae_ml.train import construir_modelos
from tests.test_entrenamiento import correos_inventados
from tests.test_prioridad import config_prueba


@pytest.fixture(scope="module")
def recursos():
    df = correos_inventados()
    pipeline, _ = construir_modelos()["svm_lineal"]
    pipeline.fit(df[COLUMNAS_ENTRADA], df["etiqueta"])
    return {
        "pipeline": pipeline,
        "palabras_minuscula": frozenset(),
        "version": "prueba",
        "umbral": 0.5,
        "promedios": promedios_estructurales(pipeline, df),
    }


def correo(remitente, para, asunto, cuerpo, **cabeceras):
    mensaje = EmailMessage()
    mensaje["From"] = remitente
    mensaje["To"] = para
    mensaje["Subject"] = asunto
    for nombre, valor in cabeceras.items():
        mensaje[nombre.replace("_", "-")] = valor
    mensaje.set_content(cuerpo)
    return mensaje


def analizar(mensaje, config, recursos, n_urls, n_adjuntos):
    return analizar_correo(mensaje, mensaje["Subject"], mensaje.get_content(), n_urls, n_adjuntos,
                           config, recursos)


def test_camino_phishing(recursos, tmp_path):
    mensaje = correo("aviso@example.net", "yo@example.org", "Su paquete está detenido",
                     "Su paquete está detenido, pague la tasa urgente. Clave ZQXJ-MARCADOR")
    resultado = analizar(mensaje, config_prueba(tmp_path), recursos, 3, 0)
    assert resultado["categoria"] == "phishing"
    assert resultado["prioridad"] is None
    assert resultado["puntaje"] > 0
    assert resultado["version"] == "prueba"
    assert resultado["motivos"] and all(m["origen"] == "modelo" for m in resultado["motivos"])
    assert set(resultado) == {"categoria", "confianza", "puntaje", "prioridad", "motivos", "version"}


def test_camino_publicidad_va_con_prioridad_baja(recursos, tmp_path):
    mensaje = correo("boletin@example.org", "yo@example.org", "Invitación al seminario",
                     "Invitación al seminario de investigación del viernes, gracias",
                     List_Unsubscribe="<mailto:baja@example.org>")
    resultado = analizar(mensaje, config_prueba(tmp_path), recursos, 8, 1)
    assert resultado["categoria"] == "publicidad"
    assert resultado["prioridad"] == "baja"
    codigos = {m["codigo"]: m for m in resultado["motivos"]}
    assert codigos["list_unsubscribe"]["origen"] == "publicidad"
    assert codigos["list_unsubscribe"]["etiqueta"] == "Trae enlace para darse de baja (List-Unsubscribe)"
    assert codigos["publicidad"]["origen"] == "prioridad"


def test_camino_legitimo_con_prioridad_alta(recursos, tmp_path):
    mensaje = correo("jefa@example.com", "yo@example.org", "RE: acta de la reunión",
                     "Hola equipo, adjunto el acta de la reunión del jueves. Saludos",
                     In_Reply_To="<abc@example.com>")
    resultado = analizar(mensaje, config_prueba(tmp_path), recursos, 8, 1)
    assert resultado["categoria"] == "legitimo"
    assert resultado["prioridad"] == "alta"  # remitente (2) + destinatario único (1) + respuesta (1)
    origenes = {m["codigo"]: m["origen"] for m in resultado["motivos"]}
    for codigo in ["remitente_importante", "destinatario_unico", "respuesta"]:
        assert origenes[codigo] == "prioridad"
    assert "modelo" in origenes.values()


def test_confianza_dudosa_cerca_de_cero(recursos, tmp_path):
    exigente = {**recursos, "umbral": 1000.0}
    mensaje = correo("x@example.org", "yo@example.org", "Hola", "Hola")
    assert analizar(mensaje, config_prueba(tmp_path), exigente, 0, 0)["confianza"] == "dudosa"
    relajado = {**recursos, "umbral": 0.0}
    assert analizar(mensaje, config_prueba(tmp_path), relajado, 0, 0)["confianza"] == "alta"


def test_resultado_no_contiene_texto_ni_direcciones(recursos, tmp_path):
    mensaje = correo("persona.secreta@example.net", "yo@example.org", "Asunto ZQXJ-ASUNTO",
                     "Su paquete está detenido. Texto ZQXJ-CUERPO con datos privados")
    resultado = json.dumps(analizar(mensaje, config_prueba(tmp_path), recursos, 3, 0), ensure_ascii=False)
    for prohibido in ["ZQXJ", "persona.secreta", "example.net", "datos privados"]:
        assert prohibido not in resultado
