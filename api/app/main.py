"""API de SICAE-IA con FastAPI.

Endpoints:
  GET  /salud     -> ¿está la API arriba? ¿hay modelo cargado? ¿qué versión?
  POST /analizar  -> categoría, confianza, prioridad y motivos de un correo.

Arrancar (desde la raíz del proyecto):
    uvicorn app.main:app --app-dir api --reload
Documentación interactiva: http://127.0.0.1:8000/docs

PRIVACIDAD: la API no guarda nada y nunca escribe en los logs el asunto, el cuerpo ni las
direcciones de un correo. Tampoco los devuelve en los errores de validación.
ALCANCE: no borra ni envía correos; solo los clasifica.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.config import obtener_ajustes
from app.esquemas import Resultado, Salud, crear_correo_entrada
from sicae_ml.priority import cargar_config
from sicae_ml.sistema import analizar_correo, cargar_recursos

logger = logging.getLogger("sicae.api")

# Mensajes en español para los errores de validación más comunes.
MENSAJES = {
    "missing": "Falta este campo.",
    "extra_forbidden": "Este campo no está permitido.",
    "string_too_long": "El texto es demasiado largo.",
    "too_long": "La lista tiene demasiados elementos.",
    "greater_than_equal": "Debe ser un número mayor o igual a 0.",
    "int_parsing": "Debe ser un número entero.",
    "int_type": "Debe ser un número entero.",
    "string_type": "Debe ser un texto.",
    "list_type": "Debe ser una lista.",
    "dict_type": "Debe ser un objeto con pares nombre: valor.",
    "json_invalid": "El cuerpo de la petición no es un JSON válido.",
}


def _cargar(ajustes):
    """Carga modelo, calibración y configuración de prioridad.

    Devuelve (recursos, config_prioridad, detalle). Si algo falla, recursos es None y
    detalle dice por qué; la API arranca igual y /salud lo informa.
    """
    try:
        recursos = cargar_recursos(ajustes.ruta_modelo, ajustes.ruta_umbral, ajustes.ruta_promedios)
        config = cargar_config(ajustes.ruta_config_prioridad)
        return recursos, config, None
    except FileNotFoundError as error:
        return None, None, f"Falta un archivo del modelo: {error.filename or error}"
    except AssertionError as error:
        return None, None, f"Archivos del modelo incompatibles: {error}"
    except Exception as error:  # archivo dañado u otro problema: la API no se cae
        return None, None, f"No se pudo cargar el modelo ({type(error).__name__})"


def crear_app(ajustes=None):
    """Crea la aplicación. Las pruebas pasan sus propios ajustes (modelo inventado)."""
    ajustes = ajustes or obtener_ajustes()
    CorreoEntrada = crear_correo_entrada(ajustes)

    @asynccontextmanager
    async def lifespan(app):
        # Se carga UNA sola vez al arrancar, no en cada petición.
        recursos, config, detalle = _cargar(ajustes)
        app.state.recursos = recursos
        app.state.config_prioridad = config
        app.state.detalle = detalle
        if recursos is None:
            logger.warning("API sin modelo: %s", detalle)
        else:
            logger.info("Modelo %s cargado", recursos["version"])
        yield

    app = FastAPI(
        title="SICAE-IA",
        description="Clasifica correos en legítimo, publicidad o phishing y les asigna prioridad. "
                    "Prototipo académico: no guarda, no borra ni envía correos.",
        version="0.2.0",
        lifespan=lifespan,
    )

    @app.exception_handler(RequestValidationError)
    async def entrada_invalida(request: Request, exc: RequestValidationError):
        # Sin "input": el error por defecto de FastAPI devolvería el asunto o el cuerpo.
        errores = [
            {
                "campo": ".".join(str(p) for p in e.get("loc", ()) if p != "body"),
                "mensaje": MENSAJES.get(e.get("type"), e.get("msg", "Valor inválido.")),
                "tipo": e.get("type"),
            }
            for e in exc.errors()
        ]
        return JSONResponse(status_code=422, content={"detalle": "Entrada inválida", "errores": errores})

    @app.exception_handler(StarletteHTTPException)
    async def error_http(request: Request, exc: StarletteHTTPException):
        # Mismo formato que el 422: {"detalle": ...}.
        return JSONResponse(status_code=exc.status_code, content={"detalle": exc.detail})

    @app.get("/salud", response_model=Salud, summary="Estado de la API y del modelo")
    def salud(request: Request):
        recursos = request.app.state.recursos
        return Salud(
            estado="ok" if recursos else "sin_modelo",
            modelo_cargado=recursos is not None,
            version=recursos["version"] if recursos else None,
            detalle=request.app.state.detalle,
        )

    @app.post(
        "/analizar",
        response_model=Resultado,
        summary="Clasifica un correo y le asigna prioridad",
        responses={422: {"description": "Entrada inválida"}, 503: {"description": "Modelo no cargado"}},
    )
    def analizar(correo: CorreoEntrada, request: Request):
        recursos = request.app.state.recursos
        if recursos is None:
            raise HTTPException(
                status_code=503,
                detail=f"El modelo no está cargado: {request.app.state.detalle}. Revise GET /salud.",
            )
        # From y To salen de los campos explícitos y mandan sobre las cabeceras opcionales.
        cabeceras = {"From": correo.remitente, "To": ", ".join(correo.destinatarios)}
        cabeceras.update({k: v for k, v in correo.cabeceras.items() if k.lower() not in ("from", "to")})
        try:
            resultado = analizar_correo(
                cabeceras, correo.asunto, correo.cuerpo, correo.n_urls, correo.n_adjuntos,
                request.app.state.config_prioridad, recursos,
            )
        except Exception as error:
            # Solo el tipo de error: el mensaje podría contener texto del correo.
            logger.error("Error al analizar un correo (%s)", type(error).__name__)
            raise HTTPException(status_code=500, detail="Error interno al analizar el correo.") from None
        return resultado

    return app


app = crear_app()
