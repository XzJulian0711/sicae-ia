"""Pruebas del paso 6.4: herramientas/comparar_redaccion.py y resumir_redaccion.py.

Ollama y Gemini SIMULADOS (nunca se usa la red ni un modelo de verdad). Los casos son inventados.
Correr desde la raíz:  .venv\\Scripts\\python -m pytest api/tests/test_comparar_redaccion.py -v
"""

import csv
import json
import random
from pathlib import Path

import comparar_redaccion as comparar
import pytest
import resumir_redaccion as resumir
from conftest import ajustes_para as ajustes_api
from sklearn.metrics import cohen_kappa_score

from app import redaccion

RAIZ = Path(__file__).resolve().parents[2]
CLAVE_DEMO = "AIzaClaveDeGeminiInventadaParaPruebas000"
COLUMNAS = "id,asunto,cuerpo,indicacion,tono,inventado,ejemplo"


def escribir_casos(ruta, filas, columnas=COLUMNAS):
    ruta.write_text(columnas + "\n" + "\n".join(filas) + "\n", encoding="utf-8-sig")
    return ruta


def fila(id_caso, tono="formal", inventado="si", ejemplo="no", indicacion="Confirmar la entrega del 6 de octubre"):
    return f'{id_caso},Entrega del anteproyecto,"Se entrega el 10 de octubre a las 8.",{indicacion},{tono},{inventado},{ejemplo}'


# ---------------------------------------------------------------------------
# Casos: solo inventados
# ---------------------------------------------------------------------------


def test_lee_casos_e_ignora_los_ejemplos(tmp_path):
    ruta = escribir_casos(tmp_path / "casos.csv", [fila("ejemplo-1", ejemplo="si"), fila("c1"), fila("c2", tono="cordial")])
    casos, avisos = comparar.leer_casos(ruta)
    assert [c["id"] for c in casos] == ["c1", "c2"]
    assert casos[1]["tono"] == "cordial"
    assert avisos == ["Hay 2 casos (se esperaban 12). Se sigue igual."]


def test_doce_casos_sin_aviso(tmp_path):
    ruta = escribir_casos(tmp_path / "casos.csv", [fila(f"c{i}") for i in range(12)])
    assert comparar.leer_casos(ruta)[1] == []


def test_el_archivo_de_ejemplo_del_repo_es_valido_y_solo_trae_ejemplos():
    ruta = RAIZ / "evaluacion" / "redaccion" / "casos.csv"
    assert ruta.read_bytes().startswith(b"\xef\xbb\xbf"), "utf-8-sig"
    with pytest.raises(comparar.CasosInvalidos, match="no tiene casos"):
        comparar.leer_casos(ruta)  # solo trae las 2 filas de ejemplo: los casos los escribe el equipo
    with open(ruta, encoding="utf-8-sig", newline="") as archivo:
        filas = list(csv.DictReader(archivo))
    assert len(filas) == 2 and all(f["ejemplo"] == "si" and f["inventado"] == "si" for f in filas)


@pytest.mark.parametrize("filas, columnas, mensaje", [
    ([fila("c1")], "id,asunto,cuerpo,indicacion,tono,ejemplo", "INVENTADOS"),  # sin la columna inventado
    ([fila("c1", inventado="no")], COLUMNAS, "inventado debe ser «si»"),
    ([fila("c1", inventado="")], COLUMNAS, "inventado debe ser «si»"),
    ([fila("c1", tono="agresivo")], COLUMNAS, "formal, breve o cordial"),
    ([fila("c1"), fila("c1")], COLUMNAS, "repetido"),
    ([fila("c1", indicacion="x" * 501)], COLUMNAS, "1 a 500"),
])
def test_se_niega_si_los_casos_no_cumplen(tmp_path, filas, columnas, mensaje):
    if "inventado" not in columnas:
        filas = [f.rsplit(",", 2)[0] + ",no" for f in filas]  # quita la columna inventado
    ruta = escribir_casos(tmp_path / "casos.csv", filas, columnas)
    with pytest.raises(comparar.CasosInvalidos, match=mensaje):
        comparar.leer_casos(ruta)


# ---------------------------------------------------------------------------
# Revisiones automáticas
# ---------------------------------------------------------------------------


def test_espanol():
    assert comparar.parece_espanol("Buenos días. Les confirmamos la entrega del anteproyecto. Quedamos atentos.")
    assert not comparar.parece_espanol("Dear team, thank you for the reminder. We will submit it on time. Best regards.")


@pytest.mark.parametrize("texto, una", [
    ("Buenos días.\n\nConfirmamos la entrega.\n\nCordialmente,", True),
    ("Opción 1:\nHola...\n\nOpción 2:\nBuenas...", False),
    ("**Versión 2**\nHola", False),
    ("Hola\n---\nOtra cosa", False),
    ("Aquí tienes un borrador: Hola, confirmo.", False),
    ("Asunto: Re: hola\nHola\nAsunto: Re: hola\nOtra", False),
])
def test_una_sola_version(texto, una):
    assert comparar.una_sola_version(texto) is una


def test_datos_nuevos_frente_al_correo_y_la_indicacion():
    fuente_correo = "Se entrega el 10 de octubre a las 8."
    indicacion = "Confirmar que entregamos el 6 de octubre"
    borrador = "Confirmamos la entrega el 6 de octubre a las 8:30. La sustentación será el 15 de noviembre, un miércoles."
    assert comparar.datos_nuevos(borrador, fuente_correo, indicacion) == ["30", "15", "noviembre", "miercoles"]
    assert comparar.datos_nuevos("Entregamos el 06 de Octubre.", fuente_correo, indicacion) == [], "06 = 6; mayúsculas"


def test_revision_y_su_texto():
    caso = {"asunto": "Entrega", "cuerpo": "El 10 de octubre", "indicacion": "Confirmar"}
    revision = comparar.revisar("Confirmamos el 12 de octubre. Opción 2: otra cosa", caso, 1)
    assert revision == {"espanol": True, "una_version": False, "enlaces_quitados": 1, "posible_dato_inventado": ["12", "2"]}
    assert comparar.una_sola_version("Adjunto la versión 2 del documento."), "en prosa no es otra versión"
    texto = comparar.texto_revision(revision)
    assert "posible dato inventado: 12, 2" in texto and "1 enlaces nuevos" in texto and "más de una versión" in texto
    ingles = comparar.revisar("Dear team, thank you. We will be there. Best regards.", caso, 0)
    assert "no parece español" in comparar.texto_revision(ingles)


# ---------------------------------------------------------------------------
# Generación con el MISMO código que /redactar, frío y caliente
# ---------------------------------------------------------------------------


class OllamaYGeminiFalsos:
    """Hace de Ollama (generate, ps, chat) y de Gemini. Anota todo lo que se pide."""

    def __init__(self, texto="Buenos días. Les confirmamos la entrega del 6 de octubre. Cordialmente,",
                 ps_veces_cargado=0, gemini_429=0):
        self.texto = texto
        self.llamadas = []
        self.cargados = set()
        self.ps_veces_cargado = ps_veces_cargado
        self.gemini_429 = gemini_429

    def __call__(self, url, cuerpo, cabeceras, tiempo, sin_proxy):
        self.llamadas.append({"url": url, "cuerpo": json.loads(json.dumps(cuerpo)), "cabeceras": dict(cabeceras)})
        if url.endswith("/api/generate"):
            assert cuerpo == {"model": cuerpo["model"], "keep_alive": 0}
            return 200, "{}"
        if url.endswith("/api/chat"):
            self.cargados.add(cuerpo["model"])
            return 200, json.dumps({"message": {"role": "assistant", "content": self.texto}})
        if url == redaccion.URL_GEMINI:
            if self.gemini_429:
                self.gemini_429 -= 1
                return 429, "{}"
            return 200, json.dumps({"choices": [{"message": {"content": self.texto}}]})
        raise AssertionError(f"URL inesperada: {url}")

    def leer_ps(self, url, tiempo):
        self.llamadas.append({"url": url, "cuerpo": None, "cabeceras": {}})
        if self.ps_veces_cargado:
            self.ps_veces_cargado -= 1
            return ["gemma4:e2b", "gemma4:e4b"]
        return []


class Reloj:
    def __init__(self):
        self.t = 100.0

    def __call__(self):
        self.t += 0.5  # cada lectura avanza medio segundo
        return self.t


CASOS = [{"id": "c1", "asunto": "Entrega del anteproyecto", "cuerpo": "Se entrega el 10 de octubre. Escriban a coord@uni.example.edu",
          "indicacion": "Confirmar que entregamos el 6 de octubre", "tono": "formal"},
         {"id": "c2", "asunto": "Almuerzo", "cuerpo": "¿Almorzamos el viernes?", "indicacion": "Aceptar", "tono": "cordial"}]


def correr(falso, sistemas=("gemma4:e2b",), **cambios):
    ajustes = ajustes_api(Path("."), demo_api_key=CLAVE_DEMO, **cambios)
    esperas, avisos = [], []
    filas = comparar.comparar(CASOS, list(sistemas), ajustes, transporte=falso, leer_ps=falso.leer_ps,
                              esperar=esperas.append, reloj=Reloj(), pausa_gemini=4, avisar=avisos.append)
    return filas, esperas, avisos, ajustes


def test_usa_exactamente_los_mensajes_de_redactar():
    falso = OllamaYGeminiFalsos()
    _, _, _, ajustes = correr(falso, sistemas=("gemma4:e4b",))
    chats = [ll for ll in falso.llamadas if ll["url"].endswith("/api/chat")]
    entrada = comparar.entrada_de(CASOS[0], comparar.ajustes_para(ajustes, "gemma4:e4b"), demo=False)
    esperados, _ = redaccion.armar_mensajes(entrada, False, ajustes.ia_max_cuerpo)
    assert chats[0]["cuerpo"]["messages"] == esperados, "el mismo mensaje de sistema y de usuario que /redactar"
    assert chats[0]["cuerpo"]["think"] is False and chats[0]["cuerpo"]["model"] == "gemma4:e4b"


def test_el_script_no_copia_el_codigo_de_la_api():
    codigo = (RAIZ / "herramientas" / "comparar_redaccion.py").read_text(encoding="utf-8")
    assert "redaccion.redactar(entrada, demo, ajustes, transporte)" in codigo
    assert "from app import redaccion" in codigo
    for copia in ("Eres un asistente", "<<<CORREO>>>", "def mensaje_sistema", "def limpiar_borrador"):
        assert copia not in codigo, copia


def test_frio_y_caliente_por_caso_para_un_modelo_local():
    falso = OllamaYGeminiFalsos()
    filas, _, avisos, _ = correr(falso)
    secuencia = [ll["url"].rsplit("/", 1)[-1] for ll in falso.llamadas]
    # Por caso: descargar (keep_alive 0) → confirmar (/api/ps) → frío → caliente.
    assert secuencia == ["generate", "ps", "chat", "chat"] * 2
    assert all(f["frio_confirmado"] and f["exitoso"] for f in filas)
    assert all(f["segundos_frio"] > 0 and f["segundos_caliente"] > 0 for f in filas)
    assert filas[0]["borrador"].startswith("Buenos días")
    assert len(avisos) == 2 and all("caso" in a and "Buenos" not in a for a in avisos), "solo el avance"


def test_espera_a_que_ps_confirme_la_descarga():
    falso = OllamaYGeminiFalsos(ps_veces_cargado=2)
    filas, esperas, _, _ = correr(falso)
    assert filas[0]["frio_confirmado"] is True
    assert esperas[:2] == [1, 1], "pregunta otra vez cada segundo"


def test_si_ps_nunca_confirma_el_frio_queda_sin_confirmar():
    falso = OllamaYGeminiFalsos(ps_veces_cargado=10_000)
    filas, _, _, _ = correr(falso)
    assert filas[0]["frio_confirmado"] is False


def test_gemini_dos_llamadas_pausa_y_reintento_del_429():
    falso = OllamaYGeminiFalsos(gemini_429=1)
    filas, esperas, _, _ = correr(falso, sistemas=("gemini-3.5-flash-lite",))
    gemini = [ll for ll in falso.llamadas if ll["url"] == redaccion.URL_GEMINI]
    assert len(gemini) == 5, "2 por caso + 1 reintento"
    assert comparar.ESPERA_LIMITE_GEMINI_S in esperas and 4 in esperas
    assert all(f["exitoso"] and f["proveedor"] == "demostracion" and f["frio_confirmado"] is False for f in filas)
    assert not any(ll["url"].endswith(("/api/generate", "/api/ps")) for ll in falso.llamadas)
    enviado = json.dumps([ll["cuerpo"] for ll in gemini], ensure_ascii=False)
    assert "@" not in enviado, "el mismo enmascarado que /redactar"


def test_un_fallo_se_anota_y_se_sigue():
    class SinModelo(OllamaYGeminiFalsos):
        def __call__(self, url, cuerpo, cabeceras, tiempo, sin_proxy):
            if url.endswith("/api/chat"):
                self.llamadas.append({"url": url, "cuerpo": cuerpo, "cabeceras": {}})
                return 404, "{}"
            return super().__call__(url, cuerpo, cabeceras, tiempo, sin_proxy)

    filas, _, avisos, _ = correr(SinModelo())
    assert [f["exitoso"] for f in filas] == [False, False]
    assert filas[0]["error"] == "modelo_no_descargado"
    assert "error: modelo_no_descargado" in avisos[0]


# ---------------------------------------------------------------------------
# Salidas a ciegas
# ---------------------------------------------------------------------------


def leer(ruta):
    with open(ruta, encoding="utf-8-sig", newline="") as archivo:
        return list(csv.DictReader(archivo))


def test_salidas_a_ciegas_y_la_clave_aparte(tmp_path):
    falso = OllamaYGeminiFalsos()
    filas, _, _, _ = correr(falso, sistemas=("gemma4:e2b", "gemma4:e4b", "gemini-3.5-flash-lite"))
    filas[1]["exitoso"], filas[1]["error"] = False, "tiempo_agotado"  # uno fallido
    filas[1].pop("borrador"), filas[1].pop("revision")
    rutas = comparar.escribir_resultados(filas, tmp_path, aleatorio=random.Random(7))
    for ruta in rutas.values():
        assert ruta.read_bytes().startswith(b"\xef\xbb\xbf"), f"{ruta.name}: utf-8-sig"

    borradores, clave, por_llenar = leer(rutas["borradores"]), leer(rutas["clave"]), leer(rutas["calificacion_por_llenar"])
    assert list(borradores[0]) == comparar.COLUMNAS_BORRADORES
    assert not {"sistema", "proveedor", "segundos_frio", "segundos_caliente", "modelo"} & set(borradores[0])
    contenido = rutas["borradores"].read_text(encoding="utf-8-sig")
    for nombre in comparar.SISTEMAS:
        assert nombre not in contenido, "a ciegas: el nombre del sistema no aparece"
    assert len(clave) == 6 and len(borradores) == 5, "el fallido queda solo en la clave"
    codigos = [c["codigo"] for c in clave]
    assert len(set(codigos)) == 6 and all(len(c) == 6 and set(c) <= set(comparar.ALFABETO_CODIGO) for c in codigos)
    assert {b["codigo"] for b in borradores} <= set(codigos)
    assert {c["sistema"] for c in clave} == set(comparar.SISTEMAS)
    assert len(por_llenar) == 10 and {p["evaluador"] for p in por_llenar} == {"A", "B"}


def test_no_pisa_resultados_sin_sobrescribir(tmp_path):
    falso = OllamaYGeminiFalsos()
    filas, _, _, _ = correr(falso)
    comparar.escribir_resultados(filas, tmp_path)
    with pytest.raises(FileExistsError, match="--sobrescribir"):
        comparar.escribir_resultados(filas, tmp_path)
    comparar.escribir_resultados(filas, tmp_path, sobrescribir=True)


def test_main_se_niega_con_casos_no_inventados_y_salta_gemini_sin_clave(tmp_path, capsys):
    ruta = escribir_casos(tmp_path / "casos.csv", [fila("c1", inventado="no")])
    assert comparar.main(["--casos", str(ruta), "--salida", str(tmp_path / "r")]) == 2
    assert "inventados" in capsys.readouterr().out

    ruta = escribir_casos(tmp_path / "casos2.csv", [fila("c1")])
    falso = OllamaYGeminiFalsos()
    sin_clave = ajustes_api(Path("."))
    codigo = comparar.main(["--casos", str(ruta), "--salida", str(tmp_path / "r"), "--pausa-gemini", "0"],
                           ajustes=sin_clave, transporte=falso, leer_ps=falso.leer_ps, esperar=lambda s: None,
                           reloj=Reloj(), avisar=lambda m: None)
    salida = capsys.readouterr().out
    assert codigo == 0 and "se salta Gemini" in salida
    assert not any(ll["url"] == redaccion.URL_GEMINI for ll in falso.llamadas)
    assert {c["sistema"] for c in leer(tmp_path / "r" / "clave.csv")} == {"gemma4:e2b", "gemma4:e4b"}


# ---------------------------------------------------------------------------
# Resumen
# ---------------------------------------------------------------------------


def escribir_clave(ruta, filas):
    with open(ruta, "w", encoding="utf-8-sig", newline="") as archivo:
        escritor = csv.DictWriter(archivo, fieldnames=comparar.COLUMNAS_CLAVE)
        escritor.writeheader()
        escritor.writerows(filas)
    return ruta


def fila_clave(codigo, sistema, frio, caliente, exitoso="si", dato="", proveedor="ollama"):
    return {"codigo": codigo, "caso_id": "c", "sistema": sistema, "proveedor": proveedor, "segundos_frio": frio,
            "segundos_caliente": caliente, "frio_confirmado": "si" if proveedor == "ollama" else "no",
            "exitoso": exitoso, "error": "" if exitoso == "si" else "tiempo_agotado", "espanol": "si",
            "una_version": "si", "enlaces_quitados": 0, "posible_dato_inventado": dato}


def escribir_calificaciones(ruta, filas):
    with open(ruta, "w", encoding="utf-8-sig", newline="") as archivo:
        escritor = csv.DictWriter(archivo, fieldnames=comparar.COLUMNAS_CALIFICACION)
        escritor.writeheader()
        escritor.writerows(filas)
    return ruta


def calif(codigo, evaluador, calidad, cumple="si", tono="si", dato="no", comentario=""):
    return {"codigo": codigo, "evaluador": evaluador, "cumple_indicacion": cumple, "tono_correcto": tono,
            "dato_inventado": dato, "calidad_1a5": calidad, "comentario": comentario}


def test_estadistica_basica():
    assert resumir.mediana([3, 1, 2, None]) == 2
    assert resumir.mediana([]) is None
    assert resumir.porcentaje(1, 3) == 33.3 and resumir.porcentaje(0, 0) is None
    assert resumir.media_desviacion([2, 4, 4, 4, 5, 5, 7, 9]) == (5.0, 2.14)
    assert resumir.media_desviacion([3]) == (3.0, None)


def test_kappa_ponderado_igual_a_un_calculo_a_mano():
    # 4 pares: (1,1) (2,3) (3,3) (5,4). Kappa ponderado cuadrático calculado a mano = 0,85.
    calificaciones = [calif(c, "A", a) | {"calidad": a} for c, a in zip("wxyz", [1, 2, 3, 5], strict=True)] + \
                     [calif(c, "B", b) | {"calidad": b} for c, b in zip("wxyz", [1, 3, 3, 4], strict=True)]
    kappa, pares = resumir.kappa_ponderado(calificaciones, ["A", "B"])
    assert pares == 4
    assert kappa == pytest.approx(0.85, abs=0.005)
    assert kappa == round(cohen_kappa_score([1, 2, 3, 5], [1, 3, 3, 4], labels=[1, 2, 3, 4, 5], weights="quadratic"), 3)
    assert resumir.kappa_ponderado(calificaciones, ["A"]) == (None, 0), "con un solo evaluador no hay kappa"


def test_resumen_completo_sin_textos(tmp_path):
    clave = escribir_clave(tmp_path / "clave.csv", [
        fila_clave("AAA111", "gemma4:e2b", 10.0, 1.0, dato="15"),
        fila_clave("BBB222", "gemma4:e2b", 14.0, 3.0),
        fila_clave("CCC333", "gemma4:e2b", "", "", exitoso="no"),
        fila_clave("DDD444", "gemini-3.5-flash-lite", 2.0, 2.4, proveedor="demostracion"),
    ])
    secreto = "COMENTARIO-SECRETO con texto del borrador"
    archivo_a = escribir_calificaciones(tmp_path / "a.csv", [
        calif("AAA111", "A", 4, comentario=secreto), calif("BBB222", "A", 2, cumple="no", dato="si"),
        calif("DDD444", "A", 5)])
    archivo_b = escribir_calificaciones(tmp_path / "b.csv", [
        calif("AAA111", "B", 5), calif("BBB222", "B", 2, cumple="no"), calif("DDD444", "B", 5),
        {"codigo": "AAA111", "evaluador": "C", "cumple_indicacion": "", "tono_correcto": "", "dato_inventado": "",
         "calidad_1a5": "", "comentario": ""}])  # fila sin calificar: se ignora
    assert resumir.main(["--clave", str(clave), "--calificaciones", str(archivo_a), str(archivo_b),
                         "--salida", str(tmp_path / "reportes")]) == 0

    datos = json.loads((tmp_path / "reportes" / "redaccion.json").read_text(encoding="utf-8"))
    e2b = datos["sistemas"]["gemma4:e2b"]
    assert (e2b["borradores"], e2b["fallidos"]) == (3, 1)
    assert (e2b["segundos_frio_mediana"], e2b["segundos_caliente_mediana"]) == (12.0, 2.0)
    assert e2b["cumple_indicacion_pct"] == 50.0 and e2b["dato_inventado_pct"] == 25.0
    assert e2b["posible_dato_inventado_auto_pct"] == 50.0
    assert (e2b["calidad_media"], e2b["calidad_desviacion"]) == (3.25, 1.5)
    gemini = datos["sistemas"]["gemini-3.5-flash-lite"]
    assert gemini["segundos_frio_mediana"] is None and gemini["segundos_caliente_mediana"] is None
    assert gemini["segundos_respuesta_mediana"] == 2.4
    assert datos["evaluadores"] == 2 and datos["calificaciones"] == 6

    tabla = (tmp_path / "reportes" / "redaccion.md").read_text(encoding="utf-8")
    assert "| gemma4:e2b | 12,0 s | 2,0 s | 50,0 % |" in tabla
    assert "no aplica (2,4 s de respuesta)" in tabla
    for texto in (secreto, "COMENTARIO", "Entrega"):
        assert texto not in tabla and texto not in json.dumps(datos, ensure_ascii=False), "solo números"


@pytest.mark.parametrize("cambio, mensaje", [
    ({"cumple_indicacion": "tal vez"}, "«si» o «no»"),
    ({"calidad_1a5": "6"}, "de 1 a 5"),
    ({"calidad_1a5": "3.5"}, "de 1 a 5"),
    ({"codigo": "ZZZ999"}, "no está en la clave"),
    ({"evaluador": ""}, "falta el evaluador"),
])
def test_calificaciones_invalidas(tmp_path, cambio, mensaje):
    clave = resumir.leer_clave(escribir_clave(tmp_path / "clave.csv", [fila_clave("AAA111", "gemma4:e2b", 1, 1)]))
    archivo = escribir_calificaciones(tmp_path / "a.csv", [calif("AAA111", "A", 4) | cambio])
    with pytest.raises(resumir.CalificacionInvalida, match=mensaje):
        resumir.leer_calificaciones([archivo], clave)


def test_calificacion_repetida(tmp_path):
    clave = resumir.leer_clave(escribir_clave(tmp_path / "clave.csv", [fila_clave("AAA111", "gemma4:e2b", 1, 1)]))
    archivo = escribir_calificaciones(tmp_path / "a.csv", [calif("AAA111", "A", 4), calif("AAA111", "A", 3)])
    with pytest.raises(resumir.CalificacionInvalida, match="ya calificó"):
        resumir.leer_calificaciones([archivo], clave)


def test_la_plantilla_de_calificacion_del_repo():
    ruta = RAIZ / "evaluacion" / "redaccion" / "calificacion.csv"
    assert ruta.read_bytes().startswith(b"\xef\xbb\xbf")
    with open(ruta, encoding="utf-8-sig", newline="") as archivo:
        lector = csv.DictReader(archivo)
        assert lector.fieldnames == comparar.COLUMNAS_CALIFICACION
        assert list(lector) == [], "solo los encabezados"
