# **Documentación del Sistema de Automatización de RFPs**

**DEUNA — Versión 3.0**&nbsp;

***Ecosistema**: Google Drive \+ Apps Script \+ Gemini API \+ Google Sheets*

---

## **1\. ¿Qué hace este sistema y cuál es su objetivo?**

### **Objetivo general**

Este sistema automatiza el proceso de respuesta a RFPs (Request for Proposals). Toma documentos nuevos enviados por clientes, los analiza comparándolos con propuestas anteriores ya respondidas por DEUNA, y genera respuestas profesionales de forma automática, reduciendo el tiempo de respuesta de horas a minutos.

### **¿Qué hace exactamente?**

Cuando el equipo recibe un nuevo RFP, el sistema:

1. Detecta que hay un documento pendiente de procesar  
2. Lee el archivo desde Google Drive (soporta PDF, Word, Excel y Google Docs)  
3. Consulta todos los RFPs históricos como base de conocimiento  
4. Envía todo a Gemini (la IA de Google) con instrucciones precisas  
5. Recibe un conjunto de preguntas y respuestas clasificadas por nivel de confianza  
6. Guarda las respuestas en Google Sheets para revisión del equipo  
7. Genera un documento de respuestas listo para revisar  
8. Crea un archivo JSON estructurado que alimenta automáticamente la base de conocimiento  
9. Cuando el RFP es marcado como enviado, mueve el archivo a históricos y aprueba el JSON

Adicionalmente, el sistema tiene un chat integrado que permite al equipo hacer preguntas en lenguaje natural sobre cualquier RFP anterior, sin necesidad de abrir documentos.

### **Beneficios**

* Elimina la revisión manual de RFPs anteriores para redactar respuestas  
* Genera respuestas consistentes basadas en el historial real de la empresa  
* Identifica automáticamente qué preguntas requieren revisión humana  
* Soporta RFPs en español e inglés, detectando el idioma y respondiendo en el mismo  
* Construye una base de conocimiento estructurada que mejora con cada RFP procesado  
* Centraliza todo el conocimiento de propuestas en un solo lugar accesible para el equipo

---

## **2\. Arquitectura del sistema**

El sistema está compuesto por cuatro herramientas que trabajan juntas de forma automática.

```
Equipo (Google Sheets / interfaz manual)
 ↓
Sube archivo → Google Drive (carpeta nuevos/)
 ↓
Registra fila en Google Sheets con estado: pendiente
 ↓
Apps Script detecta la fila (trigger cada 5 minutos)
 ↓
Lee el archivo nuevo + todos los históricos desde Drive
 ↓
Llama a Gemini con el contexto completo
 ↓
Gemini devuelve preguntas, respuestas y nivel de confianza
 ↓
Apps Script guarda Q&A en Sheets + genera documento de respuestas
 ↓
Apps Script genera JSON estructurado → carpeta qa_json/ en Drive
 ↓
Estado cambia a: completado
 ↓
Equipo revisa, ajusta y marca como: enviado
 ↓
Apps Script mueve archivo a históricos/ + aprueba JSON automáticamente
```

### **Componente 1: Google Drive — La biblioteca de documentos**

Google Drive actúa como el sistema de archivos del sistema. Contiene cuatro carpetas con roles específicos:

* **nuevos/** → Aquí se suben los RFPs que necesitan ser respondidos. El sistema monitorea esta carpeta y procesa cada archivo que aparezca registrado en Sheets.  
* **procesados/** → Carpeta de archivo para los documentos de respuestas ya generados. Cada RFP procesado genera un documento aquí.  
* **historicos/** → Contiene copias de los RFPs finales ya enviados a clientes. Son la base de conocimiento que Gemini usa como referencia. Cuantos más documentos haya aquí, mejores serán las respuestas futuras.  
* **qa\_json/** → Contiene los archivos JSON estructurados generados por el sistema. Cada JSON representa los pares de pregunta-respuesta de un RFP, con clasificación de confianza. Esta carpeta es el corazón de la base de conocimiento estructurada del sistema.

### **Componente 2: Google Sheets — La base de datos del sistema**

Google Sheets actúa como el registro central del estado. Todo lo que ocurre queda registrado aquí. Contiene tres hojas:

**Hoja rfps:** Registro principal de todos los RFPs. Cada fila es un documento. Las columnas más importantes son:

| Columna | Nombre | Descripción |
| ----- | ----- | ----- |
| 4 | estado | Semáforo del proceso: pendiente → procesando → completado → error |
| 5 | drive\_id\_rfp | ID del archivo en Drive a procesar |
| 7 | resumen\_procesamiento | Resumen automático: "Total: 18 | Respondidas: 14 (78%) | Revisión humana: 4" |
| 10 | link\_pdf | Enlace al documento de respuestas generado |
| 11 | estado\_aprobacion | Campo que el equipo completa manualmente: enviado |
| 12 | drive\_id\_final | ID del archivo final enviado al cliente |
| 13 | fecha\_movido\_historicos | Fecha en que el sistema movió el archivo a históricos |
| 14 | drive\_id\_qa\_json | ID del JSON estructurado generado automáticamente |

**Hoja qa\_respuestas:** Contiene cada pregunta detectada y su respuesta generada por Gemini. Incluye la sección del RFP, la pregunta, la respuesta y el nivel de confianza.

**Hoja chat:** Registro de preguntas hechas al sistema en lenguaje natural y sus respuestas. El sistema revisa esta hoja cada 2 minutos y responde cualquier pregunta sin respuesta.

### **Componente 3: Gemini API — La inteligencia artificial**

Gemini es el modelo de IA de Google que analiza los documentos y genera las respuestas. Se accede mediante una clave de API gratuita obtenida desde Google AI Studio.

Detalles técnicos relevantes para el equipo:

* Modelo: gemini-2.5-flash (equilibrio entre velocidad y calidad)  
* Límite gratuito: 15 solicitudes por minuto, 1.500 por día  
* El sistema gestiona automáticamente los límites de velocidad con pausas entre llamadas

**Niveles de confianza que asigna Gemini a cada respuesta:**

* **alta** → La respuesta tiene un referente muy similar en los documentos históricos. Se puede usar casi directamente.  
* **media** → La respuesta fue adaptada a partir de referencias parciales. Revisar antes de usar.  
* **baja** → La respuesta fue generada sin referencia directa. Requiere revisión cuidadosa.  
* **revision\_humana** → La pregunta es demasiado específica del cliente o no tiene cobertura en el knowledge base. El campo respuesta incluirá el motivo: "⚠️ REQUIERE REVISIÓN HUMANA — \[razón\]"

### **Componente 4: Apps Script — El motor de automatización**

Apps Script es el código JavaScript que corre en los servidores de Google, completamente gratis. Conecta todas las piezas y contiene tres flujos principales:

**Flujo 1 — Procesamiento de RFPs** (`verificarRFPsPendientes`): Se ejecuta automáticamente cada 5 minutos. Busca filas con estado "pendiente" y las procesa completamente: llama a Gemini, guarda respuestas, genera documento y crea el JSON estructurado.

**Flujo 2 — Chat con el knowledge base** (`verificarPreguntasChat`): Se ejecuta automáticamente cada 2 minutos. Busca preguntas en la hoja chat sin respuesta y las responde usando los documentos históricos como contexto.

**Flujo 3 — Feedback loop** (`verificarRFPsParaMoverAHistoricos`): Se ejecuta automáticamente. Detecta RFPs marcados como "enviado" y realiza dos acciones: copia el archivo final a la carpeta históricos/ y actualiza el JSON con aprobación humana confirmada.

El sistema está dividido en dos archivos de código:

* **script\_automatizacion.js** → Flujos 1 y 2, configuración, utilidades y diagnóstico  
* **feedback-loop.js** → Flujo 3 y utilidades de diagnóstico del loop

---

## **3\. Cómo usar el sistema**

### **Para procesar un nuevo RFP**

1. Subir el archivo a la carpeta **nuevos/** en Google Drive. El sistema acepta PDF, Word (.docx), Excel (.xlsx) y Google Docs.  
2. Copiar el ID del archivo. Se obtiene desde la URL del archivo: es la cadena de letras y números que aparece entre `/d/` y `/view`.  
3. Abrir Google Sheets y la hoja **rfps**.  
4. Crear una nueva fila con los datos del RFP: rfp\_id (identificador único), nombre del cliente y el ID del archivo copiado en la columna drive\_id\_rfp.  
5. Escribir "pendiente" en la columna estado.  
6. Esperar entre 5 y 15 minutos según el tamaño del documento.  
7. Cuando la columna estado cambie a "completado", la columna resumen\_procesamiento mostrará cuántas preguntas fueron respondidas automáticamente y cuántas requieren revisión.  
8. Abrir la hoja **qa\_respuestas** para revisar cada pregunta y respuesta generada.  
9. Prestar especial atención a las respuestas marcadas como "revision\_humana": esas requieren que alguien del equipo las complete manualmente.

### **Para completar el ciclo (marcar como enviado)**

Una vez que el equipo revisó, ajustó y envió el RFP al cliente:

1. En la hoja rfps, escribir "enviado" en la columna estado\_aprobacion (columna 11).  
2. Pegar el ID del archivo final enviado al cliente en la columna drive\_id\_final (columna 12).  
3. El sistema detectará esto automáticamente, copiará el archivo a históricos/ y actualizará el JSON estructurado con aprobación confirmada.

### **Para hacer una pregunta al knowledge base**

1. Abrir Google Sheets y la hoja **chat**.  
2. Crear una nueva fila con un identificador de sesión, la fecha y la pregunta en la columna correspondiente. Dejar la columna respuesta completamente vacía.  
3. Esperar máximo 2 minutos.  
4. Refrescar la hoja para ver la respuesta generada por Gemini.  
5. Las preguntas pueden hacerse en español o en inglés.

### **Tiempos de espera esperados**

* Preguntas en el chat: entre 30 segundos y 2 minutos  
* RFPs pequeños (hasta 10 preguntas): entre 2 y 5 minutos  
* RFPs medianos (10 a 30 preguntas): entre 5 y 10 minutos  
* RFPs grandes (más de 30 preguntas): entre 10 y 20 minutos

Los tiempos incluyen el retraso del trigger (máximo 5 minutos para RFPs, 2 minutos para chat) más el tiempo de procesamiento de Gemini.

---

## **4\. Cómo mantener y editar el sistema**

### **A) Agregar nuevos documentos históricos al knowledge base**

1. Subir el archivo a la carpeta **historicos/** en Drive. Usar nombres sin espacios ni caracteres especiales. Ejemplo correcto: `rfp_cliente_tecnologia_2025.pdf`  
2. Copiar el ID del archivo desde la URL.  
3. Abrir Apps Script desde Google Sheets → Extensiones → Apps Script.  
4. En la sección CONFIG del archivo `script_automatizacion.js`, agregar el nuevo ID al array DOCS\_HISTORICOS:

```
DOCS_HISTORICOS: [
  "ID_EXISTENTE_1",
  "ID_EXISTENTE_2",
  "NUEVO_ID_AQUI",   ← agregar aquí
],
```

5. Guardar el script con Ctrl+S.

### **B) Cambiar o rotar la API key de Gemini**

Puede ser necesario si la clave actual expira o se compromete.

1. Ir a aistudio.google.com e iniciar sesión con la cuenta de Google del equipo.  
2. Generar una nueva API key.  
3. Abrir Apps Script.  
4. En CONFIG, reemplazar el valor de GEMINI\_API\_KEY por la nueva clave.  
5. Ejecutar `probarConexionGemini()` para confirmar que funciona.

### **C) Actualizar IDs de carpetas en Drive**

Si alguna carpeta es recreada o el sistema se migra:

1. Obtener el nuevo ID de la carpeta desde la URL de Drive (la parte después de `/folders/`).  
2. En CONFIG de Apps Script, actualizar el valor correspondiente: CARPETA\_NUEVOS\_ID, CARPETA\_PROCESADOS\_ID o CARPETA\_QA\_JSON\_ID.  
3. Para el ID de históricos, actualizar en FL\_CONFIG del archivo `feedback-loop.js`.

### **D) Cambiar el Google Sheets de destino**

Si el sistema se migra a otro archivo de Sheets:

1. Crear el nuevo archivo con la misma estructura de hojas: rfps, qa\_respuestas, chat.  
2. Copiar el nuevo Spreadsheet ID desde la URL.  
3. En CONFIG de Apps Script, reemplazar el valor de SPREADSHEET\_ID.

### **E) Agregar nuevos miembros al equipo**

Solo es necesario dar acceso al archivo de Google Sheets y a las carpetas de Drive relevantes desde los permisos nativos de Google. No se requiere ninguna configuración adicional en el script.

---

## **5\. Protocolo de pruebas y verificación**

Este protocolo debe seguirse en orden. Cada prueba debe pasar antes de avanzar a la siguiente.

### **Prueba 1 — Verificar conexión con Gemini (2 minutos)**

1. Abrir Apps Script desde Sheets → Extensiones → Apps Script.  
2. En el menú de funciones, seleccionar `probarConexionGemini` y ejecutar.  
3. ✅ Resultado esperado: popup con el texto "CONEXIÓN OK"  
4. ❌ Si falla: verificar que la API key en CONFIG sea correcta y no tenga espacios extra. Verificar que la cuenta tenga acceso activo a Google AI Studio.

### **Prueba 2 — Verificar lectura de Drive (2 minutos)**

1. En Apps Script, seleccionar `probarLecturaDrive` y ejecutar.  
2. ✅ Resultado esperado: popup con los primeros 300 caracteres del primer documento histórico.  
3. ❌ Si falla: verificar que el primer ID en DOCS\_HISTORICOS sea correcto y que el script tenga los permisos de Drive autorizados.

### **Prueba 3 — Flujo de procesamiento completo (10–15 minutos)**

1. Subir un PDF de prueba a la carpeta nuevos/ en Drive y copiar su ID.  
2. En Google Sheets, hoja rfps, crear una fila con: rfp\_id \= test-001, nombre del cliente, estado \= pendiente, drive\_id\_rfp \= el ID del archivo subido.  
3. Esperar máximo 5 minutos.  
4. ✅ Resultado esperado: la columna estado cambia a "procesando" y luego a "completado"; la hoja qa\_respuestas tiene filas con preguntas y respuestas; la columna resumen\_procesamiento tiene el conteo; la columna drive\_id\_qa\_json tiene un ID de archivo.  
5. ❌ Si el estado queda en "error": leer el mensaje en la columna notas para identificar la causa.

### **Prueba 4 — Verificar JSON generado (2 minutos)**

1. Copiar el ID de la columna drive\_id\_qa\_json de la fila de prueba.  
2. Abrir el archivo en Drive pegando el ID en el navegador.  
3. ✅ Resultado esperado: archivo JSON válido con campos rfp\_id, cliente, idioma detectado, y lista de qa\_pairs con confidence\_humana \= "pendiente".

### **Prueba 5 — Verificar feedback loop (5 minutos)**

1. En la fila de prueba, escribir "enviado" en columna 11 y un ID de archivo válido en columna 12\.  
2. Ejecutar manualmente `verificarRFPsParaMoverAHistoricos()` desde Apps Script.  
3. ✅ Resultado esperado: log muestra "Procesados: 1 | Errores: 0"; columna 13 tiene la fecha; en Drive, la carpeta historicos/ tiene una copia del archivo; el JSON en qa\_json/ tiene todos sus confidence\_humana actualizados a "aprobada".

### **Prueba 6 — Chat con el knowledge base (5 minutos)**

1. En Google Sheets, hoja chat, crear una fila con pregunta relacionada con los RFPs históricos cargados. Dejar la columna respuesta vacía.  
2. Esperar máximo 2 minutos.  
3. ✅ Resultado esperado: la columna respuesta se llena con texto generado por Gemini.  
4. ❌ Si no se llena: verificar en Apps Script → Triggers que el trigger `verificarPreguntasChat` esté activo.

---

## **6\. Buenas prácticas**

### **Antes de procesar un RFP**

* Verificar que el archivo esté en un formato soportado: PDF, Word (.docx), Excel (.xlsx) o Google Docs. Otros formatos pueden generar resultados impredecibles.  
* Usar nombres de archivo sin espacios ni caracteres especiales. Correcto: `rfp_cliente_2025.pdf`. Incorrecto: `RFP Cliente Acme (final).pdf`.  
* Confirmar que el ID copiado sea correcto pegándolo en el navegador para verificar que abre el archivo esperado.  
* Cuanto más estructurado esté el RFP, con preguntas claramente separadas de las instrucciones generales, mejor será el resultado de Gemini.

### **Sobre el knowledge base**

* Agregar el RFP final a históricos después de cada propuesta enviada. El sistema mejora con cada documento agregado.  
* Priorizar documentos que tengan tanto las preguntas del cliente como las respuestas dadas por DEUNA en el mismo archivo.  
* No acumular documentos duplicados o versiones anteriores del mismo RFP en históricos. Solo la versión final enviada.  
* Usar nombres descriptivos para facilitar el mantenimiento: `rfp_cliente_industria_año.pdf`.

### **Sobre las respuestas generadas**

* Siempre revisar las respuestas antes de enviarlas al cliente. La IA puede generar respuestas que necesitan ajuste de tono, actualización de cifras o adaptación al contexto específico.  
* Las respuestas con confianza "baja" o "revision\_humana" requieren atención prioritaria del equipo. Nunca enviar estas respuestas sin revisión.  
* Usar las respuestas de Gemini como punto de partida bien fundamentado, no como producto final.  
* Si una pregunta recurrente siempre cae en "baja" o "revision\_humana", es señal de que falta cobertura en el knowledge base. Agregar un documento histórico que la cubra.

### **Seguridad y acceso**

* Nunca compartir la API key de Gemini. Si se compromete, generar una nueva inmediatamente en AI Studio y actualizar CONFIG en Apps Script.  
* El archivo de Google Sheets debe tener permisos de edición solo para los administradores del sistema. El resto del equipo puede tener acceso de lectura si es suficiente para su rol.  
* Las carpetas de Drive deben tener acceso restringido al equipo que opera el sistema.

---

## **7\. Solución de problemas comunes**

| Problema | Causa probable | Solución |
| ----- | ----- | ----- |
| El estado queda en "error" | Error de Gemini o Drive | Leer la columna notas para ver el mensaje exacto |
| El estado queda en "procesando" indefinidamente | El script fue interrumpido | Cambiar manualmente el estado a "pendiente" para que se reintente |
| La respuesta del chat no aparece | Trigger no activo | Ir a Apps Script → Triggers y verificar que `verificarPreguntasChat` esté activo |
| Gemini responde en el idioma incorrecto | RFP con texto mixto o poco claro | Verificar que el idioma principal del RFP sea claro en las primeras secciones |
| `probarLecturaDrive()` falla | ID incorrecto o permisos | Verificar el ID del archivo y que el script esté autorizado para acceder a Drive |
| Aparecen muchas respuestas "revision\_humana" | Históricos insuficientes o poco representativos | Agregar más documentos completos y bien estructurados a la carpeta historicos/ |
| El proceso tarda más de 20 minutos | RFP muy extenso o Gemini saturado | Esperar y volver a intentar. Si es recurrente, dividir el RFP en partes más pequeñas |
| El JSON en qa\_json/ no se generó | Error en el paso de generación | Revisar columna notas. El JSON es el último paso: si hay error antes, no llega a generarse |
| feedback loop muestra "Procesados: 0" | La fila ya fue procesada en una ejecución anterior | Comportamiento normal. Si es una fila nueva, verificar que col 11 \= "enviado" y col 12 tenga un ID válido |
| El archivo no aparece en históricos/ | drive\_id\_final incorrecto o sin permisos | Verificar que el ID en col 12 sea el del archivo final y que el script pueda accederlo |

---

## **8\. Recursos y referencias**

* **Google Apps Script** (documentación oficial): [https://developers.google.com/apps-script](https://developers.google.com/apps-script)&nbsp;  
* **Gemini API / Google AI Studio** (obtener API key, ver límites de uso): [https://aistudio.google.com](https://aistudio.google.com)&nbsp;  
* **Referencia de modelos Gemini** (comparación de modelos y capacidades): [https://ai.google.dev/gemini-api/docs/models](https://ai.google.dev/gemini-api/docs/models)&nbsp;  
* **Google Drive API en Apps Script**: [https://developers.google.com/apps-script/reference/drive](https://developers.google.com/apps-script/reference/drive)&nbsp;  
* **Google Sheets API en Apps Script**: [https://developers.google.com/apps-script/reference/spreadsheet](https://developers.google.com/apps-script/reference/spreadsheet)&nbsp;

---

**Última actualización**: Mayo 2026

**Versión del sistema**: 3.0

**Mantenedor**: [Raymond Almenares](mailto:ralmenares@deuna.com)

&nbsp;