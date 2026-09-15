# **⚡ Agente Automatizado de RFPs & Asistente Virtual**

Una solución de nivel empresarial diseñada para automatizar la lectura, análisis y respuesta de **RFPs (Request for Proposals)** utilizando Inteligencia Artificial. Combina un entorno de backend asíncrono en **Google Apps Script**, la **API de Gemini (3.5-flash)** y un **Frontend interactivo en Modo Oscuro** alojado como Web App.

[![Demo App](https://img.shields.io/badge/Web_App-Live_Demo-blue?style=for-the-badge&logo=google)](https://script.google.com/macros/s/AKfycbxPPUvIZVCPplx7OFODIkgy1NnM0sNgEzjfEVbAKz23HZpEk2f888xzGq5XpprlP0Ah/exec)
![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-4285F4?style=flat&logo=google&logoColor=white)
![Gemini AI](https://img.shields.io/badge/Gemini_API-8E75B2?style=flat&logo=googlecloud&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)

## **🎯 ¿Qué problema resuelve este proyecto?**

El proceso tradicional de responder RFPs en empresas B2B implica revisar manualmente docenas de documentos pasados, copiar información técnica repetitiva y redactar respuestas personalizadas para cada cliente. 

Esta aplicación reduce el tiempo de procesamiento de **horas a minutos**:  
1\. Analiza solicitudes nuevas en **PDF** o **DOCX**.  
2\. Indexa de manera inteligente la base de conocimiento histórica de la empresa.  
3\. Genera respuestas automáticas clasificadas por nivel de confianza y compila un PDF final listo para revisión humana.  
4\. Provee un **Asistente Virtual** para realizar consultas técnicas en tiempo real.

## **🚀 Live Demo**

Prueba la aplicación directamente en el navegador sin necesidad de instalación:

👉 **\Acceder a la Web App en Vivo\:**(https://script.google.com/macros/s/AKfycbxPPUvIZVCPplx7OFODIkgy1NnM0sNgEzjfEVbAKz23HZpEk2f888xzGq5XpprlP0Ah/exec)

\---

## **🛠️ Arquitectura y Tecnologías**

graph TD
    
    UI[Interfaz Web App - HTML/CSS/JS] -->|Pestaña 1: Subir RFP| RFP[subirYProcesarRFP]
    UI -->|Pestaña 2: Chatbot| CHAT[enviarPreguntaChatWeb]
    
    RFP -->|Guarda documento| DRIVE[Google Drive novos/]
    CHAT -->|Registra mensaje| SHEETS[Google Sheets hoja chat]
    
    DRIVE --> GEMINI[Gemini API gemini-3.5-flash]
    SHEETS --> GEMINI
    
    GEMINI -->|Genera PDF & JSON| RES1[Actualiza Modal UI]
    GEMINI -->|Respuesta de Chat| RES2[Actualiza Chat UI]

* **Frontend:** HTML5, CSS3 Custom Properties (Dark Mode), Vanilla JS.

* **Backend:** Google Apps Script (Servidor de aplicaciones serverless).

* **AI Engine:** Google Gemini API (gemini-3.5-flash).

* **Base de Datos & Almacenamiento:** Google Sheets & Google Drive API.

## **✨ Características Principales**

### **📄 Pestaña 1: Módulo de Procesamiento de RFPs**

* **Subida Inmediata:** Interfaz gráfica para cargar archivos en formatos PDF y DOCX.

* **Extracción y Procesamiento:** Almacenamiento directo en Google Drive y extracción automática del ID de archivo.

* **Clasificación por Confianza:** Asigna niveles de certidumbre (alta, media, baja, revision\_humana) a cada respuesta generada por Gemini.

* **Descarga Automática:** Generación de un PDF estructurado en Google Drive listo para su descarga mediante notificaciones modal en pantalla.

### **💬 Pestaña 2: Chatbot Asistente con Base de Conocimiento**

* **Consultas Técnicas:** Interfaz de chat asíncrona para hacer preguntas sobre SLAs, certificaciones e infraestructura.

* **Polling de Respuestas:** Comunicación no bloqueante entre el cliente y el backend que busca respuestas procesadas en segundo plano.

* **Gestión de Sesión:** Manejo de variables de sesión (sessionStorage) para aislar hilos de conversación.

## **🔒 Consideraciones de Seguridad y Buenas Prácticas**

1. **Protección de API Keys:** La clave de la API de Gemini está almacenada de forma segura mediante PropertiesService.getScriptProperties() en el backend, evitando su exposición en el código fuente cliente.

2. **Delegación de Permisos (OAuth):** La aplicación web corre bajo el modelo *"Ejecutar como mi usuario"*, permitiendo a evaluadores externos interactuar con la app sin otorgarles acceso a las carpetas privadas de Drive ni a la base de datos de Sheets.

3. **Manejo de Rate Limits:** Implementación de esperas adaptativas (*exponential backoff / rate limiters*) en Apps Script para evitar saturación de cuota en el motor de IA.

## **📂 Estructura del Repositorio**

Plaintext  
├── script\_automatizacion.gs  \# Backend: Controladores, endpoints, integraciones de API y Sheets  
├── index.html                \# Frontend: Interfaz gráfica, estilos (CSS) y scripts de cliente (JS)  
├── README.md                 \# Documentación general del proyecto

## **👤 Autor**

**Raymond Almenares**
