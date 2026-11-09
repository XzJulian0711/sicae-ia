"""API de SICAE-IA con FastAPI.

Endpoints:
  GET    /salud           -> pública: ¿está la API arriba? ¿hay modelo cargado? ¿qué versión?
  POST   /auth/google     -> con el token de Google (Bearer): crea una sesión de la API (paso 4.3).
  POST   /consentimiento  -> con sesión: guarda qué versión del texto de permisos aceptó.
  POST   /auth/cerrar     -> con sesión: cierra esa sesión.
  DELETE /cuenta          -> con sesión: borra el usuario y todas sus sesiones.
  POST   /analizar        -> con sesión y consentimiento: categoría, confianza, prioridad y motivos.
  POST   /analizar/lote   -> lo mismo para hasta 50 correos a la vez (paso 4.4, pestaña Bandeja).
  POST   /acciones        -> con sesión y consentimiento: registra papelera/cuarentena (solo cantidad y MB).
  POST   /redactar        -> con sesión y consentimiento v4: borrador con IA (paso 6.2; Ollama local
                             o, solo para la cuenta de prueba, el modo demostración con Gemini).
  GET    /redactar/proveedores -> con sesión: ¿esta sesión puede usar el modo demostración? (paso 6.3)
  GET    /diagnostico/disponible -> SOLO con SICAE_MODO=desarrollo: ¿es la cuenta de prueba? (paso 7.1)
  POST   /diagnostico     -> SOLO desarrollo y la cuenta de prueba: partes del puntaje, solo números.
                             En producción las dos rutas no existen (404).
  GET    /estadisticas    -> con sesión: conteos por categoría y prioridad (solo números).

Arrancar (desde la raíz del proyecto, con SICAE_GOOGLE_CLIENT_ID en .env):
    uvicorn app.main:app --app-dir api --reload
Documentación interactiva (solo con SICAE_MODO=desarrollo): http://127.0.0.1:8000/docs

PRIVACIDAD: de cada análisis se guarda una fila con fecha, categoría, puntaje, confianza,
prioridad y versión del modelo (registro.py). NUNCA el asunto, el cuerpo, las direcciones,
las URLs ni un hash del contenido; tampoco se escriben en los logs ni se devuelven en errores.
Los análisis NO se ligan al usuario. De cada usuario se guarda solo google_sub, fechas y la
versión del consentimiento (usuarios.py): nunca el correo. De cada sesión, solo el hash del token.
De cada borrador con IA se guarda solo fecha, proveedor, modelo, segundos y si salió bien
(registro.py): nunca la indicación, el correo ni el borrador.
ALCANCE: no borra ni envía correos; los clasifica y, si se pide, propone un borrador.
"""

import logging
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request, Response, Security
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from starlette.exceptions import HTTPException as StarletteHTTPException

from app import diagnostico, redaccion, registro, usuarios
from app.config import obtener_ajustes
from app.esquemas import (
    AccionEntrada,
    Borrador,
    ConsentimientoEntrada,
    Diagnostico,
    DiagnosticoDisponible,
    Estadisticas,
    Proveedores,
    Resultado,
    ResultadoLote,
    Salud,
    SesionApi,
    crear_correo_entrada,
    crear_lote_entrada,
    crear_redactar_entrada,
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
    "string_too_short": "El texto no puede estar vacío.",
    "literal_error": "Valor no permitido.",
    "too_long": "La lista tiene demasiados elementos.",
    "greater_than_equal": "Debe ser un número mayor o igual a 0.",
    "int_parsing": "Debe ser un número entero.",
    "int_type": "Debe ser un número entero.",
    "string_type": "Debe ser un texto.",
    "list_type": "Debe ser una lista.",
    "dict_type": "Debe ser un objeto con pares nombre: valor.",
    "json_invalid": "El cuerpo de la petición no es un JSON válido.",
}


class ErrorConCodigo(HTTPException):
    """HTTPException con un "codigo" corto (paso 6.3): la extensión elige su propio mensaje con él,
    sin mostrar el "detalle" de la API."""

    def __init__(self, estado, detalle, codigo, headers=None):
        super().__init__(status_code=estado, detail=detalle, headers=headers)
        self.codigo = codigo


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
              reloj_sesiones=None, transporte_ia=None, reloj_redaccion=None):
    """Crea la aplicación. Las pruebas pasan sus propios ajustes (modelo inventado), el
    SHA-256 de ese modelo y, si hace falta:
      - reloj: reloj falso para el límite de peticiones;
      - verificar_google(token) -> IdentidadGoogle: Google simulado, sin red;
      - reloj_sesiones() -> datetime UTC: para probar el vencimiento de las sesiones;
      - transporte_ia(url, cuerpo, cabeceras, tiempo, sin_proxy) -> (estado, texto): Ollama y
        Gemini simulados, sin red (paso 6.2);
      - reloj_redaccion(): reloj falso para el límite de borradores por hora.

    sha256_modelo NO se lee de .env a propósito: si fuera configurable, se podría cambiar el
    modelo y su hash a la vez. Por defecto es el del modelo v1.0 (sicae_ml.integridad)."""
    ajustes = ajustes or obtener_ajustes()
    CorreoEntrada = crear_correo_entrada(ajustes)
    LoteEntrada = crear_lote_entrada(ajustes, CorreoEntrada)
    RedactarEntrada = crear_redactar_entrada(ajustes)
    transporte_ia = transporte_ia or redaccion.transporte_urllib
    limite_borradores = redaccion.LimitePorHora(ajustes.ia_limite_hora,
                                                **({"reloj": reloj_redaccion} if reloj_redaccion else {}))
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
        version="0.6.0",
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
        # (por ejemplo WWW-Authenticate en el 401). Los errores de /redactar traen además un
        # "codigo" (paso 6.3) para que la extensión elija su propio mensaje.
        contenido = {"detalle": exc.detail}
        if getattr(exc, "codigo", None):
            contenido["codigo"] = exc.codigo
        return JSONResponse(status_code=exc.status_code, content=contenido,
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
        lugar va {"error": ...} y los demás siguen. Registro: una fila por correo, salvo registrar=false."""
        recursos = recursos_o_503(request)
        resultados = []
        for correo in lote.correos:
            try:
                resultados.append(_analizar_uno(correo, request, recursos, registrar=lote.registrar))
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

    def _analizar_uno(correo, request, recursos, registrar=True):
        """analizar_correo() + registro de UNA fila (sin texto). Lo usan /analizar y el lote.
        registrar=False (paso 4.5): los análisis de "Liberar espacio" no se cuentan."""
        # From y To salen de los campos explícitos y mandan sobre las cabeceras opcionales.
        cabeceras = {"From": correo.remitente, "To": ", ".join(correo.destinatarios)}
        cabeceras.update({k: v for k, v in correo.cabeceras.items() if k.lower() not in ("from", "to")})
        resultado = analizar_correo(
            cabeceras, correo.asunto, correo.cuerpo, correo.n_urls, correo.n_adjuntos,
            request.app.state.config_prioridad, recursos,
        )
        # Registro: solo categoría, puntaje, confianza, prioridad y versión. Si falla, la
        # respuesta se entrega igual y en el log queda solo el tipo de error.
        if registrar:
            try:
                registro.registrar(ajustes.db_path, resultado)
            except Exception as error:
                logger.error("No se pudo registrar el análisis (%s)", type(error).__name__)
        return resultado

    @app.post("/acciones", status_code=204, summary="Registra una acción sobre el correo (sin ids ni remitentes)",
              responses={401: {"description": "Sin sesión válida"},
                         403: {"description": "Falta el consentimiento"},
                         503: {"description": "Registro no disponible"}},
              dependencies=[Depends(exigir_consentimiento)])
    def registrar_accion(entrada: AccionEntrada):
        """Paso 4.5: papelera, deshacer, cuarentena o devolver. Solo fecha, acción, cantidad y MB;
        nunca ids de correo, remitentes ni el usuario."""
        try:
            registro.registrar_accion(ajustes.db_path, entrada.accion, entrada.cantidad, entrada.mb)
        except Exception as error:
            logger.error("No se pudo registrar la acción (%s)", type(error).__name__)
            raise HTTPException(status_code=503, detail="El registro no está disponible.") from None
        return Response(status_code=204)

    # ---------- Redacción con IA (paso 6.2) ----------

    def demo_disponible(usuario):
        """¿El modo demostración está disponible PARA ESTA SESIÓN? Clave configurada y cuenta de prueba."""
        return bool(ajustes.demo_api_key.get_secret_value().strip()) and \
            redaccion.es_cuenta_demo(usuario.get("google_sub"), ajustes.demo_cuenta)

    @app.get(
        "/redactar/proveedores",
        response_model=Proveedores,
        summary="Qué proveedores de IA puede usar esta sesión (paso 6.3)",
        responses={401: {"description": "Sin sesión válida"}},
    )
    def proveedores(usuario=Depends(verificar_sesion)):
        """La extensión muestra el interruptor del modo demostración solo si esto dice true.
        Nunca devuelve la clave ni la cuenta de prueba."""
        return Proveedores(local=True, modelo_local=ajustes.ia_modelo, demostracion=demo_disponible(usuario))

    @app.post(
        "/redactar",
        response_model=Borrador,
        summary="Propone un borrador de respuesta con IA (Ollama local o modo demostración)",
        responses={401: {"description": "Sin sesión válida"},
                   403: {"description": "Falta el consentimiento v4, o el modo demostración no es para esta cuenta"},
                   422: {"description": "Entrada inválida"},
                   429: {"description": "Más de SICAE_IA_LIMITE_HORA borradores en la última hora"},
                   502: {"description": "La IA respondió de forma inesperada"},
                   503: {"description": "Ollama no disponible, modelo no descargado o modo demostración desactivado"},
                   504: {"description": "La IA tardó demasiado"}},
    )
    def redactar(entrada: RedactarEntrada, usuario=Depends(exigir_consentimiento)):
        """Ley 1581: redactar es una finalidad nueva, que autoriza el texto de permisos v4.
        Nunca se registra la indicación, el correo ni el borrador; solo fecha, proveedor, modelo,
        segundos y si salió bien."""
        if not redaccion.consentimiento_suficiente(usuario["consentimiento_version"]):
            raise ErrorConCodigo(403, "Acepta los permisos nuevos (versión 4) para usar la redacción con IA.",
                                 "consentimiento")
        demo = entrada.modo == "demostracion"
        if demo:
            # Nunca hay "plan B": el modo demostración solo se usa si se pide, hay clave y es la
            # cuenta de prueba. Si Ollama falla, tampoco se pasa a Gemini.
            if not demo_disponible(usuario):
                if not ajustes.demo_api_key.get_secret_value().strip():
                    raise ErrorConCodigo(503, "El modo demostración está desactivado.", "demo_desactivado")
                raise ErrorConCodigo(403, "El modo demostración solo está disponible para la cuenta de prueba "
                                          "del proyecto.", "demo_cuenta")
        espera = limite_borradores.permitir(usuario["id"])
        if espera is not None:
            raise ErrorConCodigo(429, f"Llegaste al límite de {ajustes.ia_limite_hora} borradores por hora. "
                                      "Espera un poco e inténtalo de nuevo.",
                                 "limite_hora", headers={"Retry-After": str(espera)})

        proveedor = "demostracion" if demo else "ollama"
        modelo = ajustes.demo_modelo if demo else ajustes.ia_modelo
        inicio = time.monotonic()
        try:
            resultado = redaccion.redactar(entrada, demo, ajustes, transporte_ia)
        except redaccion.ErrorRedaccion as error:
            _registrar_borrador(proveedor, modelo, time.monotonic() - inicio, False)
            # Solo el tipo de error: nunca la respuesta del proveedor ni el texto.
            logger.warning("Borrador con IA fallido (%s)", error.tipo)
            raise ErrorConCodigo(error.estado, error.mensaje, error.tipo) from None
        segundos = round(time.monotonic() - inicio, 3)
        _registrar_borrador(proveedor, modelo, segundos, True)
        return Borrador(proveedor=proveedor, modelo=modelo, segundos=segundos, **resultado)

    def _registrar_borrador(proveedor, modelo, segundos, exitoso):
        try:
            registro.registrar_borrador(ajustes.db_path, proveedor, modelo, segundos, exitoso)
        except Exception as error:
            logger.error("No se pudo registrar el borrador (%s)", type(error).__name__)

    # ---------- Diagnóstico de la prueba funcional (paso 7.1): SOLO desarrollo + cuenta de prueba ----------
    # Las dos rutas existen solo con SICAE_MODO=desarrollo: en producción no se registran y
    # responden 404. El código se conserva como evidencia del hallazgo de la prueba funcional
    # (docs/metricas.md). Dentro de desarrollo, además, solo la cuenta de prueba las puede usar.

    def es_cuenta_prueba(usuario):
        """La misma regla del modo demostración: google_sub == SICAE_DEMO_CUENTA (sin la clave de Gemini)."""
        return redaccion.es_cuenta_demo(usuario.get("google_sub"), ajustes.demo_cuenta)

    if desarrollo:

        @app.get(
            "/diagnostico/disponible",
            response_model=DiagnosticoDisponible,
            summary="¿Esta sesión puede usar el diagnóstico y la exportación? (paso 7.1)",
            responses={401: {"description": "Sin sesión válida"}},
        )
        def diagnostico_disponible(usuario=Depends(verificar_sesion)):
            """La extensión muestra el diagnóstico y "Exportar CSV" solo si esto dice true.
            Nunca devuelve la cuenta de prueba."""
            return DiagnosticoDisponible(disponible=es_cuenta_prueba(usuario))

        @app.post(
            "/diagnostico",
            response_model=Diagnostico,
            summary="Partes del puntaje de un correo, solo números (paso 7.1, solo la cuenta de prueba)",
            responses={401: {"description": "Sin sesión válida"},
                       403: {"description": "Falta el consentimiento, o no es la cuenta de prueba"},
                       413: {"description": "Petición demasiado grande"},
                       422: {"description": "Entrada inválida"},
                       429: {"description": "Demasiadas peticiones"},
                       503: {"description": "Modelo no cargado"}},
        )
        def diagnosticar(correo: CorreoEntrada, request: Request, usuario=Depends(exigir_consentimiento)):
            """Mismo modelo y misma limpieza que /analizar, separando el puntaje en sus partes.
            NO se registra (no cuenta en /estadisticas) y no devuelve nada del texto del correo."""
            if not es_cuenta_prueba(usuario):
                raise ErrorConCodigo(403, "El diagnóstico solo está disponible para la cuenta de prueba del proyecto.",
                                     "solo_cuenta_prueba")
            recursos = recursos_o_503(request)
            try:
                return diagnostico.diagnosticar(correo.asunto, correo.cuerpo, correo.n_urls, correo.n_adjuntos, recursos)
            except Exception as error:
                logger.error("Error en el diagnóstico (%s)", type(error).__name__)
                raise HTTPException(status_code=500, detail="Error interno en el diagnóstico.") from None

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
