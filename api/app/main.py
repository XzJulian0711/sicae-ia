"""API de SICAE-IA con FastAPI.

Endpoints:
  GET    /salud           -> pública: ¿está la API arriba? ¿hay modelo cargado? ¿qué versión?
  POST   /auth/google     -> con el token de Google (Bearer): crea una sesión de la API (paso 4.3).
  POST   /consentimiento  -> con sesión: guarda qué versión del texto de permisos aceptó.
  POST   /auth/cerrar     -> con sesión: cierra esa sesión.
  DELETE /cuenta          -> con sesión: borra el usuario y todas sus sesiones.
  POST   /analizar        -> con sesión y consentimiento: categoría, confianza, prioridad y motivos.
  POST   /analizar/lote   -> lo mismo para hasta 50 correos a la vez (paso 4.4, pestaña Bandeja).
  GET    /estadisticas    -> con sesión: conteos por categoría y prioridad (solo números).

Arrancar (desde la raíz del proyecto, con SICAE_GOOGLE_CLIENT_ID en .env):
    uvicorn app.main:app --app-dir api --reload
Documentación interactiva (solo con SICAE_MODO=desarrollo): http://127.0.0.1:8000/docs

PRIVACIDAD: de cada análisis se guarda una fila con fecha, categoría, puntaje, confianza,
prioridad y versión del modelo (registro.py). NUNCA el asunto, el cuerpo, las direcciones,
las URLs ni un hash del contenido; tampoco se escriben en los logs ni se devuelven en errores.
Los análisis NO se ligan al usuario. De cada usuario se guarda solo google_sub, fechas y la
versión del consentimiento (usuarios.py): nunca el correo. De cada sesión, solo el hash del token.
ALCANCE: no borra ni envía correos; solo los clasifica.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request, Response, Security
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import registro, usuarios
from app.config import obtener_ajustes
from app.esquemas import (
    ConsentimientoEntrada,
    Estadisticas,
    Resultado,
    ResultadoLote,
    Salud,
    SesionApi,
    crear_correo_entrada,
    crear_lote_entrada,
)
from app.google import GoogleNoDisponible, TokenGoogleInvalido, verificar_token_google
from app.seguridad import (
    ESQUEMA_BEARER,
    CabecerasSeguridad,
    LimitePeticiones,
    LimiteTamano,
    crear_verificador_sesion,
    no_autorizado,
    token_bearer,
    validar_seguridad,
)
from sicae_ml.integridad import SHA256_MODELO, ModeloAlterado
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


def _cargar(ajustes, sha256_modelo):
    """Carga modelo, calibración y configuración de prioridad.

    Devuelve (recursos, config_prioridad, detalle). Si algo falla, recursos es None y
    detalle dice por qué; la API arranca igual y /salud lo informa.
    """
    try:
        recursos = cargar_recursos(ajustes.ruta_modelo, ajustes.ruta_umbral, ajustes.ruta_promedios,
                                   sha256_modelo)
        config = cargar_config(ajustes.ruta_config_prioridad)
        return recursos, config, None
    except ModeloAlterado:
        # El modelo no se llegó a cargar (pickle podría ejecutar código). Sin hashes ni rutas.
        return None, None, "El archivo del modelo no pasó la verificación de integridad (SHA-256)."
    except FileNotFoundError as error:
        return None, None, f"Falta un archivo del modelo: {error.filename or error}"
    except AssertionError as error:
        return None, None, f"Archivos del modelo incompatibles: {error}"
    except Exception as error:  # archivo dañado u otro problema: la API no se cae
        return None, None, f"No se pudo cargar el modelo ({type(error).__name__})"


def crear_app(ajustes=None, reloj=None, sha256_modelo=SHA256_MODELO, verificar_google=None,
              reloj_sesiones=None):
    """Crea la aplicación. Las pruebas pasan sus propios ajustes (modelo inventado), el
    SHA-256 de ese modelo y, si hace falta:
      - reloj: reloj falso para el límite de peticiones;
      - verificar_google(token) -> IdentidadGoogle: Google simulado, sin red;
      - reloj_sesiones() -> datetime UTC: para probar el vencimiento de las sesiones.

    sha256_modelo NO se lee de .env a propósito: si fuera configurable, se podría cambiar el
    modelo y su hash a la vez. Por defecto es el del modelo v1.0 (sicae_ml.integridad)."""
    ajustes = ajustes or obtener_ajustes()
    CorreoEntrada = crear_correo_entrada(ajustes)
    LoteEntrada = crear_lote_entrada(ajustes, CorreoEntrada)
    ahora_sesiones = reloj_sesiones or usuarios.ahora_utc
    verificar_sesion = crear_verificador_sesion(ajustes, ahora_sesiones)
    if verificar_google is None:
        def verificar_google(token):
            return verificar_token_google(token, ajustes.google_client_id.strip(),
                                          ahora=lambda: ahora_sesiones().timestamp())

    @asynccontextmanager
    async def lifespan(app):
        # 1. Seguridad: sin SICAE_GOOGLE_CLIENT_ID (o con CORS "*") la API NO arranca.
        validar_seguridad(ajustes)
        # 2. Registro, usuarios y sesiones: si la base no se puede crear, la API arranca igual;
        #    las rutas con sesión responderán 503 y el análisis no se registrará.
        try:
            registro.inicializar(ajustes.db_path)
            usuarios.inicializar(ajustes.db_path)
        except Exception as error:
            logger.error("No se pudo preparar la base de datos (%s)", type(error).__name__)
        # 3. Modelo: se carga UNA sola vez al arrancar, no en cada petición.
        recursos, config, detalle = _cargar(ajustes, sha256_modelo)
        app.state.recursos = recursos
        app.state.config_prioridad = config
        app.state.detalle = detalle
        if recursos is None:
            logger.warning("API sin modelo: %s", detalle)
        else:
            logger.info("Modelo %s cargado", recursos["version"])
        yield

    desarrollo = ajustes.modo == "desarrollo"
    app = FastAPI(
        title="SICAE-IA",
        description="Clasifica correos en legítimo, publicidad o phishing y les asigna prioridad. "
                    "Prototipo académico: no guarda el contenido de los correos, no los borra ni "
                    "los envía.",
        version="0.4.0",
        lifespan=lifespan,
        # /docs, /redoc y /openapi.json solo en desarrollo.
        docs_url="/docs" if desarrollo else None,
        redoc_url="/redoc" if desarrollo else None,
        openapi_url="/openapi.json" if desarrollo else None,
    )

    # Capas de seguridad. add_middleware pone cada una POR FUERA de la anterior, así que el
    # orden de afuera hacia adentro queda: cabeceras -> CORS -> límite por IP -> tamaño -> app.
    # /analizar/lote trae hasta 50 correos: tiene su propio tope (SICAE_MAX_BYTES_LOTE).
    app.add_middleware(LimiteTamano, max_bytes=ajustes.max_bytes,
                       por_ruta={"/analizar/lote": ajustes.max_bytes_lote})
    app.add_middleware(LimitePeticiones, por_minuto=ajustes.rate_limit,
                       **({"reloj": reloj} if reloj else {}))
    app.add_middleware(
        CORSMiddleware,
        allow_origins=ajustes.origenes_cors,  # nunca "*" (validar_seguridad lo impide)
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Content-Type", "Authorization"],
        allow_credentials=False,
    )
    app.add_middleware(CabecerasSeguridad)

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
        # Mismo formato que el 422: {"detalle": ...}. Se conservan las cabeceras del error
        # (por ejemplo WWW-Authenticate en el 401).
        return JSONResponse(status_code=exc.status_code, content={"detalle": exc.detail},
                            headers=getattr(exc, "headers", None))

    @app.get("/salud", response_model=Salud, summary="Estado de la API y del modelo")
    def salud(request: Request):
        recursos = request.app.state.recursos
        return Salud(
            estado="ok" if recursos else "sin_modelo",
            modelo_cargado=recursos is not None,
            version=recursos["version"] if recursos else None,
            detalle=request.app.state.detalle,
        )

    # ---------- Sesiones (paso 4.3) ----------

    def base_no_disponible(error):
        logger.error("Usuarios o sesiones no disponibles (%s)", type(error).__name__)
        return HTTPException(status_code=503, detail="Las sesiones no están disponibles.")

    @app.post(
        "/auth/google",
        response_model=SesionApi,
        summary="Crea una sesión de la API con el token de Google",
        responses={401: {"description": "El token de Google no es válido"},
                   503: {"description": "No se pudo verificar con Google"}},
    )
    def auth_google(autorizacion: HTTPAuthorizationCredentials | None = Security(ESQUEMA_BEARER)):
        # El token de Google NUNCA se escribe en los logs ni se guarda: solo se verifica.
        token_google = token_bearer(autorizacion)
        try:
            identidad = verificar_google(token_google)
        except TokenGoogleInvalido:
            raise no_autorizado() from None
        except GoogleNoDisponible as error:
            logger.warning("No se pudo verificar con Google (%s)", type(error).__name__)
            raise HTTPException(status_code=503, detail="No se pudo verificar con Google. Inténtelo más tarde.") from None
        try:
            momento = ahora_sesiones()
            usuario = usuarios.registrar_acceso(ajustes.db_path, identidad.sub, ahora=momento)
            token, expira = usuarios.crear_sesion(ajustes.db_path, usuario["id"], ajustes.duracion_sesion_horas,
                                                  ahora=momento)
        except Exception as error:
            raise base_no_disponible(error) from None
        return SesionApi(token_sesion=token, expira=expira,
                         consentimiento_version=usuario["consentimiento_version"])

    @app.post("/consentimiento", status_code=204, summary="Guarda la versión del texto de permisos aceptada",
              responses={401: {"description": "Sin sesión válida"}})
    def consentimiento(entrada: ConsentimientoEntrada, usuario=Depends(verificar_sesion)):
        try:
            usuarios.guardar_consentimiento(ajustes.db_path, usuario["id"], entrada.version, ahora=ahora_sesiones())
        except Exception as error:
            raise base_no_disponible(error) from None
        return Response(status_code=204)

    @app.post("/auth/cerrar", status_code=204, summary="Cierra la sesión actual",
              responses={401: {"description": "Sin sesión válida"}})
    def auth_cerrar(usuario=Depends(verificar_sesion)):
        try:
            usuarios.cerrar_sesion(ajustes.db_path, usuario["token"])
        except Exception as error:
            raise base_no_disponible(error) from None
        return Response(status_code=204)

    @app.delete("/cuenta", status_code=204, summary="Borra el usuario y todas sus sesiones",
                responses={401: {"description": "Sin sesión válida"}})
    def borrar_cuenta(usuario=Depends(verificar_sesion)):
        # Los análisis no se ligan al usuario, así que no hay análisis "suyos" que borrar.
        try:
            usuarios.borrar_usuario(ajustes.db_path, usuario["id"])
        except Exception as error:
            raise base_no_disponible(error) from None
        return Response(status_code=204)

    def exigir_consentimiento(usuario=Depends(verificar_sesion)):
        """Ley 1581: no se procesa el correo de alguien que no aceptó el tratamiento de datos."""
        if not usuario["consentimiento_version"]:
            raise HTTPException(status_code=403, detail="Falta el consentimiento.")
        return usuario

    # ---------- Análisis ----------

    @app.post(
        "/analizar",
        response_model=Resultado,
        summary="Clasifica un correo y le asigna prioridad",
        responses={401: {"description": "Sin sesión válida"},
                   403: {"description": "Falta el consentimiento"},
                   413: {"description": "Petición demasiado grande"},
                   422: {"description": "Entrada inválida"},
                   429: {"description": "Demasiadas peticiones"},
                   503: {"description": "Modelo no cargado"}},
        dependencies=[Depends(exigir_consentimiento)],
    )
    def analizar(correo: CorreoEntrada, request: Request):
        recursos = recursos_o_503(request)
        try:
            return _analizar_uno(correo, request, recursos)
        except Exception as error:
            # Solo el tipo de error: el mensaje podría contener texto del correo.
            logger.error("Error al analizar un correo (%s)", type(error).__name__)
            raise HTTPException(status_code=500, detail="Error interno al analizar el correo.") from None

    @app.post(
        "/analizar/lote",
        response_model=ResultadoLote,
        summary="Clasifica varios correos a la vez (pestaña Bandeja)",
        responses={401: {"description": "Sin sesión válida"},
                   403: {"description": "Falta el consentimiento"},
                   413: {"description": "Lote demasiado grande"},
                   422: {"description": "Entrada inválida (por ejemplo, más correos de los permitidos)"},
                   429: {"description": "Demasiadas peticiones (el lote cuenta como una)"},
                   503: {"description": "Modelo no cargado"}},
        dependencies=[Depends(exigir_consentimiento)],
    )
    def analizar_lote(lote: LoteEntrada, request: Request):
        """Mismo análisis que /analizar para cada correo, en el mismo orden. Si uno falla, en su
        lugar va {"error": ...} y los demás siguen. Registro igual que hoy: una fila por correo."""
        recursos = recursos_o_503(request)
        resultados = []
        for correo in lote.correos:
            try:
                resultados.append(_analizar_uno(correo, request, recursos))
            except Exception as error:
                logger.error("Error al analizar un correo del lote (%s)", type(error).__name__)
                resultados.append({"error": "No se pudo analizar este correo."})
        return {"resultados": resultados}

    def recursos_o_503(request):
        recursos = request.app.state.recursos
        if recursos is None:
            raise HTTPException(
                status_code=503,
                detail=f"El modelo no está cargado: {request.app.state.detalle}. Revise GET /salud.",
            )
        return recursos

    def _analizar_uno(correo, request, recursos):
        """analizar_correo() + registro de UNA fila (sin texto). Lo usan /analizar y el lote."""
        # From y To salen de los campos explícitos y mandan sobre las cabeceras opcionales.
        cabeceras = {"From": correo.remitente, "To": ", ".join(correo.destinatarios)}
        cabeceras.update({k: v for k, v in correo.cabeceras.items() if k.lower() not in ("from", "to")})
        resultado = analizar_correo(
            cabeceras, correo.asunto, correo.cuerpo, correo.n_urls, correo.n_adjuntos,
            request.app.state.config_prioridad, recursos,
        )
        # Registro: solo categoría, puntaje, confianza, prioridad y versión. Si falla, la
        # respuesta se entrega igual y en el log queda solo el tipo de error.
        try:
            registro.registrar(ajustes.db_path, resultado)
        except Exception as error:
            logger.error("No se pudo registrar el análisis (%s)", type(error).__name__)
        return resultado

    @app.get(
        "/estadisticas",
        response_model=Estadisticas,
        summary="Conteos de análisis por categoría y prioridad",
        responses={401: {"description": "Sin sesión válida"},
                   503: {"description": "Registro no disponible"}},
        dependencies=[Depends(verificar_sesion)],
    )
    def ver_estadisticas():
        try:
            return registro.estadisticas(ajustes.db_path)
        except Exception as error:
            logger.error("No se pudieron leer las estadísticas (%s)", type(error).__name__)
            raise HTTPException(status_code=503, detail="El registro no está disponible.") from None

    return app


app = crear_app()
