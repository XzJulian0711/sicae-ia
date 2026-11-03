"""Fixtures de las pruebas de la API: un modelo INVENTADO, para no depender del .joblib real.

Se entrena un SVM pequeño con correos inventados y se guardan en una carpeta temporal el
modelo, el umbral, los promedios y una configuración de prioridad. La API se crea con
ajustes que apuntan a esos archivos.
"""

import json

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.config import Ajustes
from app.main import crear_app
from sicae_ml.calibrar import promedios_estructurales
from sicae_ml.features import COLUMNAS_ENTRADA
from sicae_ml.priority import RUTA_CONFIG
from sicae_ml.train import construir_modelos, guardar_modelo

PHISHING = [
    "su paquete está detenido pague la tasa de envío urgente",
    "su cuenta será suspendida verifique sus datos bancarios hoy",
    "felicidades ganador reclame su premio con su tarjeta",
    "su suscripción caducó actualice su pago para no perder el acceso",
]
LEGITIMO = [
    "les comparto el acta de la reunión del comité y el calendario del semestre",
    "invitación al seminario de investigación del viernes en el auditorio",
    "adjunto la propuesta de tesis con los comentarios del director",
    "recordatorio de la sesión de asesoría con el grupo de la maestría",
]


def correos_inventados():
    filas = []
    for etiqueta, textos, n_urls, n_adjuntos, largo in [
        ("phishing", PHISHING, 3, 0, 300), ("legitimo", LEGITIMO, 1, 1, 1500)
    ]:
        for g in range(10):
            for c in range(2):
                filas.append({"texto": f"{textos[g % len(textos)]} variante {c}", "n_urls": n_urls,
                              "n_adjuntos": n_adjuntos, "long_cuerpo": largo + 10 * g, "etiqueta": etiqueta})
    return pd.DataFrame(filas)


@pytest.fixture(scope="session")
def archivos_modelo(tmp_path_factory):
    """Rutas de un modelo inventado, con su umbral, promedios y configuración de prioridad."""
    carpeta = tmp_path_factory.mktemp("modelo")
    df = correos_inventados()
    pipeline, _ = construir_modelos()["svm_lineal"]
    pipeline.fit(df[COLUMNAS_ENTRADA], df["etiqueta"])

    guardar_modelo(pipeline, frozenset({"tienes"}), carpeta / "modelo.joblib", version="prueba")
    (carpeta / "umbral.json").write_text(json.dumps({"version_modelo": "prueba", "umbral": 0.5}), encoding="utf-8")
    (carpeta / "promedios.json").write_text(
        json.dumps({"version_modelo": "prueba", "promedios": promedios_estructurales(pipeline, df)}),
        encoding="utf-8",
    )
    config = json.loads(RUTA_CONFIG.read_text(encoding="utf-8"))
    config["dominios_importantes"] = ["uni.example.edu"]
    (carpeta / "prioridad.json").write_text(json.dumps(config), encoding="utf-8")
    return carpeta


CLAVE = "clave-de-prueba-solo-para-tests"  # inventada; la real va en .env
ORIGEN_PERMITIDO = "chrome-extension://idprueba"


def ajustes_para(carpeta, **cambios):
    """Ajustes de prueba. Todo se pasa explícito, así un .env local no cambia las pruebas."""
    valores = {
        "ruta_modelo": carpeta / "modelo.joblib",
        "ruta_umbral": carpeta / "umbral.json",
        "ruta_promedios": carpeta / "promedios.json",
        "ruta_config_prioridad": carpeta / "prioridad.json",
        "db_path": carpeta / "sicae.db",
        "api_key": CLAVE,
        "cors_origins": ORIGEN_PERMITIDO,
        "max_bytes": 200_000,
        "rate_limit": 30,
        "modo": "desarrollo",
    }
    return Ajustes(**{**valores, **cambios})


@pytest.fixture
def cliente(archivos_modelo, tmp_path):
    """Cliente con el modelo inventado cargado y la clave enviada en cada petición.

    El "with" ejecuta el lifespan. Cada prueba usa su propia base de datos en tmp_path.
    """
    ajustes = ajustes_para(archivos_modelo, db_path=tmp_path / "sicae.db")
    with TestClient(crear_app(ajustes), headers={"X-API-Key": CLAVE}) as cliente:
        yield cliente


@pytest.fixture
def cliente_sin_modelo(archivos_modelo, tmp_path):
    """Cliente cuya ruta de modelo no existe: la API debe arrancar igual."""
    ajustes = ajustes_para(archivos_modelo, ruta_modelo=tmp_path / "no_existe.joblib",
                           db_path=tmp_path / "sicae.db")
    with TestClient(crear_app(ajustes), headers={"X-API-Key": CLAVE}) as cliente:
        yield cliente
