// ═══════════════════════════════════════════════════════════
// FEEDBACK LOOP — Auto-mover RFPs aprobados a históricos
// ═══════════════════════════════════════════════════════════

// IDs de carpetas — completar con los valores reales
const FL_CONFIG = {
  CARPETA_HISTORICOS_ID: "colocar nuevo id de carpeta",
  SPREADSHEET_ID: CONFIG.SPREADSHEET_ID,
};

// Columnas de la hoja rfps (índice base 1)
const COL = {
  RFP_ID:                   1,
  CLIENTE:                  2,
  ESTADO_PROCESAMIENTO:     4,
  DRIVE_ID_RFP_ORIGINAL:    5,
  NOTAS:                    6,
  ESTADO_APROBACION:        11,
  DRIVE_ID_FINAL:           12,
  FECHA_MOVIDO_HISTORICOS:  13,
  DRIVE_ID_QA_JSON:         14,
};

function verificarRFPsParaMoverAHistoricos() {
  const ss    = SpreadsheetApp.openById(FL_CONFIG.SPREADSHEET_ID);
  const hoja  = ss.getSheetByName("rfps");
  const datos = hoja.getDataRange().getValues();

  let procesados = 0;
  let errores    = 0;

  for (let i = 1; i < datos.length; i++) {
    const fila              = datos[i];
    const rfpId             = fila[COL.RFP_ID - 1];
    const cliente           = fila[COL.CLIENTE - 1];
    const estadoAprobacion  = fila[COL.ESTADO_APROBACION - 1];
    const driveIdFinal      = fila[COL.DRIVE_ID_FINAL - 1];
    const fechaMovido       = fila[COL.FECHA_MOVIDO_HISTORICOS - 1];

    // Solo procesar filas marcadas como "enviado" que aún no fueron movidas
    if (estadoAprobacion !== "enviado") continue;
    if (fechaMovido)                    continue; // ya procesada
    if (!driveIdFinal)                  continue; // falta el ID del archivo final

    Logger.log(`[FeedbackLoop] Procesando fila ${i + 1} — rfp_id: ${rfpId}, cliente: ${cliente}`);

    try {
      moverArchivoAHistoricos(rfpId, cliente, driveIdFinal);

      // ── Parte 3: aprobar JSON Q&A si existe ─────────
      const driveIdQAJson = fila[COL.DRIVE_ID_QA_JSON - 1];
      if (driveIdQAJson) {
        try {
          aprobarQAJson(driveIdQAJson);
        } catch (eJson) {
          // No abortar flujo principal si falla solo el JSON
          Logger.log(`[FeedbackLoop] ⚠️ No se pudo aprobar QA JSON fila ${i + 1}: ${eJson.message}`);
        }
      }
      // ─────────────────────────────────────────────────

      hoja.getRange(i + 1, COL.FECHA_MOVIDO_HISTORICOS).setValue(
        new Date().toLocaleString()
      );
      SpreadsheetApp.flush();

      Logger.log(`[FeedbackLoop] ✅ Fila ${i + 1} movida correctamente.`);
      procesados++;

    } catch (error) {
      const msg = `[FeedbackLoop ERROR fila ${i + 1}] ${error.message}`;
      Logger.log(msg);
      hoja.getRange(i + 1, COL.NOTAS).setValue(msg);
      SpreadsheetApp.flush();
      errores++;
    }
  }

  Logger.log(`[FeedbackLoop] Ciclo completo — Procesados: ${procesados} | Errores: ${errores}`);
}


function moverArchivoAHistoricos(rfpId, cliente, driveIdFinal) {
  // Verificar que el archivo existe y es accesible
  let archivo;
  try {
    archivo = DriveApp.getFileById(driveIdFinal);
  } catch (e) {
    throw new Error(
      `No se encontró el archivo con ID "${driveIdFinal}". ` +
      `Verifica que el ID sea correcto y que el script tenga permisos de acceso.`
    );
  }

  const nombreOriginal = archivo.getName();
  const carpetaDestino = DriveApp.getFolderById(FL_CONFIG.CARPETA_HISTORICOS_ID);

  // Crear una copia en históricos con nombre estandarizado
  // (se copia en lugar de mover para no perder el archivo en su ubicación original)
  const nombreNuevo = `historico_${cliente}_${rfpId}_${_fechaHoy()}`.replace(/\s+/g, "_");
  const copia = archivo.makeCopy(nombreNuevo, carpetaDestino);

  Logger.log(
    `[FeedbackLoop] Archivo copiado a históricos: "${nombreNuevo}" (ID: ${copia.getId()})`
  );
}

function aprobarQAJson(driveIdJson) {
  const archivo  = DriveApp.getFileById(driveIdJson);
  let datos;

  try {
    datos = JSON.parse(archivo.getBlob().getDataAsString());
  } catch (e) {
    throw new Error(`JSON inválido (ID: ${driveIdJson}): ${e.message}`);
  }

  datos.qa_pairs = datos.qa_pairs.map(qa => ({
    ...qa,
    confidence_humana: "aprobada"
  }));
  datos.fecha_aprobacion = new Date().toISOString();

  const blob = Utilities.newBlob(
    JSON.stringify(datos, null, 2),
    "application/json",
    archivo.getName()
  );

  Drive.Files.update({}, driveIdJson, blob);
  Logger.log(`[FeedbackLoop] ✅ QA JSON aprobado: ${archivo.getName()}`);
}


function _fechaHoy() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
}

function testLecturaColumnas() {
  const ss   = SpreadsheetApp.openById(FL_CONFIG.SPREADSHEET_ID);
  const hoja = ss.getSheetByName("rfps");
  const fila = hoja.getRange(2, 1, 1, hoja.getLastColumn()).getValues()[0];

  Logger.log("Columna ESTADO_APROBACION (col " + COL.ESTADO_APROBACION + "): '" + fila[COL.ESTADO_APROBACION - 1] + "'");
  Logger.log("Columna DRIVE_ID_FINAL    (col " + COL.DRIVE_ID_FINAL    + "): '" + fila[COL.DRIVE_ID_FINAL - 1]    + "'");
  Logger.log("Columna FECHA_MOVIDO      (col " + COL.FECHA_MOVIDO_HISTORICOS + "): '" + fila[COL.FECHA_MOVIDO_HISTORICOS - 1] + "'");
}

function diagnosticarFilas() {
  const ss    = SpreadsheetApp.openById(FL_CONFIG.SPREADSHEET_ID);
  const hoja  = ss.getSheetByName("rfps");
  const datos = hoja.getDataRange().getValues();

  for (let i = 1; i < datos.length; i++) {
    const fila             = datos[i];
    const rfpId            = fila[COL.RFP_ID - 1];
    const estadoAprobacion = fila[COL.ESTADO_APROBACION - 1];
    const driveIdFinal     = fila[COL.DRIVE_ID_FINAL - 1];
    const fechaMovido      = fila[COL.FECHA_MOVIDO_HISTORICOS - 1];

    Logger.log(
      `Fila ${i + 1} | rfp_id: "${rfpId}" | ` +
      `estado_aprobacion: "${estadoAprobacion}" (tipo: ${typeof estadoAprobacion}) | ` +
      `drive_id_final: "${driveIdFinal}" | ` +
      `fecha_movido: "${fechaMovido}"`
    );
  }
}