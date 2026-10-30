"""Esquemas de Pydantic: qué entra y qué sale de la API.

La entrada se valida antes de tocar el modelo: si algo no cumple (un campo de más, un número
negativo, un asunto demasiado largo), FastAPI responde 422 sin llamar a analizar_correo().
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

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


class Salud(BaseModel):
    estado: Literal["ok", "sin_modelo"]
    modelo_cargado: bool
    version: str | None
    detalle: str | None = Field(default=None, description="Por qué no se cargó el modelo, si aplica.")
