"""Pruebas de la descarga y la verificación del modelo (paso 2.5). SIN RED.

urlopen se reemplaza por uno falso (monkeypatch) y los archivos van a tmp_path. Un fixture
automático hace que el urlopen real falle si algo lo llamara: la CI nunca descarga nada.
Correr desde la raíz:  .venv\\Scripts\\python -m pytest ml/tests -v
"""

import hashlib
import urllib.request

import pytest

from sicae_ml import descargar_modelo as dm
from sicae_ml import train
from sicae_ml.integridad import ModeloAlterado, calcular_sha256, verificar_sha256

CONTENIDO = b"modelo-inventado-para-pruebas " * 5000  # ~150 KB, varios bloques
HASH = hashlib.sha256(CONTENIDO).hexdigest()
URL = "https://github.com/ejemplo/releases/download/v1/clasificador.joblib"


class RespuestaFalsa:
    """Imita la respuesta de urlopen: se lee por bloques y tiene geturl()."""

    def __init__(self, datos, url_final):
        self.datos, self.pos, self.url_final = datos, 0, url_final

    def read(self, n):
        bloque = self.datos[self.pos:self.pos + n]
        self.pos += len(bloque)
        return bloque

    def geturl(self):
        return self.url_final

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


@pytest.fixture(autouse=True)
def sin_red(monkeypatch):
    """Si algo intentara usar la red de verdad, la prueba falla."""
    def prohibido(*args, **kwargs):
        raise AssertionError("Las pruebas no deben descargar nada")
    monkeypatch.setattr(urllib.request, "urlopen", prohibido)
    monkeypatch.setattr(dm, "urlopen", prohibido)


@pytest.fixture
def red_falsa(monkeypatch):
    """Reemplaza urlopen. Devuelve un dict para elegir qué responde y contar las llamadas."""
    estado = {"datos": CONTENIDO, "url_final": URL.replace("github.com", "objects.githubusercontent.com"),
              "llamadas": 0}

    def urlopen_falso(peticion, timeout=None):
        estado["llamadas"] += 1
        assert timeout == dm.TIEMPO_ESPERA
        return RespuestaFalsa(estado["datos"], estado["url_final"])

    monkeypatch.setattr(dm, "urlopen", urlopen_falso)
    return estado


def archivos(carpeta):
    return sorted(p.name for p in carpeta.iterdir())


# ----- verificar_sha256 -----


def test_verificar_sha256(tmp_path):
    ruta = tmp_path / "x.bin"
    ruta.write_bytes(CONTENIDO)
    assert calcular_sha256(ruta) == HASH
    assert verificar_sha256(ruta, HASH) is True
    assert verificar_sha256(ruta, HASH.upper()) is True  # mayúsculas da igual
    assert verificar_sha256(ruta, "0" * 64) is False
    assert verificar_sha256(tmp_path / "no_existe.bin", HASH) is False


# ----- descarga -----


def test_hash_correcto_guarda_el_modelo(red_falsa, tmp_path):
    destino = tmp_path / "clasificador.joblib"
    mensaje = dm.descargar(URL, destino, HASH)
    assert "verificado" in mensaje
    assert destino.read_bytes() == CONTENIDO
    assert archivos(tmp_path) == ["clasificador.joblib"]  # no quedan temporales
    assert red_falsa["llamadas"] == 1


def test_hash_incorrecto_no_deja_ningun_archivo(red_falsa, tmp_path):
    red_falsa["datos"] = CONTENIDO + b"alterado"
    with pytest.raises(dm.ErrorDescarga, match="no coincide"):
        dm.descargar(URL, tmp_path / "clasificador.joblib", HASH)
    assert archivos(tmp_path) == []


def test_ya_existe_correcto_no_descarga(red_falsa, tmp_path):
    destino = tmp_path / "clasificador.joblib"
    destino.write_bytes(CONTENIDO)
    assert "no se descarga nada" in dm.descargar(URL, destino, HASH)
    assert red_falsa["llamadas"] == 0


def test_ya_existe_distinto_sin_forzar_no_lo_toca(red_falsa, tmp_path):
    destino = tmp_path / "clasificador.joblib"
    destino.write_bytes(b"otro modelo")
    with pytest.raises(dm.ErrorDescarga, match="--forzar"):
        dm.descargar(URL, destino, HASH)
    assert destino.read_bytes() == b"otro modelo"
    assert red_falsa["llamadas"] == 0


def test_con_forzar_reemplaza_el_distinto(red_falsa, tmp_path):
    destino = tmp_path / "clasificador.joblib"
    destino.write_bytes(b"otro modelo")
    dm.descargar(URL, destino, HASH, forzar=True)
    assert destino.read_bytes() == CONTENIDO
    assert archivos(tmp_path) == ["clasificador.joblib"]


def test_con_forzar_y_hash_malo_el_viejo_queda_intacto(red_falsa, tmp_path):
    destino = tmp_path / "clasificador.joblib"
    destino.write_bytes(b"otro modelo")
    red_falsa["datos"] = b"descarga corrupta"
    with pytest.raises(dm.ErrorDescarga):
        dm.descargar(URL, destino, HASH, forzar=True)
    assert destino.read_bytes() == b"otro modelo"
    assert archivos(tmp_path) == ["clasificador.joblib"]


def test_solo_https(red_falsa, tmp_path):
    with pytest.raises(dm.ErrorDescarga, match="HTTPS"):
        dm.descargar("http://github.com/x/clasificador.joblib", tmp_path / "clasificador.joblib", HASH)
    assert red_falsa["llamadas"] == 0


def test_redireccion_sin_https_se_cancela(red_falsa, tmp_path):
    red_falsa["url_final"] = "http://inseguro.example/clasificador.joblib"
    with pytest.raises(dm.ErrorDescarga, match="sin HTTPS"):
        dm.descargar(URL, tmp_path / "clasificador.joblib", HASH)
    assert archivos(tmp_path) == []


def test_archivo_demasiado_grande_se_cancela(red_falsa, tmp_path, monkeypatch):
    monkeypatch.setattr(dm, "TAMANO_MAXIMO", 1000)
    with pytest.raises(dm.ErrorDescarga, match="demasiado grande"):
        dm.descargar(URL, tmp_path / "clasificador.joblib", HASH)
    assert archivos(tmp_path) == []


def test_error_de_red_da_mensaje_claro(monkeypatch, tmp_path):
    def sin_conexion(*args, **kwargs):
        raise OSError("sin conexión")
    monkeypatch.setattr(dm, "urlopen", sin_conexion)
    with pytest.raises(dm.ErrorDescarga, match="No se pudo descargar"):
        dm.descargar(URL, tmp_path / "clasificador.joblib", HASH)
    assert archivos(tmp_path) == []


def test_main_devuelve_codigos_de_salida(red_falsa, tmp_path, monkeypatch, capsys):
    destino = tmp_path / "clasificador.joblib"
    monkeypatch.setattr(dm, "URL_MODELO", URL)
    monkeypatch.setattr(dm, "RUTA_MODELO", destino)
    monkeypatch.setattr(dm, "SHA256_MODELO", HASH)
    assert dm.main([]) == 0
    destino.write_bytes(b"otro")
    assert dm.main([]) == 1
    assert "--forzar" in capsys.readouterr().err
    assert dm.main(["--forzar"]) == 0 and destino.read_bytes() == CONTENIDO


# ----- verificación al cargar -----


def test_cargar_modelo_con_hash_malo_no_llama_a_joblib_load(tmp_path, monkeypatch):
    ruta = tmp_path / "clasificador.joblib"
    ruta.write_bytes(b"esto no es el modelo")

    def no_cargar(*args, **kwargs):
        raise AssertionError("joblib.load no debe llamarse con un hash malo")
    monkeypatch.setattr(train.joblib, "load", no_cargar)

    with pytest.raises(ModeloAlterado, match="--forzar"):
        train.cargar_modelo(ruta)  # hash por defecto: el del modelo v1.0
    with pytest.raises(ModeloAlterado):
        train.cargar_modelo(ruta, sha256_esperado="0" * 64)


def test_cargar_modelo_sin_archivo_da_file_not_found(tmp_path):
    with pytest.raises(FileNotFoundError):
        train.cargar_modelo(tmp_path / "no_existe.joblib")
