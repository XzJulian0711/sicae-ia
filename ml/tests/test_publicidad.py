"""Pruebas de ml/src/publicidad.py y ml/src/evaluar_publicidad.py.

Los correos son inventados con email.message.EmailMessage (dominios example.com).
Los .eml se escriben en carpetas temporales de pytest (tmp_path), nunca en el proyecto.
Correr desde la raíz:  .venv\\Scripts\\python -m pytest ml/tests -v
"""

import json

from email.message import EmailMessage

from src.evaluar_publicidad import evaluar_carpetas, listar_eml, main
from src.publicidad import (
    FRASE_BAJA,
    LIST_UNSUBSCRIBE,
    PLATAFORMA_MASIVA,
    PRECEDENCE_BULK,
    REMITENTE_MASIVO,
    analizar_publicidad,
    leer_eml,
)


def correo(remitente="ana.perez@example.com", asunto="Hola", cuerpo="Texto", **cabeceras):
    """EmailMessage de texto plano. Las cabeceras extra van con guion bajo: List_Unsubscribe."""
    mensaje = EmailMessage()
    mensaje["From"] = remitente
    mensaje["To"] = "equipo@example.com"
    mensaje["Subject"] = asunto
    for nombre, valor in cabeceras.items():
        mensaje[nombre.replace("_", "-")] = valor
    mensaje.set_content(cuerpo)
    return mensaje


def analizar(mensaje):
    return analizar_publicidad(mensaje, mensaje["Subject"], mensaje.get_content())


# ----- los cuatro casos pedidos -----


def test_list_unsubscribe_basta_para_ser_publicidad():
    mensaje = correo(
        remitente="tienda@example.com",
        asunto="Ofertas de la semana",
        cuerpo="Mira nuestras ofertas.",
        List_Unsubscribe="<mailto:baja@example.com>",
    )
    resultado = analizar(mensaje)
    assert resultado["es_publicidad"] is True
    assert resultado["motivos"] == [LIST_UNSUBSCRIBE]
    assert resultado["puntaje"] == 2


def test_una_sola_senal_debil_no_es_publicidad():
    mensaje = correo(remitente="noreply@example.com", asunto="Su recibo", cuerpo="Gracias por su pago.")
    resultado = analizar(mensaje)
    assert resultado["es_publicidad"] is False
    assert resultado["motivos"] == [REMITENTE_MASIVO]
    assert resultado["puntaje"] == 1


def test_dos_senales_debiles_son_publicidad():
    mensaje = correo(
        remitente="newsletter@example.com",
        asunto="Boletín de octubre",
        cuerpo="Novedades del mes. Si no desea recibir más, puede darse de baja aquí.",
    )
    resultado = analizar(mensaje)
    assert resultado["es_publicidad"] is True
    assert resultado["motivos"] == [FRASE_BAJA, REMITENTE_MASIVO]
    assert resultado["puntaje"] == 2


def test_correo_personal_normal_no_es_publicidad():
    mensaje = correo(asunto="Reunión del jueves", cuerpo="Hola, ¿nos vemos a las 3? Saludos, Ana")
    resultado = analizar(mensaje)
    assert resultado == {"es_publicidad": False, "puntaje": 0, "motivos": []}


# ----- otras señales -----


def test_precedence_bulk_es_fuerte():
    resultado = analizar(correo(Precedence="bulk"))
    assert resultado["es_publicidad"] is True and resultado["motivos"] == [PRECEDENCE_BULK]
    assert analizar(correo(Precedence="first-class"))["es_publicidad"] is False


def test_frase_sin_tildes_ni_mayusculas():
    resultado = analizar_publicidad({}, "Aviso", "Para CANCELAR SUSCRIPCION haga clic")
    assert resultado["motivos"] == [FRASE_BAJA]


def test_plataforma_masiva_y_frase_son_dos_debiles():
    mensaje = correo(X_Mailer="MailChimp Mailer - **CID123**", cuerpo="Click here to unsubscribe")
    resultado = analizar(mensaje)
    assert resultado["es_publicidad"] is True
    assert resultado["motivos"] == [FRASE_BAJA, PLATAFORMA_MASIVA]


def test_cabecera_propia_de_plataforma_cuenta():
    assert analizar_publicidad({"X-SG-EID": "abc"}, "", "")["motivos"] == [PLATAFORMA_MASIVA]
    assert analizar_publicidad({"Feedback-ID": "1:x:amazonses"}, "", "")["motivos"] == [PLATAFORMA_MASIVA]


def test_dict_con_claves_en_mayuscula():
    resultado = analizar_publicidad({"LIST-ID": "<ofertas.example.com>"}, "", "")
    assert resultado["es_publicidad"] is True


def test_info_exacto_cuenta_pero_informacion_no():
    assert analizar_publicidad({"From": "Tienda <info@example.com>"}, "", "")["motivos"] == [REMITENTE_MASIVO]
    assert analizar_publicidad({"From": "informacion@example.com"}, "", "")["motivos"] == []


def test_valores_vacios_no_fallan():
    assert analizar_publicidad(None, None, None)["es_publicidad"] is False


# ----- leer_eml -----


def test_leer_eml_texto_plano(tmp_path):
    ruta = tmp_path / "a.eml"
    ruta.write_bytes(correo(asunto="Hola", cuerpo="Cuerpo de prueba", List_Id="<l.example.com>").as_bytes())
    cabeceras, asunto, cuerpo = leer_eml(ruta)
    assert asunto == "Hola"
    assert cuerpo.strip() == "Cuerpo de prueba"
    assert cabeceras["list-id"] == "<l.example.com>"
    assert cabeceras["from"] == "ana.perez@example.com"


def test_leer_eml_solo_html_lo_limpia(tmp_path):
    mensaje = EmailMessage()
    mensaje["From"] = "tienda@example.com"
    mensaje["Subject"] = "Oferta"
    mensaje.set_content("<html><body><p>Gran <b>OFERTA</b></p></body></html>", subtype="html")
    ruta = tmp_path / "b.eml"
    ruta.write_bytes(mensaje.as_bytes())
    _, _, cuerpo = leer_eml(ruta)
    assert cuerpo == "gran oferta"


def test_leer_eml_prefiere_texto_plano(tmp_path):
    mensaje = correo(cuerpo="Version de texto")
    mensaje.add_alternative("<p>Version HTML</p>", subtype="html")
    ruta = tmp_path / "c.eml"
    ruta.write_bytes(mensaje.as_bytes())
    _, _, cuerpo = leer_eml(ruta)
    assert cuerpo.strip() == "Version de texto"


# ----- evaluar_publicidad -----


def test_carpetas_vacias_terminan_sin_error(tmp_path, capsys):
    assert evaluar_carpetas(tmp_path / "publicidad", tmp_path / "normal") is None
    assert main(tmp_path / "publicidad", tmp_path / "normal", tmp_path / "r.json") is None
    assert "No hay correos .eml" in capsys.readouterr().out
    assert not (tmp_path / "r.json").exists()


def guardar_eml(carpeta, nombre, mensaje):
    carpeta.mkdir(parents=True, exist_ok=True)
    (carpeta / nombre).write_bytes(mensaje.as_bytes())


def test_evaluar_carpetas_cuenta_y_no_guarda_contenido(tmp_path):
    pub, normal = tmp_path / "publicidad", tmp_path / "normal"
    guardar_eml(pub, "p1.eml", correo(remitente="ofertas@example.com", asunto="Secreto uno",
                                      List_Unsubscribe="<mailto:b@example.com>"))
    guardar_eml(pub, "p2.EML", correo(remitente="noreply@example.com", asunto="Secreto dos"))
    guardar_eml(normal, "n1.eml", correo(remitente="maria.lopez@example.com", asunto="Secreto tres"))
    guardar_eml(normal, "n2.eml", correo(remitente="newsletter@example.com", asunto="Secreto cuatro",
                                         cuerpo="puede darse de baja"))
    (normal / "nota.txt").write_text("no es eml", encoding="utf-8")

    assert len(listar_eml(pub)) == 2 and len(listar_eml(normal)) == 2
    ruta = tmp_path / "resultados.json"
    resultados = main(pub, normal, ruta)

    assert resultados["correos"] == {"publicidad": 2, "normal": 2}
    # p1 detectado; p2 solo tiene 1 señal débil -> pasa como normal (FN).
    # n1 bien; n2 tiene 2 débiles -> falso positivo.
    assert resultados["matriz_confusion"]["filas_real_columnas_predicho"] == [[1, 1], [1, 1]]
    assert resultados["precision"] == 0.5 and resultados["recall"] == 0.5
    assert resultados["senales_activadas"]["publicidad"] == {LIST_UNSUBSCRIBE: 1, REMITENTE_MASIVO: 1}

    guardado = ruta.read_text(encoding="utf-8")
    assert json.loads(guardado) == resultados
    for prohibido in ["Secreto", "example.com", "maria", "p1.eml", "darse de baja"]:
        assert prohibido not in guardado


def test_ignora_carpetas_con_nombre_eml_y_funciona_con_una_sola_clase(tmp_path):
    pub = tmp_path / "publicidad"
    pub.mkdir()
    (pub / "carpeta.eml").mkdir()  # una carpeta con nombre .eml no es un archivo: no se lista
    guardar_eml(pub, "ok.eml", correo(List_Id="<x.example.com>"))
    resultados = evaluar_carpetas(pub, tmp_path / "normal")
    assert resultados["correos"] == {"publicidad": 1, "normal": 0}
    assert resultados["precision"] == 1.0 and resultados["recall"] == 1.0
