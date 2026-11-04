"""Fixtures de las pruebas de la API: un modelo INVENTADO, para no depender del .joblib real.

Se entrena un SVM pequeño con correos inventados y se guardan en una carpeta temporal el
modelo, el umbral, los promedios y una configuración de prioridad. La API se crea con
ajustes que apuntan a esos archivos.
"""

import json
from pathlib import Path

import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app.config import Ajustes
from app.google import IdentidadGoogle, TokenGoogleInvalido
from app.main import crear_app
from sicae_ml.integridad import calcular_sha256
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


ORIGEN_PERMITIDO = "chrome-extension://idprueba"

# ----- Google simulado (paso 4.3): las pruebas NUNCA hablan con Google -----
CLIENT_ID = "123456-prueba.apps.googleusercontent.com"  # inventado
TOKEN_GOOGLE = "ya29.token-de-google-inventado-para-pruebas"
SUB = "100000000000000000001"  # identificador de la cuenta (inventado)
CORREO_GOOGLE = "persona.de.prueba@example.org"  # nunca debe llegar a la base ni a los logs


TOKEN_GOOGLE_2 = "ya29.token-de-google-de-otra-cuenta-inventado"
SUB_2 = "100000000000000000002"  # otra cuenta (inventada)


def google_falso(token):
    """Hace de verificar_token_google: acepta solo TOKEN_GOOGLE y TOKEN_GOOGLE_2."""
    if token == TOKEN_GOOGLE:
        return IdentidadGoogle(sub=SUB)
    if token == TOKEN_GOOGLE_2:
        return IdentidadGoogle(sub=SUB_2)
    raise TokenGoogleInvalido("token desconocido")


def crear_app_prueba(ajustes, **kwargs):
    """crear_app() con el SHA-256 del modelo inventado (no es el v1.0 de la Release) y con
    Google simulado.

    Si el modelo no existe (prueba "sin modelo"), se pasa el hash por defecto: da igual,
    porque la API ni siquiera llega a verificarlo.
    """
    if Path(ajustes.ruta_modelo).is_file():
        kwargs.setdefault("sha256_modelo", calcular_sha256(ajustes.ruta_modelo))
    kwargs.setdefault("verificar_google", google_falso)
    return crear_app(ajustes, **kwargs)


def iniciar_sesion(cliente, consentimiento=True):
    """Inicia sesión con el token de Google simulado y deja la sesión en el cliente.
    Devuelve el token de sesión."""
    respuesta = cliente.post("/auth/google", headers={"Authorization": f"Bearer {TOKEN_GOOGLE}"})
    assert respuesta.status_code == 200, respuesta.text
    token = respuesta.json()["token_sesion"]
    cliente.headers["Authorization"] = f"Bearer {token}"
    if consentimiento:
        assert cliente.post("/consentimiento", json={"version": "1"}).status_code == 204
    return token


def ajustes_para(carpeta, **cambios):
    """Ajustes de prueba. Todo se pasa explícito, así un .env local no cambia las pruebas."""
    valores = {
        "ruta_modelo": carpeta / "modelo.joblib",
        "ruta_umbral": carpeta / "umbral.json",
        "ruta_promedios": carpeta / "promedios.json",
        "ruta_config_prioridad": carpeta / "prioridad.json",
        "db_path": carpeta / "sicae.db",
        "google_client_id": CLIENT_ID,
        "cors_origins": ORIGEN_PERMITIDO,
        "max_bytes": 200_000,
        "rate_limit": 30,
        "modo": "desarrollo",
    }
    return Ajustes(**{**valores, **cambios})


@pytest.fixture
def cliente(archivos_modelo, tmp_path):
    """Cliente con el modelo inventado cargado, con sesión y consentimiento (paso 4.3).

    El "with" ejecuta el lifespan. Cada prueba usa su propia base de datos en tmp_path.
    """
    ajustes = ajustes_para(archivos_modelo, db_path=tmp_path / "sicae.db")
    with TestClient(crear_app_prueba(ajustes)) as cliente:
        iniciar_sesion(cliente)
        yield cliente


@pytest.fixture
def cliente_sin_modelo(archivos_modelo, tmp_path):
    """Cliente cuya ruta de modelo no existe: la API debe arrancar igual."""
    ajustes = ajustes_para(archivos_modelo, ruta_modelo=tmp_path / "no_existe.joblib",
                           db_path=tmp_path / "sicae.db")
    with TestClient(crear_app_prueba(ajustes)) as cliente:
        iniciar_sesion(cliente)
        yield cliente
