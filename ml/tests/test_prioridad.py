"""Pruebas de ml/sicae_ml/priority.py y ml/sicae_ml/evaluar_prioridad.py.

Correos inventados con email.message.EmailMessage (dominios example.com). Los .eml y el
CSV de etiquetas se escriben en carpetas temporales de pytest (tmp_path).
Correr desde la raíz:  .venv\\Scripts\\python -m pytest ml/tests -v
"""

import json
from email.message import EmailMessage

import pytest
from sklearn.metrics import cohen_kappa_score

from sicae_ml.evaluar_prioridad import evaluar, main
from sicae_ml.priority import (
    DESTINATARIO_UNICO,
    PUBLICIDAD,
    REMITENTE_IMPORTANTE,
    RESPUESTA,
    URGENCIA,
    RUTA_CONFIG,
    asignar_prioridad,
    cargar_config,
    ruta_config,
)


def config_prueba(tmp_path, **cambios):
    """Configuración con un remitente y un dominio importantes (y lo que se cambie)."""
    datos = {
        "remitentes_importantes": ["Jefa@Example.com"],
        "dominios_importantes": ["@uni.example.com"],
        "palabras_urgencia": ["vence", "fecha límite", "plazo", "urgente", "hoy", "mañana", "recordatorio"],
        "puntos": {"remitente_importante": 2, "urgencia": 1, "destinatario_unico": 1, "respuesta": 1},
        "umbrales": {"alta": 3, "media": 1},
    }
    datos.update(cambios)
    ruta = tmp_path / "prioridad.json"
    ruta.write_text(json.dumps(datos), encoding="utf-8")
    return cargar_config(ruta)


def correo(remitente="amigo@example.org", para="yo@example.org, otra@example.org",
           asunto="Hola", cuerpo="Texto", **cabeceras):
    """Por defecto no cumple ninguna regla: remitente cualquiera y dos destinatarios."""
    mensaje = EmailMessage()
    mensaje["From"] = remitente
    mensaje["To"] = para
    mensaje["Subject"] = asunto
    for nombre, valor in cabeceras.items():
        mensaje[nombre.replace("_", "-")] = valor
    mensaje.set_content(cuerpo)
    return mensaje


def prioridad(mensaje, config, es_publicidad=False):
    return asignar_prioridad(mensaje, mensaje["Subject"], mensaje.get_content(), config, es_publicidad)


# ----- una prueba por regla -----


def test_correo_sin_reglas_es_baja(tmp_path):
    assert prioridad(correo(), config_prueba(tmp_path)) == {"prioridad": "baja", "puntaje": 0, "motivos": []}


def test_remitente_importante_por_direccion_dominio_y_subdominio(tmp_path):
    config = config_prueba(tmp_path)
    for remitente in ["Jefa <jefa@example.com>", "profe@uni.example.com", "aviso@mail.uni.example.com"]:
        resultado = prioridad(correo(remitente=remitente), config)
        assert resultado["motivos"] == [REMITENTE_IMPORTANTE], remitente
        assert resultado["puntaje"] == 2
    # "otrauni.example.com" no es subdominio de "uni.example.com".
    assert prioridad(correo(remitente="x@otrauni.example.com"), config)["motivos"] == []


def test_urgencia_sin_tildes_ni_mayusculas_y_suma_una_vez(tmp_path):
    config = config_prueba(tmp_path)
    resultado = prioridad(correo(asunto="FECHA LIMITE", cuerpo="Entregar MAÑANA, es urgente"), config)
    assert resultado["motivos"] == [URGENCIA]
    assert resultado["puntaje"] == 1


def test_urgencia_solo_como_palabra_completa(tmp_path):
    assert prioridad(correo(cuerpo="Cuidado con el hoyo"), config_prueba(tmp_path))["motivos"] == []


def test_destinatario_unico(tmp_path):
    config = config_prueba(tmp_path)
    assert prioridad(correo(para="yo@example.org"), config)["motivos"] == [DESTINATARIO_UNICO]
    assert prioridad(correo(para="yo@example.org", Cc="otro@example.org"), config)["motivos"] == []
    assert prioridad(correo(para="yo@example.org", List_Id="<grupo.example.org>"), config)["motivos"] == []
    assert prioridad(correo(para="yo@example.org, otra@example.org"), config)["motivos"] == []


def test_respuesta_con_in_reply_to(tmp_path):
    resultado = prioridad(correo(In_Reply_To="<abc@example.org>"), config_prueba(tmp_path))
    assert resultado["motivos"] == [RESPUESTA] and resultado["puntaje"] == 1


# ----- umbrales -----


@pytest.mark.parametrize(
    "cambios, esperado",
    [
        ({}, ("baja", 0)),
        ({"cuerpo": "vence hoy"}, ("media", 1)),
        ({"cuerpo": "vence hoy", "In_Reply_To": "<a@example.org>"}, ("media", 2)),
        ({"remitente": "jefa@example.com", "cuerpo": "plazo"}, ("alta", 3)),
        ({"remitente": "jefa@example.com", "cuerpo": "plazo", "para": "yo@example.org",
          "In_Reply_To": "<a@example.org>"}, ("alta", 5)),
    ],
)
def test_umbrales_por_defecto(tmp_path, cambios, esperado):
    resultado = prioridad(correo(**cambios), config_prueba(tmp_path))
    assert (resultado["prioridad"], resultado["puntaje"]) == esperado


def test_umbrales_vienen_de_la_configuracion(tmp_path):
    mensaje = correo(cuerpo="urgente", In_Reply_To="<a@example.org>")  # puntaje 2
    assert prioridad(mensaje, config_prueba(tmp_path))["prioridad"] == "media"
    estricta = config_prueba(tmp_path, umbrales={"alta": 2, "media": 1})
    assert prioridad(mensaje, estricta)["prioridad"] == "alta"


def test_puntos_vienen_de_la_configuracion(tmp_path):
    config = config_prueba(tmp_path, puntos={"remitente_importante": 3, "urgencia": 1,
                                             "destinatario_unico": 1, "respuesta": 1})
    assert prioridad(correo(remitente="jefa@example.com"), config)["prioridad"] == "alta"


# ----- publicidad -----


def test_publicidad_siempre_es_baja(tmp_path):
    mensaje = correo(remitente="jefa@example.com", para="yo@example.org", cuerpo="vence hoy")
    resultado = prioridad(mensaje, config_prueba(tmp_path), es_publicidad=True)
    assert resultado["prioridad"] == "baja"
    assert resultado["puntaje"] == 4  # se calcula igual, para ver qué se ignoró
    assert resultado["motivos"][-1] == PUBLICIDAD


# ----- configuración -----


def test_config_real_carga_con_listas_vacias():
    # Ruta explícita: así la prueba no depende de si quien la corre tiene un archivo local.
    config = cargar_config(RUTA_CONFIG)
    assert config["remitentes_importantes"] == [] and config["dominios_importantes"] == []
    assert "manana" in config["palabras_urgencia"]
    assert config["umbrales"] == {"alta": 3, "media": 1}


def test_config_local_reemplaza_a_la_del_repositorio(tmp_path):
    base = json.loads(RUTA_CONFIG.read_text(encoding="utf-8"))
    (tmp_path / "prioridad.json").write_text(json.dumps(base), encoding="utf-8")

    # Sin archivo local: se usa el del repositorio (listas vacías).
    assert ruta_config(tmp_path).name == "prioridad.json"
    assert cargar_config(carpeta=tmp_path)["remitentes_importantes"] == []

    # Con archivo local: se usa ese, completo.
    local = {**base, "remitentes_importantes": ["Coordinacion@Uni.Example.com"]}
    (tmp_path / "prioridad.local.json").write_text(json.dumps(local), encoding="utf-8")
    assert ruta_config(tmp_path).name == "prioridad.local.json"
    config = cargar_config(carpeta=tmp_path)
    assert config["remitentes_importantes"] == ["coordinacion@uni.example.com"]
    assert prioridad(correo(remitente="coordinacion@uni.example.com"), config)["motivos"] == [REMITENTE_IMPORTANTE]


def test_config_sin_claves_falla(tmp_path):
    ruta = tmp_path / "mala.json"
    ruta.write_text(json.dumps({"umbrales": {"alta": 3, "media": 1}}), encoding="utf-8")
    with pytest.raises(AssertionError):
        cargar_config(ruta)


def test_config_con_umbrales_al_reves_falla(tmp_path):
    with pytest.raises(AssertionError):
        config_prueba(tmp_path, umbrales={"alta": 1, "media": 2})


# ----- evaluar_prioridad -----


def test_sin_archivos_termina_sin_error(tmp_path, capsys):
    assert evaluar(tmp_path / "no.csv", tmp_path / "normal") is None
    assert main(tmp_path / "no.csv", tmp_path / "normal", tmp_path / "r.json") is None
    assert "No hay datos para evaluar la prioridad" in capsys.readouterr().out
    assert not (tmp_path / "r.json").exists()


def test_evaluar_con_etiquetas_y_correos(tmp_path):
    config = config_prueba(tmp_path)
    carpeta = tmp_path / "normal"
    carpeta.mkdir()
    correos = {
        "a.eml": correo(remitente="jefa@example.com", asunto="Secreto A", cuerpo="vence hoy"),  # alta
        "b.eml": correo(asunto="Secreto B", cuerpo="urgente"),  # media
        "c.eml": correo(asunto="Secreto C"),  # baja
        "d.eml": correo(asunto="Secreto D"),  # baja, pero los evaluadores no coinciden
    }
    for nombre, mensaje in correos.items():
        (carpeta / nombre).write_bytes(mensaje.as_bytes())
    filas = [
        ("a.eml", "alta", "Alta"),
        ("b.eml", "media", "media"),
        ("c.eml", "media", " media "),  # consenso media, la regla dice baja -> error
        ("d.eml", "alta", "baja"),
        ("falta.eml", "baja", "baja"),  # consenso, pero el archivo no existe
    ]
    ruta_csv = tmp_path / "etiquetas.csv"
    ruta_csv.write_text(
        "archivo,evaluador_1,evaluador_2\n" + "".join(f"{a},{b},{c}\n" for a, b, c in filas),
        encoding="utf-8-sig",
    )

    ruta = tmp_path / "resultados.json"
    resultados = main(ruta_csv, carpeta, ruta, config)

    uno = ["alta", "media", "media", "alta", "baja"]
    dos = ["alta", "media", "media", "baja", "baja"]
    assert resultados["kappa_cohen"] == round(cohen_kappa_score(uno, dos, labels=["alta", "media", "baja"]), 4)
    assert resultados["configuracion"] == "proporcionada"
    assert resultados["etiquetas"] == {"filas": 5, "validas": 5, "invalidas": 0, "acuerdos": 4, "desacuerdos": 1}
    assert resultados["consenso_por_clase"] == {"alta": 1, "media": 2, "baja": 1}
    assert resultados["sin_archivo"] == 1 and resultados["evaluados"] == 3
    assert resultados["exactitud"] == round(2 / 3, 4)
    assert resultados["matriz_confusion"]["filas_real_columnas_predicho"] == [[1, 0, 0], [0, 1, 1], [0, 0, 0]]

    guardado = ruta.read_text(encoding="utf-8")
    assert json.loads(guardado) == resultados
    for prohibido in ["Secreto", ".eml", "example", "jefa"]:
        assert prohibido not in guardado


def test_etiquetas_invalidas_se_cuentan(tmp_path):
    carpeta = tmp_path / "normal"
    carpeta.mkdir()
    (carpeta / "a.eml").write_bytes(correo().as_bytes())
    ruta_csv = tmp_path / "etiquetas.csv"
    ruta_csv.write_text("archivo,evaluador_1,evaluador_2\na.eml,urgentísima,baja\n", encoding="utf-8")
    resultados = evaluar(ruta_csv, carpeta, config_prueba(tmp_path))
    assert resultados["etiquetas"]["invalidas"] == 1
    assert resultados["kappa_cohen"] is None and resultados["exactitud"] is None
