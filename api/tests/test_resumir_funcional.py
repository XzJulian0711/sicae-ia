"""Pruebas del paso 7.1: herramientas/resumir_funcional.py y la plantilla de la prueba funcional.

Todos los casos son INVENTADOS. Ningún nombre de integrante se escribe aquí: la prueba de la
plantilla los lee de README.md cuando corre.
Correr desde la raíz:  .venv\\Scripts\\python -m pytest api/tests/test_resumir_funcional.py -v
"""

import csv
import json
import re

import pytest
import resumir_funcional as funcional

RAIZ = funcional.RAIZ
ASUNTO_SECRETO = "Asunto inventado QZX-ÚNICO"
OBSERVACION_SECRETA = "Observación inventada WKP-ÚNICA"


def caso(id_caso, autor, esperado, obtenido, confianza="alta", prioridad="media",
         asunto_ok="si", remitente_ok="si", cuerpo_ok="si", motivos="4"):
    if obtenido == "phishing" and prioridad == "media":
        prioridad = ""  # el panel no le da prioridad a un phishing
    return {"id": id_caso, "autor": autor, "asunto": ASUNTO_SECRETO, "esperado": esperado,
            "obtenido": obtenido, "confianza": confianza, "prioridad": prioridad,
            "asunto_ok": asunto_ok, "remitente_ok": remitente_ok, "cuerpo_ok": cuerpo_ok,
            "motivos_claros_1a5": motivos, "observacion": OBSERVACION_SECRETA}


# 7 casos llenos + 1 sin analizar. Resultados esperados calculados a mano (ver cada prueba).
CASOS = [
    caso("caso-zz-01", "Integrante 1", "phishing", "phishing"),                                   # VP
    caso("caso-zz-02", "Integrante 1", "phishing", "legitimo", confianza="dudosa",
         remitente_ok="parcial", motivos="2"),                                                    # FN
    caso("caso-zz-03", "Integrante 2", "legitimo", "legitimo", prioridad="alta",
         cuerpo_ok="parcial", motivos="5"),
    caso("caso-zz-04", "Integrante 2", "legitimo", "phishing", confianza="dudosa",
         asunto_ok="no", motivos="3"),                                                            # FP
    caso("caso-zz-05", "Integrante 3", "legitimo", "legitimo", confianza="dudosa",
         prioridad="baja", motivos=""),                                                           # sin motivos
    caso("caso-zz-06", "Boletín", "publicidad", "publicidad", prioridad="baja", cuerpo_ok="parcial"),
    caso("caso-zz-07", "boletin", "publicidad", "legitimo"),                                      # sin tilde
    {**dict.fromkeys(funcional.COLUMNAS, ""), "id": "caso-zz-08", "autor": "Integrante 3",
     "asunto": ASUNTO_SECRETO},                                                                   # sin analizar
]


def escribir(ruta, filas, columnas=funcional.COLUMNAS):
    with open(ruta, "w", encoding="utf-8-sig", newline="") as archivo:
        escritor = csv.DictWriter(archivo, fieldnames=columnas)
        escritor.writeheader()
        escritor.writerows(filas)
    return ruta


@pytest.fixture
def filas(tmp_path):
    return funcional.leer_resultados(escribir(tmp_path / "resultados.csv", CASOS))


# ---------------------------------------------------------------------------
# La plantilla del repo: sin nombres reales ni direcciones de correo
# ---------------------------------------------------------------------------


def nombres_de_integrantes():
    """Las palabras de los nombres de la sección "## Integrantes" del README (se leen al correr)."""
    texto = (RAIZ / "README.md").read_text(encoding="utf-8")
    seccion = texto.split("## Integrantes", 1)[1].split("\n## ", 1)[0]
    palabras = set()
    for linea in seccion.splitlines():
        if linea.strip().startswith("- "):
            palabras |= {p.lower() for p in linea.strip()[2:].split() if len(p) > 3}
    return palabras


def test_la_plantilla_del_repo_tiene_los_encabezados_y_un_solo_bom():
    ruta = RAIZ / "evaluacion" / "funcional" / "resultados.csv"
    crudo = ruta.read_bytes()
    assert crudo.startswith(b"\xef\xbb\xbf") and crudo.count(b"\xef\xbb\xbf") == 1
    with open(ruta, encoding="utf-8-sig", newline="") as archivo:
        assert next(csv.reader(archivo)) == funcional.COLUMNAS
    funcional.leer_resultados(ruta)  # vacía o llena, debe ser válida


def test_la_plantilla_del_repo_no_tiene_nombres_reales_ni_direcciones():
    ruta = RAIZ / "evaluacion" / "funcional" / "resultados.csv"
    texto = ruta.read_text(encoding="utf-8-sig")
    assert "@" not in texto
    assert "Recibidos" not in texto and "para mí" not in texto.lower()

    nombres = nombres_de_integrantes()
    assert nombres, "no se encontró la sección Integrantes del README"
    palabras = set(re.findall(r"\w+", texto.lower()))
    assert not nombres & palabras, "resultados.csv tiene el nombre de un integrante"

    with open(ruta, encoding="utf-8-sig", newline="") as archivo:
        for fila in csv.DictReader(archivo):
            if any((v or "").strip() for v in fila.values()):
                assert funcional._autor(fila["autor"] or "") in funcional.AUTORES, fila["autor"]


# ---------------------------------------------------------------------------
# Lectura y validación
# ---------------------------------------------------------------------------


def test_salta_las_filas_sin_analizar_y_no_guarda_asunto_ni_observacion(filas):
    assert len(filas) == 7
    assert all("asunto" not in f and "observacion" not in f and "id" not in f for f in filas)
    assert filas[6]["autor"] == "Boletín"  # "boletin" sin tilde se acepta
    assert filas[4]["motivos"] is None  # motivos es opcional
    assert filas[0]["prioridad"] is None  # phishing sin prioridad


@pytest.mark.parametrize("cambio, mensaje", [
    ({"autor": "Juana"}, "autor"),
    ({"esperado": "spam"}, "esperado"),
    ({"obtenido": "Legítimo"}, "obtenido"),
    ({"confianza": "baja"}, "confianza"),
    ({"asunto_ok": "tal vez"}, "asunto_ok"),
    ({"cuerpo_ok": ""}, "cuerpo_ok"),
    ({"motivos_claros_1a5": "6"}, "motivos_claros_1a5"),
    ({"motivos_claros_1a5": "3,5"}, "motivos_claros_1a5"),
    ({"prioridad": "urgente"}, "prioridad"),
    ({"prioridad": ""}, "prioridad"),
    ({"id": ""}, "id"),
])
def test_rechaza_valores_invalidos(tmp_path, cambio, mensaje):
    ruta = escribir(tmp_path / "r.csv", [{**caso("caso-zz-01", "Integrante 1", "legitimo", "legitimo"), **cambio}])
    with pytest.raises(funcional.ResultadoInvalido, match=mensaje):
        funcional.leer_resultados(ruta)


def test_rechaza_un_phishing_con_prioridad(tmp_path):
    fila = {**caso("caso-zz-01", "Integrante 1", "phishing", "phishing"), "prioridad": "alta"}
    with pytest.raises(funcional.ResultadoInvalido, match="phishing no lleva prioridad"):
        funcional.leer_resultados(escribir(tmp_path / "r.csv", [fila]))


def test_rechaza_ids_repetidos(tmp_path):
    repetido = caso("caso-zz-01", "Integrante 1", "legitimo", "legitimo")
    with pytest.raises(funcional.ResultadoInvalido, match="repetido"):
        funcional.leer_resultados(escribir(tmp_path / "r.csv", [repetido, repetido]))


def test_rechaza_encabezados_distintos(tmp_path):
    columnas = [c if c != "esperado" else "real" for c in funcional.COLUMNAS]
    with pytest.raises(funcional.ResultadoInvalido, match="encabezados"):
        funcional.leer_resultados(escribir(tmp_path / "r.csv", [], columnas))


def test_acepta_mayusculas_en_los_valores(tmp_path):
    fila = {**caso("caso-zz-01", "INTEGRANTE 2", "Legitimo", "LEGITIMO"), "confianza": "Dudosa", "cuerpo_ok": "Parcial"}
    [leida] = funcional.leer_resultados(escribir(tmp_path / "r.csv", [fila]))
    assert (leida["autor"], leida["obtenido"], leida["confianza"], leida["cuerpo_ok"]) == (
        "Integrante 2", "legitimo", "dudosa", "parcial")


# ---------------------------------------------------------------------------
# Métricas, con resultados calculados a mano
# ---------------------------------------------------------------------------


def test_matriz_de_confusion_y_exactitud(filas):
    resultado = funcional.matriz_confusion(filas)
    assert resultado["etiquetas"] == ["legitimo", "publicidad", "phishing"]
    # filas = esperado, columnas = obtenido
    assert resultado["matriz"] == [[2, 0, 1],   # legítimo: 03 y 05 bien, 04 → phishing
                                   [1, 1, 0],   # publicidad: 06 bien, 07 → legítimo
                                   [1, 0, 1]]   # phishing: 01 bien, 02 → legítimo
    assert resultado["exactitud"] == 0.571  # 4 de 7


def test_phishing_contra_no_phishing(filas):
    assert funcional.phishing_binario(filas) == {
        "vp": 1, "fp": 1, "fn": 1, "vn": 4, "precision": 0.5, "recall": 0.5, "f1": 0.5}


def test_sin_ningun_phishing_las_metricas_quedan_vacias(filas):
    sin_phishing = [f for f in filas if "phishing" not in (f["esperado"], f["obtenido"])]
    resultado = funcional.phishing_binario(sin_phishing)
    assert (resultado["vp"], resultado["fp"], resultado["fn"]) == (0, 0, 0)
    assert resultado["precision"] is None and resultado["recall"] is None and resultado["f1"] is None


def test_lectura_del_correo(filas):
    assert funcional.lectura(filas) == {
        "asunto": {"si": 6, "parcial": 0, "no": 1, "correcta_pct": 85.7},
        "remitente": {"si": 6, "parcial": 1, "no": 0, "correcta_pct": 85.7},
        "cuerpo": {"si": 5, "parcial": 2, "no": 0, "correcta_pct": 71.4},
    }


def test_dudosas_y_sus_errores(filas):
    assert funcional.dudosas(filas) == {
        "dudosas": 3, "dudosas_pct": 42.9, "errores_en_dudosas": 2, "altas": 4, "errores_en_altas": 1}


def test_boletines(filas):
    assert funcional.boletines(filas) == {"casos": 2, "como_publicidad": 1, "como_publicidad_pct": 50.0}


def test_aciertos_por_autor(filas):
    assert funcional.por_autor(filas) == {
        "Integrante 1": {"casos": 2, "aciertos": 1, "aciertos_pct": 50.0},
        "Integrante 2": {"casos": 2, "aciertos": 1, "aciertos_pct": 50.0},
        "Integrante 3": {"casos": 1, "aciertos": 1, "aciertos_pct": 100.0},
        "Boletín": {"casos": 2, "aciertos": 1, "aciertos_pct": 50.0},
    }


def test_motivos_claros_media_y_desviacion(filas):
    # 4, 2, 5, 3, 4, 4 (el caso 05 no tiene): media 3,67; desviación muestral 1,03
    assert funcional.motivos(filas) == {"casos": 6, "media": 3.67, "desviacion": 1.03}


# ---------------------------------------------------------------------------
# main: los dos archivos, solo números, con la advertencia
# ---------------------------------------------------------------------------


def test_main_escribe_el_reporte_solo_con_numeros(tmp_path, capsys):
    salida = tmp_path / "reportes"
    assert funcional.main(["--resultados", str(escribir(tmp_path / "r.csv", CASOS)), "--salida", str(salida)]) == 0

    resumen = json.loads((salida / "resumen.json").read_text(encoding="utf-8"))
    tabla = (salida / "tabla.md").read_text(encoding="utf-8")
    assert resumen["casos"] == 7
    assert "Muestra pequeña (7 correos)" in resumen["advertencia"]
    assert "No es una estimación del desempeño del modelo" in resumen["advertencia"]
    assert tabla.index("Advertencia") < tabla.index("Matriz de confusión")  # la advertencia, al inicio
    assert "| **legitimo** (3) | 2 | 0 | 1 |" in tabla

    for texto in (json.dumps(resumen, ensure_ascii=False), tabla):
        assert "QZX" not in texto and "WKP" not in texto  # ni asuntos ni observaciones
        assert "caso-zz" not in texto  # ni el id de cada caso
    assert "Aviso: Muestra pequeña" in capsys.readouterr().out


def test_main_con_la_plantilla_vacia_no_escribe_nada(tmp_path, capsys):
    salida = tmp_path / "reportes"
    assert funcional.main(["--resultados", str(escribir(tmp_path / "r.csv", [CASOS[-1]])), "--salida", str(salida)]) == 0
    assert not salida.exists()
    assert "Todavía no hay casos llenos" in capsys.readouterr().out


def test_main_con_un_dato_invalido_devuelve_2(tmp_path, capsys):
    malo = {**caso("caso-zz-01", "Integrante 1", "legitimo", "legitimo"), "esperado": "spam"}
    salida = tmp_path / "reportes"
    assert funcional.main(["--resultados", str(escribir(tmp_path / "r.csv", [malo])), "--salida", str(salida)]) == 2
    assert not salida.exists()
    assert "fila 2" in capsys.readouterr().out
