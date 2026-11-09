"""Pruebas del paso 7.1: GET /diagnostico/disponible y POST /diagnostico.

Modelo INVENTADO (conftest.py) y Google simulado. Los correos son inventados.
Correr desde la raíz:  .venv\\Scripts\\python -m pytest api/tests/test_diagnostico.py -v
"""

import pytest
from conftest import SUB, TOKEN_GOOGLE, TOKEN_GOOGLE_2, ajustes_para, crear_app_prueba
from fastapi.testclient import TestClient

from app import diagnostico

CLAVES = {"puntaje", "base", "aporte_texto", "aporte_n_urls", "aporte_n_adjuntos", "aporte_long_cuerpo",
          "n_urls", "n_adjuntos", "long_cuerpo", "largo_texto_limpio", "terminos"}
PALABRA_SECRETA = "Zorvaquintex"  # inventada: no debe volver en ninguna respuesta


def correo(**cambios):
    return {
        "asunto": f"Recordatorio de la entrega {PALABRA_SECRETA}",
        "cuerpo": "Les comparto el acta de la reunión del comité y el calendario del semestre.",
        "remitente": "coordinacion@uni.example.edu",
        "destinatarios": ["estudiante@uni.example.edu"],
        "cabeceras": {},
        "n_urls": 1,
        "n_adjuntos": 0,
        **cambios,
    }


@pytest.fixture
def crear(archivos_modelo, tmp_path):
    """crear(token=..., consentimiento=True, **ajustes) -> cliente con sesión. Cada prueba con su base."""
    abiertos = []

    def fabricar(token=TOKEN_GOOGLE, consentimiento=True, **cambios):
        ajustes = ajustes_para(archivos_modelo, db_path=tmp_path / "sicae.db", **cambios)
        cliente = TestClient(crear_app_prueba(ajustes))
        cliente.__enter__()
        abiertos.append(cliente)
        if token:
            respuesta = cliente.post("/auth/google", headers={"Authorization": f"Bearer {token}"})
            cliente.headers["Authorization"] = f"Bearer {respuesta.json()['token_sesion']}"
            if consentimiento:
                assert cliente.post("/consentimiento", json={"version": "1"}).status_code == 204
        return cliente

    yield fabricar
    for cliente in abiertos:
        cliente.__exit__(None, None, None)


# ---------------------------------------------------------------------------
# Solo en SICAE_MODO=desarrollo (en producción las rutas no existen)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("token, consentimiento", [(TOKEN_GOOGLE, True), (TOKEN_GOOGLE, False), (None, False)])
def test_en_produccion_las_rutas_no_existen(crear, token, consentimiento):
    # Aunque sea la cuenta de prueba (SICAE_DEMO_CUENTA = su google_sub): 404 en las dos rutas,
    # con o sin sesión, antes de mirar la sesión o el cuerpo.
    cliente = crear(token=token, consentimiento=consentimiento, modo="produccion", demo_cuenta=SUB)
    assert cliente.get("/diagnostico/disponible").status_code == 404
    respuesta = cliente.post("/diagnostico", json=correo())
    assert respuesta.status_code == 404
    assert PALABRA_SECRETA not in respuesta.text


def test_en_produccion_no_registra_nada(crear):
    cliente = crear(modo="produccion", demo_cuenta=SUB)
    antes = cliente.get("/estadisticas").json()["total"]
    cliente.post("/diagnostico", json=correo())
    assert cliente.get("/estadisticas").json()["total"] == antes


def test_en_desarrollo_las_rutas_existen(crear):
    cliente = crear(modo="desarrollo", demo_cuenta=SUB)
    assert cliente.get("/diagnostico/disponible").json() == {"disponible": True}
    assert cliente.post("/diagnostico", json=correo()).status_code == 200


@pytest.mark.parametrize("modo, rutas", [("desarrollo", True), ("produccion", False)])
def test_las_rutas_salen_en_la_app_solo_en_desarrollo(crear, modo, rutas):
    cliente = crear(token=None, modo=modo, demo_cuenta=SUB)
    caminos = {ruta.path for ruta in cliente.app.routes}
    assert ("/diagnostico" in caminos) is rutas
    assert ("/diagnostico/disponible" in caminos) is rutas
    assert "/analizar" in caminos, "el resto de la API no cambia"


# ---------------------------------------------------------------------------
# Solo la cuenta de prueba (en desarrollo: es el modo de ajustes_para)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("token, demo_cuenta, disponible", [
    (TOKEN_GOOGLE, SUB, True),  # la cuenta de prueba
    (TOKEN_GOOGLE_2, SUB, False),  # otra cuenta
    (TOKEN_GOOGLE, "", False),  # sin SICAE_DEMO_CUENTA: nadie
])
def test_disponible_solo_para_la_cuenta_de_prueba(crear, token, demo_cuenta, disponible):
    cliente = crear(token=token, demo_cuenta=demo_cuenta)
    respuesta = cliente.get("/diagnostico/disponible")
    assert respuesta.status_code == 200
    assert respuesta.json() == {"disponible": disponible}
    assert SUB not in respuesta.text, "nunca devuelve la cuenta de prueba"


def test_no_necesita_la_clave_de_gemini(crear):
    cliente = crear(demo_cuenta=SUB, demo_api_key="")
    assert cliente.get("/diagnostico/disponible").json() == {"disponible": True}
    assert cliente.post("/diagnostico", json=correo()).status_code == 200


def test_sin_sesion_401(crear):
    cliente = crear(token=None, demo_cuenta=SUB)
    assert cliente.get("/diagnostico/disponible").status_code == 401
    assert cliente.post("/diagnostico", json=correo()).status_code == 401


def test_sin_consentimiento_403(crear):
    cliente = crear(consentimiento=False, demo_cuenta=SUB)
    respuesta = cliente.post("/diagnostico", json=correo())
    assert respuesta.status_code == 403
    assert "consentimiento" in respuesta.json()["detalle"]


@pytest.mark.parametrize("token, demo_cuenta", [(TOKEN_GOOGLE_2, SUB), (TOKEN_GOOGLE, "")])
def test_otra_cuenta_403_con_codigo(crear, token, demo_cuenta):
    cliente = crear(token=token, demo_cuenta=demo_cuenta)
    respuesta = cliente.post("/diagnostico", json=correo())
    assert respuesta.status_code == 403
    assert respuesta.json()["codigo"] == "solo_cuenta_prueba"
    assert PALABRA_SECRETA not in respuesta.text


# ---------------------------------------------------------------------------
# Solo números, exactos y sin registro
# ---------------------------------------------------------------------------


def test_solo_numeros_y_nada_del_texto(crear):
    cliente = crear(demo_cuenta=SUB)
    respuesta = cliente.post("/diagnostico", json=correo())
    assert respuesta.status_code == 200
    datos = respuesta.json()
    assert set(datos) == CLAVES
    assert all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in datos.values())
    assert PALABRA_SECRETA.lower() not in respuesta.text.lower()
    assert "@" not in respuesta.text
    assert datos["n_urls"] == 1 and datos["n_adjuntos"] == 0
    assert datos["long_cuerpo"] == len(correo()["cuerpo"])
    assert datos["terminos"] > 0 and datos["largo_texto_limpio"] > 0


def test_la_base_mas_los_aportes_da_el_puntaje(crear):
    datos = crear(demo_cuenta=SUB).post("/diagnostico", json=correo(n_urls=4, n_adjuntos=2)).json()
    suma = (datos["base"] + datos["aporte_texto"] + datos["aporte_n_urls"] + datos["aporte_n_adjuntos"]
            + datos["aporte_long_cuerpo"])
    assert suma == pytest.approx(datos["puntaje"], abs=5e-4)  # cada parte viene redondeada a 4 decimales


def test_el_puntaje_es_el_mismo_de_analizar_y_no_se_registra(crear):
    cliente = crear(demo_cuenta=SUB)
    antes = cliente.get("/estadisticas").json()["total"]
    diagnostico_ = cliente.post("/diagnostico", json=correo()).json()
    assert cliente.get("/estadisticas").json()["total"] == antes, "el diagnóstico no cuenta como análisis"
    analisis = cliente.post("/analizar", json=correo()).json()
    assert diagnostico_["puntaje"] == pytest.approx(analisis["puntaje"], abs=1e-4)
    assert cliente.get("/estadisticas").json()["total"] == antes + 1


def test_mismo_texto_con_distintos_numeros_solo_cambian_los_aportes_estructurales(crear):
    cliente = crear(demo_cuenta=SUB)
    pocos = cliente.post("/diagnostico", json=correo(n_adjuntos=0)).json()
    muchos = cliente.post("/diagnostico", json=correo(n_adjuntos=3)).json()
    assert muchos["aporte_texto"] == pocos["aporte_texto"]
    assert muchos["aporte_n_adjuntos"] != pocos["aporte_n_adjuntos"]
    # En el modelo inventado, como en el v1.0, los adjuntos empujan hacia legítimo (puntaje menor).
    assert muchos["puntaje"] < pocos["puntaje"]


def test_entrada_invalida_422_sin_devolver_el_texto(crear):
    respuesta = crear(demo_cuenta=SUB).post("/diagnostico", json=correo(n_urls=-1))
    assert respuesta.status_code == 422
    assert PALABRA_SECRETA not in respuesta.text


def test_sin_modelo_503(archivos_modelo, tmp_path):
    ajustes = ajustes_para(archivos_modelo, ruta_modelo=tmp_path / "no_existe.joblib",
                           db_path=tmp_path / "sicae.db", demo_cuenta=SUB)
    with TestClient(crear_app_prueba(ajustes)) as cliente:
        token = cliente.post("/auth/google", headers={"Authorization": f"Bearer {TOKEN_GOOGLE}"}).json()["token_sesion"]
        cliente.headers["Authorization"] = f"Bearer {token}"
        cliente.post("/consentimiento", json={"version": "1"})
        assert cliente.post("/diagnostico", json=correo()).status_code == 503


def test_diagnosticar_acepta_textos_vacios(crear):
    cliente = crear(demo_cuenta=SUB)
    recursos = cliente.app.state.recursos
    datos = diagnostico.diagnosticar(None, None, 0, 0, recursos)
    assert set(datos) == CLAVES and datos["long_cuerpo"] == 0 and datos["terminos"] == 0
