"""Seguridad de la API (paso 2.4), solo con la librería estándar y lo que ya trae FastAPI.

- validar_seguridad(): revisa la configuración al arrancar (sin clave, la API no arranca).
- crear_verificador_clave(): dependencia que exige el encabezado X-API-Key.
- LimiteTamano: rechaza peticiones de más de SICAE_MAX_BYTES con 413.
- LimitePeticiones: máximo SICAE_RATE_LIMIT peticiones por minuto por IP (429).
- CabecerasSeguridad: agrega cabeceras de seguridad a TODAS las respuestas.

Las tres clases son middlewares ASGI "puros": envuelven la app y ven cada petición antes que
FastAPI. Ninguna lee ni guarda el contenido de los correos; los errores no lo repiten.
"""

import json
import logging
import math
import secrets
import threading
import time
from collections import deque

from fastapi import HTTPException, Security
from fastapi.security import APIKeyHeader
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger("sicae.api")

CLAVE_DE_EJEMPLO = "cambia-esto"  # el valor de .env.example: no sirve como clave real

CABECERAS_SEGURIDAD = [
    (b"x-content-type-options", b"nosniff"),  # el navegador no "adivina" el tipo de archivo
    (b"x-frame-options", b"DENY"),  # no se puede mostrar dentro de un <iframe>
    (b"referrer-policy", b"no-referrer"),  # no se envía la URL de origen a otros sitios
    (b"cache-control", b"no-store"),  # ni el navegador ni un proxy guardan la respuesta
]


# ---------------------------------------------------------------------------
# Configuración al arrancar
# ---------------------------------------------------------------------------


def validar_seguridad(ajustes):
    """Revisa la configuración de seguridad. Lanza RuntimeError con un mensaje claro si falla.

    Se llama al arrancar la API (lifespan), no al importar el módulo: así las pruebas y la CI
    pueden importar app.main sin tener una clave.
    """
    clave = ajustes.api_key.get_secret_value().strip() if ajustes.api_key else ""
    if not clave:
        raise RuntimeError(
            "Falta SICAE_API_KEY. Créela en el archivo .env (vea .env.example), por ejemplo con:\n"
            '    python -c "import secrets; print(secrets.token_urlsafe(32))"'
        )
    if clave == CLAVE_DE_EJEMPLO:
        if ajustes.modo == "produccion":
            raise RuntimeError(
                f'SICAE_API_KEY sigue con el valor de ejemplo "{CLAVE_DE_EJEMPLO}". '
                "Cámbiela en .env por una clave larga y aleatoria."
            )
        logger.warning('SICAE_API_KEY tiene el valor de ejemplo "%s": cámbiela antes de usar la API en serio.',
                       CLAVE_DE_EJEMPLO)
    if "*" in ajustes.origenes_cors:
        raise RuntimeError('SICAE_CORS_ORIGINS no puede ser "*": liste los orígenes permitidos, '
                           "por ejemplo chrome-extension://<id-de-la-extension>.")
    if ajustes.max_bytes < 1 or ajustes.rate_limit < 1:
        raise RuntimeError("SICAE_MAX_BYTES y SICAE_RATE_LIMIT deben ser mayores que 0.")


# ---------------------------------------------------------------------------
# Clave de API
# ---------------------------------------------------------------------------


def crear_verificador_clave(ajustes):
    """Dependencia de FastAPI que exige X-API-Key igual a SICAE_API_KEY.

    compare_digest compara en tiempo constante: no deja adivinar la clave midiendo cuánto
    tarda la respuesta. Sin clave o con clave incorrecta, el mismo 401 genérico.
    """
    encabezado = APIKeyHeader(name="X-API-Key", auto_error=False,
                              description="Clave de la API (SICAE_API_KEY del archivo .env).")

    def verificar_clave(enviada: str | None = Security(encabezado)):
        esperada = ajustes.api_key.get_secret_value() if ajustes.api_key else ""
        if not esperada or not enviada or not secrets.compare_digest(
            enviada.encode("utf-8"), esperada.encode("utf-8")
        ):
            raise HTTPException(status_code=401, detail="No autorizado.",
                                headers={"WWW-Authenticate": "ApiKey"})

    return verificar_clave


# ---------------------------------------------------------------------------
# Middlewares ASGI
# ---------------------------------------------------------------------------


async def responder_json(send, estado, detalle, cabeceras=()):
    """Envía una respuesta JSON {"detalle": ...} directamente desde un middleware."""
    cuerpo = json.dumps({"detalle": detalle}, ensure_ascii=False).encode("utf-8")
    await send({
        "type": "http.response.start",
        "status": estado,
        "headers": [(b"content-type", b"application/json"),
                    (b"content-length", str(len(cuerpo)).encode()), *cabeceras],
    })
    await send({"type": "http.response.body", "body": cuerpo})


MENSAJE_413 = "La petición es demasiado grande."


class PeticionDemasiadoGrande(StarletteHTTPException):
    """413 que se lanza mientras llega el cuerpo. FastAPI lo convierte en respuesta JSON."""

    def __init__(self):
        super().__init__(status_code=413, detail=MENSAJE_413)


class LimiteTamano:
    """Rechaza con 413 las peticiones de más de max_bytes, sin leerlas enteras.

    - Si trae Content-Length y es mayor, responde 413 de inmediato.
    - Si no lo trae (envío por partes), cuenta los bytes que llegan y corta al pasar el límite.
    """

    def __init__(self, app, max_bytes):
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        largo = dict(scope.get("headers", [])).get(b"content-length")
        if largo is not None:
            try:
                declarado = int(largo)
            except ValueError:
                return await responder_json(send, 400, "Encabezado Content-Length inválido.")
            if declarado > self.max_bytes:
                return await responder_json(send, 413, MENSAJE_413)

        recibidos = 0

        async def recibir():
            nonlocal recibidos
            mensaje = await receive()
            if mensaje["type"] == "http.request":
                recibidos += len(mensaje.get("body", b""))
                if recibidos > self.max_bytes:
                    raise PeticionDemasiadoGrande()
            return mensaje

        await self.app(scope, recibir, send)


class LimitePeticiones:
    """Máximo `por_minuto` peticiones por IP en una ventana deslizante de 60 s (en memoria).

    Guarda, por IP, los momentos de sus últimas peticiones. Si ya hay `por_minuto` dentro de
    los últimos 60 s, responde 429 con Retry-After = segundos hasta que salga la más vieja.
    La IP sale de la conexión (scope["client"]); X-Forwarded-For NO se usa porque cualquiera
    puede inventarlo. `reloj` se puede cambiar en las pruebas para no tener que esperar.

    Memoria: como máximo una vez por ventana (60 s) se borran del diccionario las IPs sin
    peticiones en los últimos 60 s, así no se acumulan IPs que ya no piden nada.
    """

    def __init__(self, app, por_minuto, reloj=time.monotonic, ventana=60.0):
        self.app = app
        self.por_minuto = por_minuto
        self.reloj = reloj
        self.ventana = ventana
        self.tiempos = {}
        self.candado = threading.Lock()
        self._ultima_limpieza = reloj()

    @property
    def ips_en_memoria(self):
        """Cuántas IPs están guardadas ahora (para pruebas y diagnóstico)."""
        return len(self.tiempos)

    def _limpiar(self, ahora, limite_viejo):
        """Borra las IPs cuya petición más nueva ya salió de la ventana. Llamar con el candado."""
        if ahora - self._ultima_limpieza < self.ventana:
            return
        self.tiempos = {ip: cola for ip, cola in self.tiempos.items() if cola and cola[-1] > limite_viejo}
        self._ultima_limpieza = ahora

    def _anotar(self, ip):
        """Anota la petición y devuelve None, o los segundos que debe esperar si se pasó."""
        ahora = self.reloj()
        limite_viejo = ahora - self.ventana
        with self.candado:
            self._limpiar(ahora, limite_viejo)
            cola = self.tiempos.setdefault(ip, deque())
            while cola and cola[0] <= limite_viejo:
                cola.popleft()
            if len(cola) >= self.por_minuto:
                return max(1, math.ceil(cola[0] + self.ventana - ahora))
            cola.append(ahora)
        return None

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        ip = (scope.get("client") or ("desconocida", 0))[0]
        espera = self._anotar(ip)
        if espera is not None:
            return await responder_json(
                send, 429, "Demasiadas peticiones. Intente de nuevo en unos segundos.",
                [(b"retry-after", str(espera).encode())],
            )
        await self.app(scope, receive, send)


class CabecerasSeguridad:
    """Agrega CABECERAS_SEGURIDAD a todas las respuestas (también 401, 413, 429 y CORS)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        nombres = {nombre for nombre, _ in CABECERAS_SEGURIDAD}

        async def enviar(mensaje):
            if mensaje["type"] == "http.response.start":
                cabeceras = [c for c in mensaje.get("headers", []) if c[0].lower() not in nombres]
                mensaje = {**mensaje, "headers": cabeceras + CABECERAS_SEGURIDAD}
            await send(mensaje)

        await self.app(scope, receive, enviar)
