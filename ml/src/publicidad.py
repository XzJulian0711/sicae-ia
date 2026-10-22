# Deteccion de publicidad / spam por REGLAS (no usa el modelo ML).
#
# Que ira aqui:
# - Lectura de la cabecera List-Unsubscribe del correo.
# - Senales de envio masivo (Precedence: bulk, X-Campaign, remitente no-reply, etc.).
# - Una funcion que, dadas las cabeceras de un correo, responda si es publicidad.
#
# Por que esta separado del modelo: la publicidad se reconoce por como fue
# enviado el correo, no por lo que dice. Una regla es mas fiable y mas facil
# de explicar en el documento de grado que un clasificador entrenado.
#
# Recordar: cada funcion nueva necesita su prueba en ml/tests/.
