"""Pruebas de ml/sicae_ml/explicar.py y ml/sicae_ml/calibrar.py.

Usan un SVM entrenado con correos inventados; una prueba usa además el modelo real v1.0 y
se salta si clasificador.joblib no existe (por ejemplo, en CI).
Correr desde la raíz:  .venv\\Scripts\\python -m pytest ml/tests -v
"""

import numpy as np
import pytest

from sicae_ml.calibrar import calcular_umbral, promedios_estructurales
from sicae_ml.explicar import ESTRUCTURAL, PALABRA, _etiqueta, contribuciones, explicar
from sicae_ml.features import COLUMNAS_ENTRADA
from sicae_ml.train import RUTA_MODELO, cargar_modelo, construir_modelos
from tests.test_entrenamiento import correos_inventados


@pytest.fixture(scope="module")
def modelo_y_datos():
    df = correos_inventados()
    pipeline, _ = construir_modelos()["svm_lineal"]
    pipeline.fit(df[COLUMNAS_ENTRADA], df["etiqueta"])
    return pipeline, df


def puntaje_real(pipeline, texto, n_urls, n_adjuntos, long_cuerpo):
    import pandas as pd

    fila = pd.DataFrame([{"texto": texto, "n_urls": n_urls, "n_adjuntos": n_adjuntos,
                          "long_cuerpo": long_cuerpo}])[COLUMNAS_ENTRADA]
    return float(pipeline.decision_function(fila)[0])


TEXTO_PHISHING = "nombretoken su paquete está detenido pague la tasa urgente numtoken"
TEXTO_LEGITIMO = "estimados profesores les comparto la convocatoria de la maestría saludos"


# ----- identidad exacta -----


@pytest.mark.parametrize("texto", [TEXTO_PHISHING, TEXTO_LEGITIMO])
def test_suma_de_contribuciones_mas_intercepto_es_decision_function(modelo_y_datos, texto):
    pipeline, _ = modelo_y_datos
    base, lista = contribuciones(pipeline, texto, 3, 0, 500)
    assert base == pytest.approx(float(pipeline.named_steps["modelo"].intercept_[0]))
    assert base + sum(i["contribucion"] for i in lista) == pytest.approx(
        puntaje_real(pipeline, texto, 3, 0, 500), abs=1e-9
    )


def test_identidad_se_cumple_al_centrar_en_el_promedio(modelo_y_datos):
    pipeline, df = modelo_y_datos
    promedios = promedios_estructurales(pipeline, df)
    base, lista = contribuciones(pipeline, TEXTO_PHISHING, 3, 0, 500, promedios)
    assert base != pytest.approx(float(pipeline.named_steps["modelo"].intercept_[0]))
    assert base + sum(i["contribucion"] for i in lista) == pytest.approx(
        puntaje_real(pipeline, TEXTO_PHISHING, 3, 0, 500), abs=1e-9
    )


@pytest.mark.skipif(not RUTA_MODELO.exists(), reason="No está ml/models/clasificador.joblib")
def test_identidad_con_el_modelo_real_v1():
    pipeline = cargar_modelo(RUTA_MODELO)["pipeline"]
    promedios = {"n_urls": 0.3, "n_adjuntos": 0.05, "long_cuerpo": 0.44}
    texto = "su paquete está detenido, confirme el pago de la tasa de entrega hoy"
    base, lista = contribuciones(pipeline, texto, 1, 0, 300, promedios)
    assert base + sum(i["contribucion"] for i in lista) == pytest.approx(
        puntaje_real(pipeline, texto, 1, 0, 300), abs=1e-9
    )


# ----- motivos visibles -----


def test_explicar_da_puntaje_clase_y_motivos_hacia_la_clase(modelo_y_datos):
    pipeline, _ = modelo_y_datos
    resultado = explicar(pipeline, TEXTO_PHISHING, 3, 0, 450)
    assert resultado["clase"] == "phishing" and resultado["puntaje"] > 0
    assert resultado["puntaje"] == pytest.approx(puntaje_real(pipeline, TEXTO_PHISHING, 3, 0, 450), abs=1e-4)
    assert 1 <= len(resultado["motivos"]) <= 4
    assert all(m["contribucion"] > 0 for m in resultado["motivos"])  # todos empujan hacia phishing

    legitimo = explicar(pipeline, TEXTO_LEGITIMO, 8, 1, 1600)
    assert legitimo["clase"] == "legitimo"
    assert all(m["contribucion"] < 0 for m in legitimo["motivos"])


def test_explicar_oculta_tokens_y_respeta_n(modelo_y_datos):
    pipeline, _ = modelo_y_datos
    resultado = explicar(pipeline, TEXTO_PHISHING, 3, 0, 450, n=2)
    assert len(resultado["motivos"]) <= 2
    for motivo in explicar(pipeline, TEXTO_PHISHING, 3, 0, 450, n=50)["motivos"]:
        assert not {"nombretoken", "numtoken", "emailtoken"} & set(motivo["termino"].split())


def test_palabras_primero_y_como_maximo_un_estructural_al_final(modelo_y_datos):
    pipeline, df = modelo_y_datos
    promedios = promedios_estructurales(pipeline, df)
    for texto, valores in [(TEXTO_PHISHING, (3, 0, 450)), (TEXTO_LEGITIMO, (8, 1, 1600))]:
        motivos = explicar(pipeline, texto, *valores, n=6, promedios=promedios)["motivos"]
        tipos = [m["tipo"] for m in motivos]
        assert tipos.count(ESTRUCTURAL) <= 1
        if ESTRUCTURAL in tipos:
            assert tipos[-1] == ESTRUCTURAL and set(tipos[:-1]) <= {PALABRA}


def test_etiquetas_de_palabra_y_estructurales(modelo_y_datos):
    pipeline, df = modelo_y_datos
    promedios = promedios_estructurales(pipeline, df)
    resultado = explicar(pipeline, TEXTO_PHISHING, 3, 0, 450, n=10, promedios=promedios)
    palabras = [m for m in resultado["motivos"] if m["tipo"] == PALABRA]
    assert palabras and all(m["etiqueta"] == f"Menciona «{m['termino']}»" for m in palabras)
    assert all(m["codigo"] == f"palabra:{m['termino']}" for m in palabras)
    # Sin adjuntos, por debajo del promedio y con coeficiente hacia legítimo en estos datos:
    # si sale un estructural de adjuntos, debe decir "No trae adjuntos".
    for m in resultado["motivos"]:
        if m["codigo"] == "estructura:n_adjuntos":
            assert m["etiqueta"] == "No trae adjuntos"


def test_etiquetas_especiales_para_prefijos_y_saludos_genericos():
    def etiqueta(termino):
        return _etiqueta({"tipo": PALABRA, "nombre": termino, "valor": 0.3}, None, {})

    assert etiqueta("re") == "El asunto es una respuesta (RE:)"
    assert etiqueta("rv") == etiqueta("fw") == etiqueta("fwd") == "El correo es un reenvío"
    assert etiqueta("cliente") == "Usa un saludo genérico («cliente»)"
    assert etiqueta("usuario") == "Usa un saludo genérico («usuario»)"
    assert etiqueta("paquete") == "Menciona «paquete»"
    assert etiqueta("estimado cliente") == "Menciona «estimado cliente»"  # solo términos sueltos


def test_motivo_re_lleva_su_etiqueta_especial():
    # Correos inventados donde todos los phishing empiezan con "re:": «re» pesa hacia phishing.
    df = correos_inventados()
    df.loc[df["etiqueta"] == "phishing", "texto"] = "re: " + df.loc[df["etiqueta"] == "phishing", "texto"]
    pipeline, _ = construir_modelos()["svm_lineal"]
    pipeline.fit(df[COLUMNAS_ENTRADA], df["etiqueta"])
    motivos = explicar(pipeline, "re: su paquete está detenido", 3, 0, 450, n=10)["motivos"]
    re_motivo = [m for m in motivos if m["termino"] == "re"]
    assert re_motivo and re_motivo[0]["etiqueta"] == "El asunto es una respuesta (RE:)"
    assert re_motivo[0]["codigo"] == "palabra:re"  # el código no cambia


def test_estructural_en_contra_no_se_muestra(modelo_y_datos):
    pipeline, df = modelo_y_datos
    promedios = promedios_estructurales(pipeline, df)
    base, lista = contribuciones(pipeline, TEXTO_PHISHING, 8, 1, 1600, promedios)
    en_contra = {i["nombre"] for i in lista if i["tipo"] == ESTRUCTURAL and i["contribucion"] < 0}
    resultado = explicar(pipeline, TEXTO_PHISHING, 8, 1, 1600, n=10, promedios=promedios)
    if resultado["clase"] == "phishing":
        mostrados = {m["termino"] for m in resultado["motivos"] if m["tipo"] == ESTRUCTURAL}
        assert not (mostrados & en_contra)


# ----- umbral de confianza -----


def test_calcular_umbral_sigue_los_tramos_con_mas_error_que_el_global():
    # Tramos de 0,25: [0;0,25) 2 de 4 mal, [0,25;0,5) 1 de 4 mal, [0,5;0,75) 0 de 4, [0,75;1) 0 de 8.
    puntajes = [0.1, -0.1, 0.2, -0.2, 0.3, -0.3, 0.4, -0.4, 0.6, -0.6, 0.7, -0.7] + [0.9, -0.9] * 4
    errores = [1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0] + [0, 0] * 4
    resultado = calcular_umbral(puntajes, errores)
    # Tasa global 3/20 = 0,15. Primer tramo 0,5 > 0,15; segundo 0,25 > 0,15; tercero 0 -> umbral 0,5.
    assert resultado["tasa_error_global"] == 0.15
    assert resultado["umbral"] == 0.5
    assert resultado["dudosos"]["correos"] == 8 and resultado["dudosos"]["errores"] == 3
    assert resultado["dudosos"]["porcentaje_de_los_errores"] == 1.0


def test_calcular_umbral_sin_errores_es_cero():
    resultado = calcular_umbral(np.array([0.1, -0.5, 1.2]), np.array([False, False, False]))
    assert resultado["umbral"] == 0.0 and resultado["dudosos"]["correos"] == 0


def test_calcular_umbral_se_detiene_en_el_primer_tramo_bueno():
    # Hay error lejos de 0, pero el tramo [0;0,25) no supera el global: umbral 0.
    resultado = calcular_umbral([0.1, 0.2, 0.3, 1.1], [0, 0, 0, 1])
    assert resultado["umbral"] == 0.0
