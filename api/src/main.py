# Punto de entrada de la API (FastAPI).
#
# Que ira aqui:
# - La creacion de la app FastAPI.
# - CORS, para que la extension de Chrome pueda llamarla.
# - Los endpoints: clasificar un correo y consultar el historial.
#
# Rol de la API: es el puente entre el modelo (ml/) y la extension.
# Recibe un correo, pide la clasificacion, asigna prioridad
# (alta / media / baja) y guarda el resultado en SQLite.
#
# Categorias que devuelve al usuario: legitimo, publicidad, phishing.
#
# IMPORTANTE (alcance del proyecto): limpieza y envio son SIMULADOS.
# Ningun endpoint debe borrar ni enviar correos reales.
#
# Se levanta con: uvicorn api.src.main:app --reload
