/ ═══════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════
const CONFIG = {

  // Tu API key de Gemini (Bloque 3)
  GEMINI_API_KEY: PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY"),

  // ID de tu Google Sheets (Bloque 2)
  SPREADSHEET_ID: "id_spreadsheet",

  DOCS_HISTORICOS: [
    "id_file1", // RFP_QA_Database_1
    "id_file2", // RFP_QA_Database_2
    "id_file3" // RFP_QA_Database_3
  ],

  CARPETA_NUEVOS_ID: "id_file4",

  CARPETA_PROCESADOS_ID: "id_file5",

  CARPETA_QA_JSON_ID: "id_file6",

  // Rate limiting — delays en segundos entre llamadas a Gemini

  DELAY_ENTRE_RFPS_SEG: 65,

  DELAY_ENTRE_CHATS_SEG: 65,

  DELAY_REINTENTO_SEG: 70,

  MAX_REINTENTOS: 3,
};

// ═══════════════════════════════════════════════════════════
// RATE LIMITER
// ═══════════════════════════════════════════════════════════

function registrarLlamada() {
  PropertiesService.getScriptProperties()
    .setProperty("ULTIMA_LLAMADA_GEMINI", Date.now().toString());
}

function esperarSiNecesario(delaySeg) {
  const props        = PropertiesService.getScriptProperties();
  const ultimaStr    = props.getProperty("ULTIMA_LLAMADA_GEMINI");
  const delayMs      = delaySeg * 1000;

  if (ultimaStr) {
    const transcurrido = Date.now() - parseInt(ultimaStr, 10);
    const falta        = delayMs - transcurrido;
    if (falta > 0) {
      Logger.log(`[RateLimit] Esperando ${Math.ceil(falta / 1000)}s antes de la siguiente llamada...`);
      Utilities.sleep(falta);
    } else {
      Logger.log(`[RateLimit] Ya transcurrieron ${Math.round(transcurrido / 1000)}s. Sin espera necesaria.`);
    }
  } else {
    Logger.log("[RateLimit] Primera llamada de esta sesión. Sin espera.");
  }
}

function llamarGeminiConRateLimit(url, payload, delaySeg) {
  const opciones = {
    method: "POST",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  for (let intento = 1; intento <= CONFIG.MAX_REINTENTOS; intento++) {
    esperarSiNecesario(delaySeg);
    registrarLlamada();

    const respuesta = UrlFetchApp.fetch(url, opciones);
    const json      = JSON.parse(respuesta.getContentText());

    if (!json.error) return json;

    const msg = json.error.message || "";

    if (msg.includes("quota") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("rate") || msg.includes("retry")) {
      const matchSeg    = msg.match(/retry in (\d+(?:\.\d+)?)s/i);
      const esperaExtra = matchSeg
        ? Math.ceil(parseFloat(matchSeg[1])) + 5
        : CONFIG.DELAY_REINTENTO_SEG;

      Logger.log(`[RateLimit] Error de cuota en intento ${intento}/${CONFIG.MAX_REINTENTOS}. Esperando ${esperaExtra}s antes de reintentar...`);

      if (intento < CONFIG.MAX_REINTENTOS) {
        Utilities.sleep(esperaExtra * 1000);
      } else {
        throw new Error(`Gemini API error tras ${CONFIG.MAX_REINTENTOS} reintentos: ${msg}`);
      }
    } else {
      throw new Error(`Gemini API error: ${msg}`);
    }
  }
}

// ───────────────────────────────────────────────────────────
// FLUJO 1: Procesar nuevo RFP
// ───────────────────────────────────────────────────────────

function verificarRFPsPendientes() {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const hoja  = ss.getSheetByName("rfps");
  const datos = hoja.getDataRange().getValues();

  for (let i = 1; i < datos.length; i++) {
    const fila       = datos[i];
    const rfpId      = fila[0];
    const cliente    = fila[1];
    let   estado     = fila[3];
    let   driveIdRFP = fila[4];
    const archivoRfp = fila[7];

    // Auto-asignar "pendiente" si hay archivo pero el estado está vacío
    if (archivoRfp && !estado) {
      estado = "pendiente";
      hoja.getRange(i + 1, 4).setValue("pendiente");
      SpreadsheetApp.flush();
      Logger.log(`[Fila ${i + 1}] Estado vacío con archivo → auto-asignado a "pendiente".`);
    }

    // Extraer drive_id desde path/URL si no está guardado aún
    if (archivoRfp && !driveIdRFP) {
      try {
        driveIdRFP = extraerIdDesdePath(archivoRfp);
        hoja.getRange(i + 1, 5).setValue(driveIdRFP);
        SpreadsheetApp.flush();
        Logger.log(`[Fila ${i + 1}] drive_id_rfp extraído: ${driveIdRFP}`);
      } catch (errorExtraccion) {
        const msgError = `[ERROR extracción drive_id] ${errorExtraccion.message}`;
        Logger.log(msgError);
        hoja.getRange(i + 1, 6).setValue(msgError);
        SpreadsheetApp.flush();
        continue;
      }
    }

    if (estado === "pendiente" && rfpId && driveIdRFP) {
      try {
        hoja.getRange(i + 1, 4).setValue("procesando");
        SpreadsheetApp.flush();

        const resultado = procesarRFPConGemini(rfpId, cliente, driveIdRFP);
        const resumen   = guardarRespuestas(rfpId, cliente, resultado);

        hoja.getRange(i + 1, 7).setValue(resumen);
        const linkPDF  = generarPDFRespuestas(rfpId, cliente);
        hoja.getRange(i + 1, 10).setValue(linkPDF);
        const idQAJson = generarJSONEstructuradoQA(rfpId, cliente, resultado);
        hoja.getRange(i + 1, 14).setValue(idQAJson);

        hoja.getRange(i + 1, 4).setValue("completado");
        hoja.getRange(i + 1, 9).setValue(new Date().toLocaleString());
        SpreadsheetApp.flush();

      } catch (error) {
        hoja.getRange(i + 1, 4).setValue("error");
        hoja.getRange(i + 1, 6).setValue(error.message);
        SpreadsheetApp.flush();
      }
    }
  }
}


function procesarRFPConGemini(rfpId, cliente, driveIdNuevoRFP) {
  const textoNuevoRFP = leerArchivoDeDrive(driveIdNuevoRFP);

  let textoHistoricos = "";
  for (const docId of CONFIG.DOCS_HISTORICOS) {
    try {
      const texto   = leerArchivoDeDrive(docId);
      const archivo = DriveApp.getFileById(docId);
      textoHistoricos += `\n\n=== DOCUMENTO HISTÓRICO: ${archivo.getName()} ===\n${texto}`;
    } catch (e) {
      Logger.log(`No se pudo leer el doc ${docId}: ${e.message}`);
    }
  }

  const prompt = `
Eres un experto en responder RFPs (Request for Proposals) de manera profesional y bilingüe (español e inglés).

A continuación tienes DOCUMENTOS HISTÓRICOS de RFPs anteriores ya respondidos por nuestra empresa.
Úsalos como referencia y base de conocimiento. Pueden estar en español, inglés o ambos:

${textoHistoricos}

---

Ahora, analiza el siguiente NUEVO RFP del cliente "${cliente}" y genera respuestas:

${textoNuevoRFP}

---

INSTRUCCIONES:
1. Detecta el idioma principal del nuevo RFP (español o inglés) y responde TODAS las secciones en ese mismo idioma, independientemente del idioma en que estén los documentos históricos.
2. Identifica TODAS las preguntas, secciones o puntos que requieren respuesta.
3. Para cada uno, genera una respuesta profesional basándote en los documentos históricos, respondiendo lo más parecido posible a como está en los documentos históricos.
4. Adapta el lenguaje al cliente específico.
5. Clasifica el nivel de confianza de cada respuesta usando EXACTAMENTE uno de estos valores:
   - "alta": la respuesta tiene un referente muy similar en los documentos históricos.
   - "media": la respuesta fue adaptada a partir de referencias parciales.
   - "baja": la respuesta fue generada sin referencia directa en los históricos.
   - "revision_humana": la pregunta es demasiado específica del cliente (datos técnicos propios, cifras contractuales, SLAs particulares, información confidencial) o no tiene ninguna cobertura en los históricos. En estos casos, escribe en el campo "respuesta": "⚠️ REQUIERE REVISIÓN HUMANA — [razón breve de por qué no se puede responder automáticamente]".

Responde ÚNICAMENTE con un JSON válido, sin texto adicional ni backticks:
{
  "qa_pairs": [
    {
      "seccion": "nombre de la sección del RFP",
      "pregunta": "pregunta o punto a responder",
      "respuesta": "respuesta detallada y profesional, o el aviso de revisión humana",
      "confianza": "alta | media | baja | revision_humana"
    }
  ]
}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 65536 }
  };

  const json = llamarGeminiConRateLimit(url, payload, CONFIG.DELAY_ENTRE_RFPS_SEG);

  const textoRespuesta = json.candidates[0].content.parts[0].text;
  const textoLimpio = textoRespuesta
    .replace(/```json|```/g, "")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .trim();

  // JSON.parse envuelto en try/catch. Si Gemini devuelve texto malformado, el error ahora incluye los primeros 200 chars de la respuesta para facilitar el debug en el Sheet.
  let datos;
  try {
    datos = JSON.parse(textoLimpio);
  } catch (parseError) {
    throw new Error(
      `Gemini devolvió un JSON inválido para rfp_id=${rfpId}. ` +
      `Error: ${parseError.message}. ` +
      `Primeros 200 chars de la respuesta: ${textoLimpio.substring(0, 200)}`
    );
  }

  return datos.qa_pairs || [];
}

function subirYProcesarRFP(cliente, nombreArchivo, mimeType, base64Data) {
  try {
    // 1. Decodificar y guardar el archivo en la carpeta "Nuevos"
    const blob = Utilities.newBlob(Utilities.base64Decode(base64Data), mimeType, nombreArchivo);
    const carpeta = DriveApp.getFolderById(CONFIG.CARPETA_NUEVOS_ID);
    const archivoGuardado = carpeta.createFile(blob);
    
    const driveIdRFP = archivoGuardado.getId();
    const archivoUrl = archivoGuardado.getUrl();

    // 2. Generar ID único y fecha
    const rfpId = "RFP-" + Math.random().toString(36).substring(2, 8).toUpperCase();
    const fechaSubida = new Date().toLocaleString();
    
    // 3. Crear la fila en la hoja 'rfps'
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName("rfps");
    
    // Asumiendo columnas: A:rfp_id, B:cliente, C:fecha, D:estado, E:drive_id, F:notas, G:resumen, H:archivo, I:fecha_fin, J:link_pdf
    hoja.appendRow([rfpId, cliente, fechaSubida, "procesando", driveIdRFP, "", "", archivoUrl, "", ""]);
    const rowIndex = hoja.getLastRow();
    SpreadsheetApp.flush();

    // 4. Ejecución Inmediata de Gemini y utilidades
    const resultado = procesarRFPConGemini(rfpId, cliente, driveIdRFP);
    const resumen   = guardarRespuestas(rfpId, cliente, resultado);
    
    hoja.getRange(rowIndex, 7).setValue(resumen); // G: resumen
    const linkPDF  = generarPDFRespuestas(rfpId, cliente);
    hoja.getRange(rowIndex, 10).setValue(linkPDF); // J: link_pdf
    const idQAJson = generarJSONEstructuradoQA(rfpId, cliente, resultado);
    hoja.getRange(rowIndex, 14).setValue(idQAJson); // N: id_qa_json
    
    const fechaCompletado = new Date().toLocaleString();
    hoja.getRange(rowIndex, 4).setValue("completado"); // D: estado
    hoja.getRange(rowIndex, 9).setValue(fechaCompletado); // I: fecha_completado
    SpreadsheetApp.flush();

    // 5. Devolver resultados al frontend
    return {
      exito: true,
      rfpId: rfpId,
      estado: "completado",
      resumen: resumen,
      linkPdf: linkPDF,
      fechaCompletado: fechaCompletado
    };

  } catch (e) {
    return { exito: false, error: e.message };
  }
}

// ───────────────────────────────────────────────────────────
// FLUJO 2: Chat con el knowledge base
// ───────────────────────────────────────────────────────────

function verificarPreguntasChat() {
  const ss    = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const hoja  = ss.getSheetByName("chat");
  const datos = hoja.getDataRange().getValues();

  for (let i = 1; i < datos.length; i++) {
    const pregunta  = datos[i][2];
    const respuesta = datos[i][3];

    if (pregunta && !respuesta) {
      try {
        const respuestaGemini = consultarChatGemini(pregunta);
        hoja.getRange(i + 1, 4).setValue(respuestaGemini);
        SpreadsheetApp.flush();
      } catch (error) {
        hoja.getRange(i + 1, 4).setValue(`Error: ${error.message}`);
        SpreadsheetApp.flush();
      }
    }
  }
}


function consultarChatGemini(pregunta) {
  let contextoHistoricos = "";
  for (const docId of CONFIG.DOCS_HISTORICOS) {
    try {
      const texto   = leerArchivoDeDrive(docId);
      const archivo = DriveApp.getFileById(docId);
      contextoHistoricos += `\n\n=== ${archivo.getName()} ===\n${texto}`;
    } catch (e) {
      Logger.log(`Chat: no se pudo leer doc ${docId}`);
    }
  }

  const prompt = `
Eres un asistente experto en RFPs. Tienes acceso a la siguiente biblioteca de RFPs anteriores de la empresa:

${contextoHistoricos}

---

Responde la siguiente pregunta del equipo de manera clara, profesional y basándote en los documentos anteriores.
Responde en el mismo idioma en que está formulada la pregunta.
Si la pregunta no está cubierta en los documentos, indícalo claramente y advierte que esa respuesta requiere intervención humana.

Pregunta: ${pregunta}
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${CONFIG.GEMINI_API_KEY}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.5, maxOutputTokens: 8192 }
  };

  const json = llamarGeminiConRateLimit(url, payload, CONFIG.DELAY_ENTRE_CHATS_SEG);
  return json.candidates[0].content.parts[0].text;
}

function enviarPreguntaChatWeb(sesionId, pregunta) {
  try {
    const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
    const hoja = ss.getSheetByName("chat");
    const timestamp = new Date().toLocaleString();
    
    // Mapeo según tu imagen: A:sesion_id, B:timestamp, C:pregunta, D:respuesta
    hoja.appendRow([sesionId, timestamp, pregunta, ""]);
    SpreadsheetApp.flush();
    
    return { exito: true };
  } catch (e) {
    return { exito: false, error: e.message };
  }
}

function verificarRespuestaChatWeb(sesionId, pregunta) {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const hoja = ss.getSheetByName("chat");
  const datos = hoja.getDataRange().getValues();
  
  // Buscar de abajo hacia arriba (la más reciente)
  for (let i = datos.length - 1; i > 0; i--) {
    if (datos[i][0] === sesionId && datos[i][2] === pregunta) {
      const respuesta = datos[i][3];
      
      if (respuesta && !respuesta.toString().toLowerCase().includes("error")) {
        return { lista: true, respuesta: respuesta };
      } else if (respuesta && respuesta.toString().toLowerCase().includes("error")) {
        return { lista: true, error: respuesta };
      } else {
        return { lista: false }; // Aún procesando
      }
    }
  }
  return { lista: false, error: "No se encontró la pregunta." };
}

// ───────────────────────────────────────────────────────────
// UTILIDADES
// ───────────────────────────────────────────────────────────

function leerArchivoDeDrive(fileId) {
  const archivo = DriveApp.getFileById(fileId);
  const tipo    = archivo.getMimeType();

  // ── PDF ──────────────────────────────────────────────
  if (tipo === "application/pdf") {
    const recurso = { title: "temp_conversion", mimeType: MimeType.GOOGLE_DOCS };
    const docTemp = Drive.Files.insert(recurso, archivo.getBlob(), { convert: true });
    try {
      return DocumentApp.openById(docTemp.id).getBody().getText();
    } finally {
      DriveApp.getFileById(docTemp.id).setTrashed(true);
    }
  }

  // ── Google Doc ───────────────────────────────────────
  if (tipo === "application/vnd.google-apps.document") {
    return DocumentApp.openById(fileId).getBody().getText();
  }

  // ── XLSX / Google Sheets ─────────────────────────────
  const tiposExcel = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
    "application/vnd.ms-excel",                                           // .xls
    "application/vnd.google-apps.spreadsheet"                             // Google Sheets nativo
  ];

  if (tiposExcel.includes(tipo)) {
    return leerExcelComoTextoEstructurado(fileId, tipo);
  }

  // ── Fallback ─────────────────────────────────────────
  return archivo.getBlob().getDataAsString();
}


function leerExcelComoTextoEstructurado(fileId, tipoMime) {
  let ssId        = fileId;
  let esTemporaL  = false;

  // Si es .xlsx/.xls → convertir a Google Sheets temporalmente
  if (tipoMime !== "application/vnd.google-apps.spreadsheet") {
    const archivo  = DriveApp.getFileById(fileId);
    const recurso  = { title: "temp_xlsx", mimeType: MimeType.GOOGLE_SHEETS };
    const ssTemp   = Drive.Files.insert(recurso, archivo.getBlob(), { convert: true });
    ssId           = ssTemp.id;
    esTemporaL     = true;
  }

  let textoFinal = "";

  try {
    const ss     = SpreadsheetApp.openById(ssId);
    const hojas  = ss.getSheets();

    for (const hoja of hojas) {
      const nombreHoja = hoja.getName();
      const datos      = hoja.getDataRange().getValues();

      if (datos.length < 2) continue; // hoja vacía o solo encabezado

      const encabezados = datos[0].map(h => String(h).trim());
      textoFinal += `\n=== HOJA: ${nombreHoja} ===\n`;

      for (let i = 1; i < datos.length; i++) {
        const fila = datos[i];

        // Ignorar filas completamente vacías
        if (fila.every(celda => celda === "" || celda === null)) continue;

        textoFinal += `--- Fila ${i} ---\n`;
        for (let j = 0; j < encabezados.length; j++) {
          const col  = encabezados[j] || `Columna_${j + 1}`;
          const val  = String(fila[j] ?? "").trim();
          if (val) textoFinal += `${col}: ${val}\n`;
        }
      }
    }
  } finally {
    if (esTemporaL) DriveApp.getFileById(ssId).setTrashed(true);
  }

  return textoFinal || "[Archivo Excel sin contenido legible]";
}


function guardarRespuestas(rfpId, cliente, qaPairs) {
  const ss   = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const hoja = ss.getSheetByName("qa_respuestas");

  let contadorRevision    = 0;
  let contadorRespondidas = 0;
  const total = qaPairs.length;

  for (const qa of qaPairs) {
    hoja.appendRow([
      rfpId,
      cliente,
      qa.seccion   || "",
      qa.pregunta  || "",
      qa.respuesta || "",
      qa.confianza || ""
    ]);
    if (qa.confianza === "revision_humana") {
      contadorRevision++;
    } else {
      contadorRespondidas++;
    }
  }

  const porcentaje = total > 0 ? Math.round((contadorRespondidas / total) * 100) : 0;
  return `Total: ${total} | Respondidas: ${contadorRespondidas} (${porcentaje}%) | Revisión humana: ${contadorRevision}`;
}

// ───────────────────────────────────────────────────────────
// GENERADOR DE JSON ESTRUCTURADO Q&A
// ───────────────────────────────────────────────────────────

function generarJSONEstructuradoQA(rfpId, cliente, qaPairs) {
  const estructura = {
    rfp_id:            rfpId,
    cliente:           cliente,
    fecha_generacion:  new Date().toISOString(),
    idioma:            detectarIdiomaQA(qaPairs),
    industria:         "",          // campo libre para completar manualmente o expandir en Fase 2
    qa_pairs: qaPairs.map(qa => ({
      pregunta:           qa.pregunta  || "",
      respuesta:          qa.respuesta || "",
      categoria:          qa.seccion   || "General",
      confianza_ia:       qa.confianza || "baja",
      confidence_humana:  "pendiente"  // se actualiza a "aprobada" vía feedback loop
    }))
  };

  const nombre  = `qa_${cliente}_${rfpId}_${_fechaHoy()}`.replace(/\s+/g, "_");
  const blob    = Utilities.newBlob(
    JSON.stringify(estructura, null, 2),
    "application/json",
    `${nombre}.json`
  );

  const archivo = DriveApp.getFolderById(CONFIG.CARPETA_QA_JSON_ID).createFile(blob);
  Logger.log(`[QAJson] Creado: ${nombre}.json | ID: ${archivo.getId()}`);
  return archivo.getId();
}


function detectarIdiomaQA(qaPairs) {
  if (!qaPairs || !qaPairs.length) return "desconocido";
  const muestra = qaPairs.slice(0, 5)
    .map(qa => `${qa.pregunta || ""} ${qa.respuesta || ""}`)
    .join(" ")
    .toLowerCase();

  const tokensES = ["qué","cómo","que","como","para","los","las","del","una","con","está","tiene","son","por","sus"];
  const tokensEN = ["what","how","are","the","and","for","with","your","our","does","can","will","this","that","we"];

  const scoreES = tokensES.filter(w => muestra.includes(w)).length;
  const scoreEN = tokensEN.filter(w => muestra.includes(w)).length;
  return scoreES >= scoreEN ? "es" : "en";
}


function generarPDFRespuestas(rfpId, cliente) {
  const ss     = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  const hojaQA = ss.getSheetByName("qa_respuestas");
  const datos  = hojaQA.getDataRange().getValues();
  const filas  = datos.filter((fila, i) => i > 0 && fila[0] === rfpId);

  if (filas.length === 0) {
    throw new Error(`No se encontraron respuestas para rfp_id: ${rfpId}`);
  }

  const titulo = `RFP_Respuestas_${cliente}_${rfpId}`.replace(/\s+/g, "_");
  const doc    = DocumentApp.create(titulo);
  const body   = doc.getBody();

  const encabezado = body.appendParagraph(`RFP — ${cliente}`);
  encabezado.setHeading(DocumentApp.ParagraphHeading.HEADING1);
  encabezado.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  body.appendParagraph(`ID: ${rfpId}`).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph(`Generado: ${new Date().toLocaleString()}`).setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  const total          = filas.length;
  const revisionHumana = filas.filter(f => f[5] === "revision_humana").length;
  const respondidas    = total - revisionHumana;
  const porcentaje     = Math.round((respondidas / total) * 100);

  body.appendParagraph("─".repeat(60));
  body.appendParagraph(`Resumen: Total ${total} | Respondidas ${respondidas} (${porcentaje}%) | Revisión humana ${revisionHumana}`).setBold(true);
  body.appendParagraph("─".repeat(60));

  const secciones = {};
  for (const fila of filas) {
    const seccion = fila[2] || "General";
    if (!secciones[seccion]) secciones[seccion] = [];
    secciones[seccion].push(fila);
  }

  for (const [seccion, preguntas] of Object.entries(secciones)) {
    const tituloSeccion = body.appendParagraph(seccion);
    tituloSeccion.setHeading(DocumentApp.ParagraphHeading.HEADING2);
    tituloSeccion.setBold(false);

    for (const fila of preguntas) {
      const pregunta  = fila[3] || "";
      const respuesta = fila[4] || "";
      const confianza = fila[5] || "";

      const pPregunta = body.appendParagraph(`P: ${pregunta}`);
      pPregunta.setBold(true);
      pPregunta.setForegroundColor("#000000");

      const pRespuesta = body.appendParagraph(`R: ${respuesta}`);
      pRespuesta.setBold(false);
      pRespuesta.setItalic(false);
      pRespuesta.setForegroundColor("#000000");

      const etiquetaColores = {
        "alta"            : "#1E7E34",
        "media"           : "#856404",
        "baja"            : "#856404",
        "revision_humana" : "#CC0000"
      };
      const pConfianza = body.appendParagraph(`Confianza: ${confianza}`);
      pConfianza.setBold(false);
      pConfianza.setItalic(false);
      pConfianza.setForegroundColor(etiquetaColores[confianza] || "#555555");
      pConfianza.setFontSize(9);
      body.appendParagraph("");
    }
  }

  doc.saveAndClose();
  const carpetaProcesados = DriveApp.getFolderById(CONFIG.CARPETA_PROCESADOS_ID);
  const archivoDoc        = DriveApp.getFileById(doc.getId());
  archivoDoc.moveTo(carpetaProcesados);
  return archivoDoc.getUrl();
}


function extraerIdDesdePath(pathOUrl) {
  const matchUrl = pathOUrl.match(/\/d\/([a-zA-Z0-9_-]{25,})/);
  if (matchUrl) return matchUrl[1];

  const nombreArchivo = pathOUrl.split("/").pop();
  const carpeta       = DriveApp.getFolderById(CONFIG.CARPETA_NUEVOS_ID);
  const archivos      = carpeta.getFilesByName(nombreArchivo);
  if (archivos.hasNext()) return archivos.next().getId();

  throw new Error(`No se encontró el archivo en Drive: ${pathOUrl}`);
}

// ═══════════════════════════════════════════════════════════
// ENDPOINT WEB — Permite que el HTML se conecte
// ═══════════════════════════════════════════════════════════

function doGet(e) {
  // Sirve el archivo index.html como la interfaz de la web app
  return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('Agente RFP - Portafolio')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}