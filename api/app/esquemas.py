"""Esquemas de Pydantic: qué entra y qué sale de la API.

La entrada se valida antes de tocar el modelo: si algo no cumple (un campo de más, un número
negativo, un asunto demasiado largo), FastAPI responde 422 sin llamar a analizar_correo().
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, StrictBool, field_validator

LARGO_MAX_DIRECCION = 320  # largo máximo de una dirección de correo (RFC 3696)


def crear_correo_entrada(ajustes):
    """Modelo de entrada con los límites de los ajustes (.env).

    Se arma dentro de una función porque los límites (max_asunto, max_cuerpo…) se leen de la
    configuración y Pydantic los necesita al definir la clase.
    """

    class CorreoEntrada(BaseModel):
        model_config = ConfigDict(
            extra="forbid",  # un campo desconocido es un error, no se ignora en silencio
            json_schema_extra={
                "examples": [
                    {
                        "asunto": "Su paquete está detenido",
                        "cuerpo": "Estimado cliente, su paquete no pudo ser entregado. "
                                  "Pague la tasa de envío para programar una nueva entrega.",
                        "remitente": "Paquetería <avisos@example.net>",
                        "destinatarios": ["usuario@example.org"],
                        "cabeceras": {},
                        "n_urls": 1,
                        "n_adjuntos": 0,
                    }
                ]
            },
        )

        asunto: str = Field(max_length=ajustes.max_asunto, description="Asunto del correo.")
        cuerpo: str = Field(max_length=ajustes.max_cuerpo, description="Cuerpo en texto plano.")
        remitente: str = Field(
            max_length=LARGO_MAX_DIRECCION,
            description='Cabecera From, por ejemplo "Nombre <correo@dominio>".',
        )
        destinatarios: list[str] = Field(
            max_length=ajustes.max_destinatarios, description="Direcciones de la cabecera To."
        )
        cabeceras: dict[str, str] = Field(
            default_factory=dict,
            description="Otras cabeceras (List-Unsubscribe, Cc, In-Reply-To…). Opcional.",
        )
        n_urls: int = Field(ge=0, description="Cantidad de enlaces del correo.")
        n_adjuntos: int = Field(ge=0, description="Cantidad de archivos adjuntos.")

        @field_validator("destinatarios")
        @classmethod
        def _largo_de_cada_destinatario(cls, valor):
            if any(len(d) > LARGO_MAX_DIRECCION for d in valor):
                raise ValueError(f"cada destinatario puede tener como máximo {LARGO_MAX_DIRECCION} caracteres")
            return valor

        @field_validator("cabeceras")
        @classmethod
        def _tamano_de_las_cabeceras(cls, valor):
            if len(valor) > ajustes.max_cabeceras:
                raise ValueError(f"como máximo {ajustes.max_cabeceras} cabeceras")
            if any(len(v) > ajustes.max_valor_cabecera or len(k) > 200 for k, v in valor.items()):
                raise ValueError(f"cada cabecera puede tener como máximo {ajustes.max_valor_cabecera} caracteres")
            return valor

    return CorreoEntrada


def crear_lote_entrada(ajustes, CorreoEntrada):
    """Modelo de POST /analizar/lote (paso 4.4): de 1 a SICAE_MAX_LOTE correos, cada uno con los
    mismos límites que /analizar."""

    class LoteEntrada(BaseModel):
        model_config = ConfigDict(extra="forbid")

        correos: list[CorreoEntrada] = Field(
            min_length=1, max_length=ajustes.max_lote,
            description=f"De 1 a {ajustes.max_lote} correos. La respuesta los devuelve en el mismo orden.",
        )
        registrar: StrictBool = Field(
            default=True,
            description="False para no guardar estos análisis en el registro (paso 4.5: los análisis "
                        "que hace 'Liberar espacio' para excluir phishing y prioridad alta no se cuentan "
                        "en /estadisticas).",
        )

    return LoteEntrada


class AccionEntrada(BaseModel):
    """Cuerpo de POST /acciones (paso 4.5): qué se hizo y cuánto. Sin ids ni remitentes."""

    model_config = ConfigDict(extra="forbid")

    accion: Literal["papelera", "deshacer_papelera", "cuarentena", "devolver_cuarentena"]
    cantidad: int = Field(ge=0, le=500, description="Cuántos correos.")
    mb: float = Field(ge=0, le=1_000_000, description="Cuántos MB sumaban.")


class ErrorDeCorreo(BaseModel):
    """En un lote, el lugar de un correo que no se pudo analizar (los demás siguen)."""

    error: str = Field(description="Mensaje genérico, sin contenido del correo.")


class Motivo(BaseModel):
    codigo: str = Field(description='Código estable, por ejemplo "palabra:paquete" o "list_unsubscribe".')
    etiqueta: str = Field(description="Frase en español para mostrar al usuario.")
    origen: Literal["modelo", "publicidad", "prioridad"]


class Resultado(BaseModel):
    categoria: Literal["legitimo", "publicidad", "phishing"]
    confianza: Literal["alta", "dudosa"]
    puntaje: float = Field(description="Puntaje del modelo: mayor que 0 = phishing.")
    prioridad: Literal["alta", "media", "baja"] | None = Field(
        description="None si el correo es phishing (va como alerta, sin prioridad)."
    )
    motivos: list[Motivo]
    version: str = Field(description="Versión del modelo que clasificó el correo.")


class ResultadoLote(BaseModel):
    """Respuesta de POST /analizar/lote: un elemento por correo, en el mismo orden."""

    resultados: list[Resultado | ErrorDeCorreo]


class Estadisticas(BaseModel):
    total: int = Field(description="Correos analizados desde que existe el registro.")
    por_categoria: dict[Literal["legitimo", "publicidad", "phishing"], int]
    por_prioridad: dict[Literal["alta", "media", "baja", "sin_prioridad"], int] = Field(
        description='"sin_prioridad" cuenta los phishing (van como alerta, sin prioridad).'
    )


class SesionApi(BaseModel):
    """Respuesta de POST /auth/google (paso 4.3)."""

    token_sesion: str = Field(description="Token de la sesión de la API. Se envía en Authorization: Bearer. "
                                          "La API solo guarda su hash.")
    expira: str = Field(description="Fecha y hora (UTC, ISO 8601) en que vence la sesión.")
    consentimiento_version: str | None = Field(
        description="Versión del texto de permisos que aceptó el usuario, o None si todavía no aceptó."
    )


class ConsentimientoEntrada(BaseModel):
    """Cuerpo de POST /consentimiento: qué versión del texto de permisos aceptó."""

    model_config = ConfigDict(extra="forbid")

    version: str = Field(min_length=1, max_length=20, pattern=r"^[\w.-]+$",
                         description='Versión del texto de permisos, por ejemplo "1".')


LARGO_MAX_INDICACION = 500


def crear_redactar_entrada(ajustes):
    """Cuerpo de POST /redactar (paso 6.2), con los límites de los ajustes.

    A propósito NO tiene remitente, destinatarios ni cabeceras: así nunca llegan a la IA (y
    extra="forbid" responde 422 si alguien los manda).
    """

    class RedactarEntrada(BaseModel):
        model_config = ConfigDict(
            extra="forbid",
            json_schema_extra={
                "examples": [{
                    "indicacion": "Confirma que asistiré a la reunión del viernes.",
                    "tono": "cordial",
                    "asunto": "Reunión del comité",
                    "cuerpo": "Hola, ¿nos acompañas el viernes a las 10?",
                    "modo": "local",
                }]
            },
        )

        indicacion: str = Field(min_length=1, max_length=LARGO_MAX_INDICACION,
                                description="Qué quiere decir la persona en el borrador (máx. 500 caracteres).")
        tono: Literal["formal", "breve", "cordial"] = Field(description="Tono del borrador.")
        asunto: str = Field(default="", max_length=ajustes.max_asunto, description="Asunto del correo recibido.")
        cuerpo: str = Field(default="", max_length=ajustes.max_cuerpo,
                            description="Cuerpo del correo recibido. A la IA llegan solo los primeros "
                                        "SICAE_IA_MAX_CUERPO caracteres.")
        modo: Literal["local", "demostracion"] = Field(
            default="local",
            description='"local": Ollama en este equipo. "demostracion": Gemini, solo para la cuenta de prueba.',
        )

        @field_validator("indicacion")
        @classmethod
        def indicacion_con_texto(cls, valor):
            if not valor.strip():
                raise ValueError("La indicación no puede estar vacía.")
            return valor.strip()

    return RedactarEntrada


class Borrador(BaseModel):
    """Respuesta de POST /redactar. El borrador NO se guarda en ningún lado."""

    borrador: str = Field(description="Texto del correo propuesto. Revísalo antes de usarlo.")
    proveedor: Literal["ollama", "demostracion"]
    modelo: str
    segundos: float = Field(ge=0, description="Cuánto tardó la IA.")
    enlaces_quitados: int = Field(ge=0, description="Enlaces que la IA agregó y no estaban en la indicación.")
    cuerpo_recortado: bool = Field(description="Si a la IA le llegó solo el inicio del cuerpo.")
    avisos: list[str] = Field(default_factory=list)


class Salud(BaseModel):
    estado: Literal["ok", "sin_modelo"]
    modelo_cargado: bool
    version: str | None
    detalle: str | None = Field(default=None, description="Por qué no se cargó el modelo, si aplica.")
