/* =========================================================================
   PANEL ADMINISTRATIVO DE CARGUE
   Aplicación 1 de 2 — solo autenticación + cargue de fuentes.
   El cálculo y la visualización de indicadores viven en la aplicación
   "Resultados de los Indicadores".
   ========================================================================= */

/* =========================================================================
   0. Acceso al panel (login)
   -------------------------------------------------------------------------
   IMPORTANTE (seguridad): esta validación ocurre en el navegador, por lo que
   sirve para separar perfiles de uso y evitar cargues accidentales, NO para
   proteger datos sensibles frente a un atacante. Las reglas de Firestore y
   los permisos de Google Drive son la única barrera real. Si necesitas un
   control de acceso fuerte, migra este bloque a Firebase Authentication.
   ========================================================================= */

/* Usuarios habilitados. La contraseña se guarda como hash SHA-256 (nunca en
   texto plano). Para crear o cambiar una clave, abre la consola del navegador
   en esta página y ejecuta:  await sha256('la-nueva-clave')
   Luego pega el resultado en el campo hash del usuario.                     */
const USUARIOS = [
  // usuario: admin      · clave: Medisfarma2026
  { user:'admin',  nombre:'Administrador',       rol:'admin',
    hash:'214e992e31cd11d01de68a6f2b6e2a846adac1c1505245517f3d180aa156bab0' },
  // usuario: cargue     · clave: Cargue2026
  { user:'cargue', nombre:'Auxiliar de cargue',  rol:'cargue',
    hash:'0d4d41feb5bef5543a83f6c7ebcc05afba243a8507daeabefe885e7856acc237' }
];

const SESSION_KEY = 'panel_cargue_sesion';
let sesionActual = null;

/* Dirección de la app de resultados. Se puede configurar desde el propio
   panel (queda guardada en este navegador). */
const RESULTS_URL_KEY = 'panel_cargue_url_resultados';
function getResultsUrl(){ try{ return localStorage.getItem(RESULTS_URL_KEY) || ''; }catch(e){ return ''; } }
function setResultsUrl(u){ try{ localStorage.setItem(RESULTS_URL_KEY, u); }catch(e){} }

async function sha256(texto){
  const buf = new TextEncoder().encode(String(texto));
  const dig = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(dig)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

function loginError(msg){
  const el = document.getElementById('loginError');
  if(!el) return;
  if(!msg){ el.style.display='none'; el.textContent=''; return; }
  el.textContent = msg;
  el.style.display = 'block';
}

async function intentarLogin(){
  const btn  = document.getElementById('loginBtn');
  const user = String(document.getElementById('loginUser').value||'').trim().toLowerCase();
  const pass = String(document.getElementById('loginPass').value||'');
  loginError('');
  if(!user || !pass){ loginError('Escribe tu usuario y tu contraseña.'); return; }
  btn.disabled = true; btn.textContent = 'Verificando…';
  try{
    const hash = await sha256(pass);
    const u = USUARIOS.find(x => x.user === user && x.hash === hash);
    if(!u){
      loginError('Usuario o contraseña incorrectos.');
      document.getElementById('loginPass').value = '';
      return;
    }
    const sesion = { user:u.user, nombre:u.nombre, rol:u.rol, desde:new Date().toISOString() };
    try{ sessionStorage.setItem(SESSION_KEY, JSON.stringify(sesion)); }catch(e){}
    await abrirPanel(sesion);
  }catch(err){
    console.error(err);
    loginError('No se pudo validar el acceso en este navegador: '+err.message);
  }finally{
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}

function cerrarSesion(){
  try{ sessionStorage.removeItem(SESSION_KEY); }catch(e){}
  location.reload();
}

function leerSesionGuardada(){
  try{
    const raw = sessionStorage.getItem(SESSION_KEY);
    if(!raw) return null;
    const s = JSON.parse(raw);
    if(!s || !USUARIOS.some(u=>u.user===s.user)) return null;
    return s;
  }catch(e){ return null; }
}

/* Aplica los permisos del rol: el perfil "cargue" no puede borrar todo. */
function aplicarPermisos(rol){
  const soloAdmin = ['btnLimpiarTodo'];
  soloAdmin.forEach(id=>{
    const el = document.getElementById(id);
    if(el) el.style.display = (rol==='admin') ? '' : 'none';
  });
}

/* =========================================================================
   0b. Puentes hacia la app de resultados
   -------------------------------------------------------------------------
   El núcleo compartido llama a estas dos funciones cuando los datos cambian.
   En este panel no hay tableros, así que solo dejan una nota en pantalla.
   ========================================================================= */
function showEmptyResults(){
  const el = document.getElementById('cargueAviso');
  if(el) el.textContent = 'Los datos cambiaron. Abre "Resultados de los Indicadores" y vuelve a calcular para ver los tableros actualizados.';
}
function calcularIndicadores(){ /* no aplica en el panel de cargue */ }

/* =========================================================================
   1. DEFINICIÓN DE FUENTES (Tabla_1, Tabla_2, Tabla_4, Tabla_5, Tabla_6, Tabla_7)
   ========================================================================= */
const BODEGAS_PRINCIPAL = ['B05 ALTO COSTO', 'CENDIS PRINCIPAL TULUA PARQUE INDUSTRIAL'];

// Consolidado EPS: agrupa distintas siglas comerciales (con sufijos de régimen, etc.)
// bajo una sola EPS "madre" para poder filtrar de forma consolidada.
const EPS_GRUPO_MAP_RAW = {
  'ASMET SALUD EPS SAS':'ASMET SALUD','ASMET SALUD EPS SAS-CONTRIBUTIVO':'ASMET SALUD','ASMET SALUD EPS SAS-SUBSIDIADO':'ASMET SALUD',
  'COOSALUD CONTRIBUTIVO':'COOSALUD','COOSALUD SUBSIDIADO':'COOSALUD',
  'CRUZ VERDE CONTRIBUTIVO':'CRUZ VERDE','CRUZ VERDE SUBSIDIADO':'CRUZ VERDE',
  'E.P.S. SANITAS CONTRIBUTIVO':'SANITAS','E.P.S. SANITAS SUBSIDIADO':'SANITAS',
  'EPS FAMILIAR DE COLOMBIA SAS-CONTRIBUTIVO':'FAMILIAR','EPS FAMILIAR DE COLOMBIA SAS-SUBSIDIADO':'FAMILIAR',
  'FAMISANAR EPS CONTRIBUTIVO':'FAMISANAR','FAMISANAR EPS SUBSIDIADO':'FAMISANAR',
  'FIDEICOMISOS PATRIMONIOS AUTONOMOS FIDUCIARIA LA PREVISORA S.A-CAPITA':'FIDEICOMISOS','FIDEICOMISOS PATRIMONIOS AUTONOMOS FIDUCIARIA LA PREVISORA S.A-EVENTO':'FIDEICOMISOS',
  'NUEVA EMPRESA PROMOTORA DE SALUD S.A.-CONTRIBUTIVO':'NUEVA EPS','NUEVA EMPRESA PROMOTORA DE SALUD S.A.-TUTELAS':'NUEVA EPS','NUEVA EMPRESA PROMOTORA DE SALUD S.A.-TUTELAS SUB':'NUEVA EPS','NUEVA EMPRESA PROMOTORA DE SALUD S.A.-SUBSIDIADO':'NUEVA EPS',
  'POSITIVA COMPAÑÍA DE SEGUROS S.A.':'POSITIVA',
  'UNION TEMPORAL SALUD INTEGRAL MAISFEN':'MAISFEN',
  'EMSSANAR SUBSIDIADO':'EMSSANAR','EMSSANAR CONTRIBUTIVO':'EMSSANAR',
  'CAJA DE COMPENSACION FAMILIAR COMFENALCO VALLE':'COMFENALCO'
};
const EPS_GRUPO_MAP = new Map(Object.entries(EPS_GRUPO_MAP_RAW).map(([k,v])=>[normValue(k), v]));
function epsAGrupo(eps){
  const nv = normValue(eps);
  const g = EPS_GRUPO_MAP.get(nv);
  if(g) return g;
  // Nombres muy largos del archivo fuente: se muestran con su sigla corta.
  if(nv.includes('COMFENAL')) return 'COMFENALCO';
  if(nv.includes('EMSSANAR')) return 'EMSSANAR';
  if(nv.includes('MAISFEN')) return 'MAISFEN';
  return String(eps||'').trim() || 'N/D'; // si no está en la tabla, queda como su propia sigla (no se pierde)
}

// Correcciones de siglas mal codificadas / duplicadas que llegan del archivo fuente
// (acentos y "Ñ" rotos, espacios donde debería ir un punto, etc.). Se corrigen ANTES de
// filtrar/agrupar, así el selector "EPS / Sigla Comercial" no muestra duplicados.
const EPS_RAW_CORRECTIONS_RAW = {
  'NUEVA EMPRESA PROMOTORA DE SALUD S. A SUBSIDIADO': 'NUEVA EMPRESA PROMOTORA DE SALUD S.A.-SUBSIDIADO',
  'POSITIVA CAMPAÑ A A DE SEGUROS S. A.': 'POSITIVA COMPAÑÍA DE SEGUROS S.A.'
};
const EPS_RAW_CORRECTIONS = new Map(Object.entries(EPS_RAW_CORRECTIONS_RAW).map(([k,v])=>[normValue(k), v]));
function corregirEps(epsRaw){
  const original = String(epsRaw||'').trim();
  if(!original) return original;
  const nv = normValue(original);
  if(EPS_RAW_CORRECTIONS.has(nv)) return EPS_RAW_CORRECTIONS.get(nv);
  // Reglas genéricas de respaldo, por si aparecen otras variantes con el mismo problema
  // de codificación que no están listadas explícitamente arriba.
  if(nv.includes('NUEVA EMPRESA PROMOTORA') && nv.includes('SUBSIDIADO')) return 'NUEVA EMPRESA PROMOTORA DE SALUD S.A.-SUBSIDIADO';
  if(nv.includes('POSITIVA') && nv.includes('SEGUROS')) return 'POSITIVA COMPAÑÍA DE SEGUROS S.A.';
  return original;
}

const DATASETS = [
  {
    key: 'reporte', tabla: 'Tabla_1', title: 'Reporte de Dispensación', required: true, accumulate: true,
    desc: 'Base transaccional principal. Cargue diario: cada archivo que subas se ACUMULA con lo ya guardado (no lo reemplaza); las filas repetidas se descartan automáticamente. Esta tarjeta ya NO acepta cargue manual: sus datos provienen exclusivamente de la carpeta de Google Drive.',
    cols: ['Documento','Fecha de Dispensación','EPS','Contrato','Código de Articulo','Descripción','Unidades','Cantidad Autorizada','Diferencia','Bodega Detalle','Soporte','Estado','Usuario Creación','DESCRIPCION CIE 10'],
    fields: {
      documento: ['DOCUMENTO'],
      codigoCie10: ['DESCRIPCION CIE 10','DESCRIPCIÓN CIE 10','DESCRIPCION CIE10','DESCRIPCIÓN CIE10','DESCRIPCION CIE-10','DESCRIPCION DIAGNOSTICO','DIAGNOSTICO','DIAGNÓSTICO','CODIGO CIE 10','CODIGO CIE10','CODIGO CIE-10','CÓDIGO CIE 10','CIE 10','CIE10','CIE-10'],
      estadoDispensa: ['ESTADO','ESTADO DISPENSA','ESTADO DE LA DISPENSA','ESTADO DE DISPENSA'],
      usuarioCreacion: ['USUARIO CREACION','USUARIO CREACIÓN','USUARIO DE CREACION','USUARIO DE CREACIÓN','USUARIO CREADOR','USUARIO'],
      fechaDispensacion: ['FECHA DE DISPENSACION','FECHA DISPENSACION','FECHA DISPENSACIÓN','FECHA DISPENSA','FECHA'],
      // La columna de EPS puede venir con el nombre largo del archivo original:
      // "Sigla Comercial Cliente/EPS(Entidad OutSorcing)" (con o sin espacios/paréntesis),
      // o abreviada como "EPS(Entidad OutSorcing)".
      eps: ['EPS','EPS(ENTIDAD OUTSORCING)','EPS (ENTIDAD OUTSORCING)','EPS(ENTIDAD OUTSOURCING)','EPS (ENTIDAD OUTSOURCING)','SIGLA COMERCIAL CLIENTE/EPS(ENTIDAD OUTSORCING)','SIGLA COMERCIAL CLIENTE/EPS (ENTIDAD OUTSORCING)','SIGLA COMERCIAL CLIENTE/EPS(ENTIDAD OUTSOURCING)','SIGLA COMERCIAL CLIENTE/EPS (ENTIDAD OUTSOURCING)','SIGLA COMERCIAL CLIENTE/EPS','SIGLA COMERCIAL DEL CLIENTE/EPS','SIGLA COMERCIAL CLIENTE','SIGLA COMERCIAL DEL CLIENTE','SIGLA COMERCIAL','ENTIDAD OUTSORCING','ENTIDAD OUTSOURCING'],
      contrato: ['CONTRATO'],
      // "Codigo" del reporte = "Codigo Articulo" del archivo original.
      codigoArticulo: ['CODIGO ARTICULO','CODIGO DE ARTICULO','CODIGO ARTÍCULO','CÓDIGO ARTICULO','CÓDIGO ARTÍCULO','CODIGO','CÓDIGO','CODIGO ARTICLE','COD ARTICULO','COD. ARTICULO','COD ARTICLE','ID ARTICULO'],
      descripcion: ['DESCRIPCION','DESCRIPCIÓN','DESCRIPCION ARTICULO','DESCRIPCIÓN ARTICULO','NOMBRE ARTICULO','ARTICULO'],
      unidades: ['UNIDADES','UNIDADES DISPENSADAS','CANTIDAD DISPENSADA'],
      cantidadAutorizada: ['CANTIDAD AUTORIZADA','CANT AUTORIZADA','CANTIDAD AUTORIZADO'],
      diferencia: ['DIFERENCIA'],
      bodegaDetalle: ['BODEGA DETALLE','BODEGA','BODEGADETALLE'],
      // "Soporte" del reporte = "Cantidad Soportes" del archivo original.
      soportes: ['CANTIDAD SOPORTES','CANTIDAD SOPORTE','CANTIDAD DE SOPORTES','SOPORTE','SOPORTES','NRO SOPORTES','NUMERO SOPORTES']
    }
  },
  {
    key: 'homologo', tabla: 'Tabla_4', title: 'Homólogo', required: true,
    desc: 'Catálogo maestro: código de artículo, homólogo y si la molécula es Pareto.',
    cols: ['Codigo','Articulo','Homologo','Descripción DCI','Molecula Pareto'],
    fields: {
      codigo: ['CODIGO','CÓDIGO','COD ARTICULO','COD. ARTICULO','CODIGO ARTICULO','CODIGO DE ARTICULO'],
      articulo: ['ARTICULO'],
      homologo: ['HOMOLOGO','HOMÓLOGO'],
      descripcionDci: ['DESCRIPCION DCI','DESCRIPCIÓN DCI'],
      moleculaPareto: ['MOLECULA PARETO','MOLÉCULA PARETO','PARETO','TIPO PARETO','CLASIFICACION PARETO']
    }
  },
  {
    key: 'bodegas', tabla: 'Tabla_5', title: 'Bodega y Zona', required: true,
    desc: 'Catálogo de bodegas con su zona asociada.',
    cols: ['Bodega','Zona'],
    fields: { bodega: ['BODEGA'], zona: ['ZONA'] }
  },
  {
    key: 'agotados', tabla: 'Tabla_7', title: 'Estado de la Molécula', required: true,
    desc: 'Estado de disponibilidad por molécula/código (agotado o disponible).',
    cols: ['Molecula','Estado'],
    fields: { codigoArticulo: ['MOLECULA'], estado: ['ESTADO'] }
  },
  {
    key: 'inventario', tabla: 'Tabla_2', title: 'Inventario del Punto', required: true,
    desc: 'Existencias por artículo y bodega. El Homólogo se cruza automáticamente con la tabla Homólogo.',
    cols: ['Codigo','Bodega Detalle','Unidades','Fecha de Vencimiento'],
    fields: {
      codigoArticulo: ['CODIGO'],
      bodegaDetalle: ['BODEGA DETALLE'],
      unidades: ['UNIDADES'],
      fechaVencimiento: ['FECHA DE VENCIMIENTO','FECHA VENCIMIENTO','FECHA VTO','VENCIMIENTO','FECHA VENC.']
    }
  },
  {
    key: 'sigla', tabla: 'Tabla_6', title: 'Sigla Comercial (EPS)', required: false,
    desc: 'Catálogo de siglas comerciales de cliente / EPS, usado como referencia para el filtro.',
    cols: ['Sigla Comercial del Cliente'],
    fields: { sigla: ['SIGLA COMERCIAL DEL CLIENTE','SIGLA COMERCIAL CLIENTE','SIGLA'] }
  },
  {
    key: 'traslados', tabla: 'Tabla_8', title: 'Traslados', required: false, accumulate: true,
    desc: 'Traslados entre bodegas realizados por cada usuario. Los datos provienen exclusivamente de la carpeta de Google Drive y se ACUMULAN: cada sincronización suma los traslados nuevos y no borra lo ya cargado. El Codigo se cruza con la tabla Homólogo para saber si la molécula es Pareto o No Pareto.',
    cols: ['Traslado','Fecha','Bodega Origen','Bodega Destino','Codigo','Descripcion','Cantidad','Recibido','Usuario'],
    fields: {
      traslado: ['TRASLADO','NRO TRASLADO','NUMERO TRASLADO','NÚMERO TRASLADO','No TRASLADO','DOCUMENTO TRASLADO','DOCUMENTO','CONSECUTIVO'],
      fecha: ['FECHA','FECHA TRASLADO','FECHA DE TRASLADO','FECHA DEL TRASLADO'],
      bodegaOrigen: ['BODEGA ORIGEN','BODEGA DE ORIGEN','ORIGEN','BODEGA SALIDA'],
      bodegaDestino: ['BODEGA DESTINO','BODEGA DE DESTINO','DESTINO','BODEGA LLEGADA'],
      codigo: ['CODIGO','CÓDIGO','CODIGO ARTICULO','CODIGO DE ARTICULO','COD ARTICULO','COD. ARTICULO'],
      descripcion: ['DESCRIPCION','DESCRIPCIÓN','DESCRIPCION ARTICULO','DESCRIPCIÓN ARTICULO','ARTICULO','NOMBRE ARTICULO','PRODUCTO'],
      cantidad: ['CANTIDAD','CANTIDAD TRASLADADA','UNIDADES','CANT','CANT.'],
      // Estado de recepción del traslado: 'Recibido' o 'No Recibido'. Solo las líneas
      // NO recibidas se consideran pendientes en la Base Supervisores.
      recibido: ['RECIBIDO','RECIBIDA','ESTADO RECIBIDO','ESTADO DEL TRASLADO','ESTADO TRASLADO','ESTADO','RECEPCION','RECEPCIÓN'],
      usuario: ['USUARIO','USUARIO CREACION','USUARIO CREACIÓN','USUARIO QUE REALIZA','USUARIO TRASLADO','RESPONSABLE']
    }
  },
  {
    key: 'facturas', tabla: 'Tabla_9', title: 'Facturas', required: false, accumulate: true,
    desc: 'Facturas por punto de venta. Los datos provienen exclusivamente de la carpeta de Google Drive y se ACUMULAN: cada sincronización suma las facturas nuevas y no borra lo ya cargado. El Codigo se cruza con la tabla Homólogo para saber si el código está homologado o no.',
    cols: ['Fecha Factura','Factura','Codigo','Descripcion','Cantidad','Punto de venta'],
    fields: {
      fechaFactura: ['FECHA FACTURA','FECHA DE FACTURA','FECHA DE LA FACTURA','FECHA FACTURACION','FECHA FACTURACIÓN','FECHA'],
      factura: ['FACTURA','NRO FACTURA','NUMERO FACTURA','NÚMERO FACTURA','No FACTURA','NUMERO DE FACTURA','DOCUMENTO','CONSECUTIVO'],
      codigo: ['CODIGO','CÓDIGO','CODIGO ARTICULO','CODIGO DE ARTICULO','COD ARTICULO','COD. ARTICULO','CODIGO ARTICLE'],
      descripcion: ['DESCRIPCION','DESCRIPCIÓN','DESCRIPCION ARTICULO','DESCRIPCIÓN ARTICULO','ARTICULO','NOMBRE ARTICULO'],
      cantidad: ['CANTIDAD','CANTIDADES','UNIDADES','CANT','CANT.'],
      puntoVenta: ['PUNTO DE VENTA','PUNTO VENTA','PUNTOVENTA','PUNTO','BODEGA','BODEGA DETALLE','SUCURSAL','PDV']
    }
  },
  {
    key: 'invfisico', tabla: 'Tabla_10', title: 'Inventario Físico (conteo)', required: false,
    desc: 'Conteo físico de inventario por bodega. Los datos provienen exclusivamente de la carpeta de Google Drive y se reemplazan por completo en cada sincronización. Se cruza con el Inventario del Punto por Bodega Detalle + Codigo.',
    cols: ['Codigo','Bodega Detalle','Unidades en fisico'],
    fields: {
      codigoArticulo: ['CODIGO','CÓDIGO','CODIGO ARTICULO','CODIGO DE ARTICULO','COD ARTICULO','COD. ARTICULO'],
      bodegaDetalle: ['BODEGA DETALLE','BODEGA','BODEGADETALLE','BODEGA DE DETALLE'],
      unidades: ['UNIDADES EN FISICO','UNIDADES EN FÍSICO','UNIDADES FISICAS','UNIDADES FÍSICAS','UNIDADES FISICO','UNIDADES','CANTIDAD FISICA','CANTIDAD FÍSICA','CANTIDAD','CONTEO']
    }
  }
];

/* =========================================================================
   2. Firebase Cloud Firestore — persistencia en la nube con respaldo en
      memoria si Firebase no está disponible (p.ej. sin conexión a internet)
   ========================================================================= */
const COLLECTION = 'datasets';
let dbFailed = false;
const memoryStore = new Map(); // respaldo local: key -> record (solo dura la sesión)
let _unsubscribe = null; // onSnapshot unsubscribe handle
let _localWriteActive = false;   // true while THIS client is writing
let _snapshotDebounce = null;    // debounce timer for snapshot-driven refreshes

// Firestore-ready check
function isFirestoreReady(){
  return typeof dbFirestore !== 'undefined' && dbFirestore !== null && !dbFailed;
}

let modoMemoriaAvisado = false;
function activarModoMemoria(err){
  dbFailed = true;
  console.warn('Firebase no disponible, usando memoria temporal (sin persistencia en la nube):', err);
  if (modoMemoriaAvisado) return;
  modoMemoriaAvisado = true;
  const warn = document.getElementById('persistenceWarning');
  if (warn) warn.style.display = 'flex';
  updateTopStatus();
}


/* --- Serialización para Firestore (1 MB límite por documento) --- */
// Firestore limita cada documento a ~1 MB. Para datasets grandes serializamos
// el array `rows` como JSON string en el campo `rowsJSON` y lo guardamos por
// fragmentos si es necesario.
const FIRESTORE_DOC_LIMIT = 900000; // bytes, margen de seguridad

function utf8ByteLength(s){
  return new Blob([s]).size;
}
function serializeForFirestore(record){
  // Si rows es pequeño, se guarda directamente como array.
  // Si es grande, se serializa como JSON string en rowsJSON.
  const rowsCopy = record.rows;
  const testJSON = JSON.stringify(rowsCopy);
  if(utf8ByteLength(testJSON) < FIRESTORE_DOC_LIMIT){
    // cabe como array nativo
    return { key: record.key, rows: rowsCopy, fileName: record.fileName || '',
             batches: record.batches || null, updatedAt: record.updatedAt || new Date().toISOString() };
  }
  // Demasiado grande: serializar rows como string
  return { key: record.key, rowsJSON: testJSON, fileName: record.fileName || '',
           batches: record.batches ? JSON.stringify(record.batches) : null,
           updatedAt: record.updatedAt || new Date().toISOString() };
}
function deserializeFromFirestore(doc){
  if(!doc.exists) return null;
  const d = doc.data();
  let rows = d.rows || [];
  if(d.rowsJSON){
    try { rows = JSON.parse(d.rowsJSON); } catch(e){ console.error('Error parsing rowsJSON for', d.key, e); rows = []; }
  }
  let batches = d.batches || null;
  if(typeof d.batches === 'string'){
    try { batches = JSON.parse(d.batches); } catch(e){ batches = null; }
  }
  return { key: d.key, rows, fileName: d.fileName || '', batches, updatedAt: d.updatedAt || '' };
}

/* =========================================================================
   2-bis. Almacen LOCAL (IndexedDB) para las tarjetas que dependen UNICAMENTE
   de Google Drive: "Inventario del Punto" y "Reporte de Dispensacion".
   Estas dos NO usan Firebase (ni Firestore ni Firebase Auth): sus datos salen
   de sus carpetas de Drive y se guardan en el navegador.
   Se usa IndexedDB (no localStorage) porque el acumulado del Reporte puede
   superar facilmente la cuota de localStorage.
   ========================================================================= */
const DRIVE_ONLY_KEYS = ['inventario', 'reporte', 'homologo', 'traslados', 'facturas', 'invfisico'];
function isDriveOnlyKey(k){ return DRIVE_ONLY_KEYS.indexOf(k) >= 0; }

const LOCAL_DB_NAME = 'medisfarma_drive_local';
const LOCAL_DB_STORE = 'datasets';
let _localDbPromise = null;

function localDbOpen(){
  if(_localDbPromise) return _localDbPromise;
  _localDbPromise = new Promise(resolve => {
    try{
      if(typeof indexedDB === 'undefined' || !indexedDB){ resolve(null); return; }
      const req = indexedDB.open(LOCAL_DB_NAME, 1);
      req.onupgradeneeded = function(){
        const db = req.result;
        if(!db.objectStoreNames.contains(LOCAL_DB_STORE)) db.createObjectStore(LOCAL_DB_STORE, { keyPath: 'key' });
      };
      req.onsuccess = function(){ resolve(req.result); };
      req.onerror = function(){ console.warn('IndexedDB no disponible:', req.error); resolve(null); };
    }catch(e){ console.warn('IndexedDB no disponible:', e); resolve(null); }
  });
  return _localDbPromise;
}
function localTx(mode, fn){
  return localDbOpen().then(db => {
    if(!db) return null;
    return new Promise(resolve => {
      let out = null;
      try{
        const tx = db.transaction(LOCAL_DB_STORE, mode);
        const store = tx.objectStore(LOCAL_DB_STORE);
        const req = fn(store);
        if(req) req.onsuccess = function(){ out = req.result; };
        tx.oncomplete = function(){ resolve(out); };
        tx.onerror = function(){ console.warn('IndexedDB tx error:', tx.error); resolve(null); };
        tx.onabort = function(){ console.warn('IndexedDB tx abort:', tx.error); resolve(null); };
      }catch(e){ console.warn('IndexedDB tx fallo:', e); resolve(null); }
    });
  });
}
function localPutRecord(record){
  const plain = { key: record.key, rows: record.rows || [], fileName: record.fileName || '',
                  batches: record.batches || null, updatedAt: record.updatedAt || new Date().toISOString() };
  return localTx('readwrite', store => store.put(plain));
}
function localGetRecord(key){ return localTx('readonly', store => store.get(key)); }
function localDeleteRecord(key){ return localTx('readwrite', store => store.delete(key)); }

/* --- Operaciones CRUD --- */

async function idbPut(record) {
  // Inventario y Reporte: solo navegador (IndexedDB), sin Firestore
  if (isDriveOnlyKey(record.key)) {
    memoryStore.set(record.key, record);
    await localPutRecord(record);
    if (record.key === 'inventario') {
      // Copia ligera de respaldo (el inventario suele ser pequeno)
      try {
        localStorage.setItem('inventario_data', JSON.stringify({ rows: record.rows, fileName: record.fileName, updatedAt: record.updatedAt, rowCount: record.rows.length }));
      } catch(e) { /* quota: IndexedDB ya tiene el dato */ }
    }
    return;
  }

  const docData = serializeForFirestore(record);
  _localWriteActive = true;
  try {
    if(!isFirestoreReady()) throw new Error('Firestore not initialized');
    await dbFirestore.collection(COLLECTION).doc(record.key).set(docData, {merge:true});
  } catch (err) {
    activarModoMemoria(err);
    memoryStore.set(record.key, record);
  } finally {
    // Dar tiempo al onSnapshot local a llegar y ser ignorado
    setTimeout(() => { _localWriteActive = false; }, 500);
  }
}
async function idbGetAll() {
  // Inventario y Reporte vienen del almacen local (Drive), nunca de Firestore
  const localRecs = [];
  for (let i = 0; i < DRIVE_ONLY_KEYS.length; i++) {
    const rec = await idbGet(DRIVE_ONLY_KEYS[i]);
    if (rec && rec.rows) localRecs.push(rec);
  }
  let remote;
  try {
    if(!isFirestoreReady()) throw new Error('Firestore not initialized');
    const snap = await dbFirestore.collection(COLLECTION).get();
    remote = snap.docs.map(d => deserializeFromFirestore(d)).filter(Boolean).filter(r => !isDriveOnlyKey(r.key));
  } catch (err) {
    activarModoMemoria(err);
    remote = Array.from(memoryStore.values()).filter(r => !isDriveOnlyKey(r.key));
  }
  return remote.concat(localRecs);
}
async function idbGet(key) {
  if (isDriveOnlyKey(key)) {
    const mem = memoryStore.get(key);
    if (mem) return mem;
    const rec = await localGetRecord(key);
    if (rec && rec.rows) { memoryStore.set(key, rec); return rec; }
    if (key === 'inventario') {
      // Respaldo antiguo en localStorage
      try {
        const stored = localStorage.getItem('inventario_data');
        if (stored) {
          const data = JSON.parse(stored);
          const r = { key: 'inventario', rows: data.rows || [], fileName: data.fileName || '', batches: null, updatedAt: data.updatedAt || '' };
          memoryStore.set('inventario', r);
          return r;
        }
      } catch(e) { /* ignorar */ }
    }
    return null;
  }

  try {
    if(!isFirestoreReady()) throw new Error('Firestore not initialized');
    const doc = await dbFirestore.collection(COLLECTION).doc(key).get();
    return deserializeFromFirestore(doc);
  } catch (err) {
    activarModoMemoria(err);
    return memoryStore.get(key) || null;
  }
}
async function idbDelete(key) {
  // Inventario y Reporte: solo limpiar almacen local del navegador
  if (isDriveOnlyKey(key)) {
    memoryStore.delete(key);
    await localDeleteRecord(key);
    if (key === 'inventario') {
      try { localStorage.removeItem('inventario_data'); } catch(e) {}
      try { localStorage.removeItem('inventario_drive_files'); } catch(e) {}
      _driveFiles = [];
    } else if (key === 'reporte') {
      try { localStorage.removeItem('reporte_drive_files'); } catch(e) {}
      _driveFilesReporte = [];
    } else if (key === 'homologo') {
      // Homologo NO usa localStorage: solo memoria + IndexedDB
      _driveFilesHomologo = [];
    } else if (key === 'traslados') {
      // Traslados NO usa localStorage: solo memoria + IndexedDB
      _driveFilesTraslados = [];
    } else if (key === 'facturas') {
      // Facturas NO usa localStorage: solo memoria + IndexedDB
      _driveFilesFacturas = [];
    } else if (key === 'invfisico') {
      // Inventario Fisico NO usa localStorage: solo memoria + IndexedDB
      _driveFilesInvFisico = [];
    }
    delete state.loaded[key];
    return;
  }

  _localWriteActive = true;
  try {
    if(!isFirestoreReady()) throw new Error('Firestore not initialized');
    await dbFirestore.collection(COLLECTION).doc(key).delete();
  } catch (err) {
    activarModoMemoria(err);
    memoryStore.delete(key);
  } finally {
    setTimeout(() => { _localWriteActive = false; }, 500);
  }
}
async function idbClearAll() {
  // Inventario y Reporte: limpiar el almacen local del navegador
  for (let i = 0; i < DRIVE_ONLY_KEYS.length; i++) {
    memoryStore.delete(DRIVE_ONLY_KEYS[i]);
    await localDeleteRecord(DRIVE_ONLY_KEYS[i]);
    delete state.loaded[DRIVE_ONLY_KEYS[i]];
  }
  try { localStorage.removeItem('inventario_data'); } catch(e) {}
  try { localStorage.removeItem('inventario_drive_files'); } catch(e) {}
  try { localStorage.removeItem('reporte_drive_files'); } catch(e) {}
  _driveFiles = [];
  _driveFilesReporte = [];
  _driveFilesHomologo = [];
  _driveFilesTraslados = [];
  _driveFilesFacturas = [];
  _driveFilesInvFisico = [];
  _localWriteActive = true;
  try {
    if(!isFirestoreReady()) throw new Error('Firestore not initialized');
    const snap = await dbFirestore.collection(COLLECTION).get();
    const batch = dbFirestore.batch();
    snap.docs.forEach(d => batch.delete(d.ref));
    if(snap.docs.length) await batch.commit();
  } catch (err) {
    activarModoMemoria(err);
    memoryStore.clear();
  } finally {
    setTimeout(() => { _localWriteActive = false; }, 500);
  }
}

/* --- Real-time listener (onSnapshot) --- */

function startFirestoreListener(){
  if(!isFirestoreReady()) return;
  if(_unsubscribe) return; // ya activo
  _unsubscribe = dbFirestore.collection(COLLECTION).onSnapshot(snap => {
    // Si estamos en medio de una escritura local (cargue/borrado),
    // refreshStatusFromDB ya refresca la UI. Evitamos duplicar.
    if(_localWriteActive){ return; }
    // Debounce: si llegan varios snaps rápidos, solo el último dispara
    clearTimeout(_snapshotDebounce);
    _snapshotDebounce = setTimeout(() => {
      const records = snap.docs.map(d => deserializeFromFirestore(d)).filter(Boolean);
      // Conservar el estado de las tarjetas que solo dependen de Drive:
      // Firestore no las controla y no debe borrarlas de la interfaz.
      const keepDriveOnly = {};
      DRIVE_ONLY_KEYS.forEach(k => { if(state.loaded[k]) keepDriveOnly[k] = state.loaded[k]; });
      state.loaded = Object.assign({}, keepDriveOnly);
      const filteredRecords = records.filter(r => !isDriveOnlyKey(r.key));
      filteredRecords.forEach(rec => {
        state.loaded[rec.key] = {
          rowCount: rec.rows.length,
          fileName: rec.fileName,
          updatedAt: rec.updatedAt,
          batches: rec.batches || null
        };
      });
      renderUploadCards();
      updateTopStatus();
      updateCalcButton();
      // Si ya hay un cálculo procesado y los datos cambiaron (vienen de otro
      // dispositivo), recalcular automáticamente.
      if(state.processed){
        calcularIndicadores();
      }
    }, 300);
  }, err => {
    console.warn('Firestore onSnapshot error:', err);
    if(err && err.code === 'permission-denied'){
      activarModoMemoria(err);
      stopFirestoreListener();
    }
  });
}
function stopFirestoreListener(){
  if(_unsubscribe){ _unsubscribe(); _unsubscribe = null; }
}


/* =========================================================================
   3. Utilidades
   ========================================================================= */
function stripAccents(s){return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'');}
function normHeader(s){return stripAccents(String(s||'')).toUpperCase().replace(/\s+/g,' ').trim();}
/* Version "compacta" del nombre de una columna: solo letras y numeros. Permite que
   "EPS(Entidad OutSorcing)", "EPS (ENTIDAD OUTSORCING)" y "eps entidad outsorcing"
   se reconozcan como la MISMA columna, sin tener que listar cada variante. */
function compactHeader(s){return normHeader(s).replace(/[^A-Z0-9]/g,'');}
function normValue(s){if(s===null||s===undefined)return '';return stripAccents(String(s)).toUpperCase().trim();}
/* Códigos que NO corresponden a un medicamento (servicios, cobros, domicilios, etc.).
   Aunque la columna Diferencia sea negativa, estas líneas no se cuentan como pendientes
   ni como líneas por subsanar en ningún indicador. */
const CODIGOS_NO_MEDICAMENTO=new Set(['M000339']);
function esCodigoNoMedicamento(codigo, descripcion){
  const cod=normValue(codigo);
  if(CODIGOS_NO_MEDICAMENTO.has(cod)) return true;
  // Respaldo por descripción: cualquier cobro de domicilio (con o sin IVA).
  return normValue(descripcion).indexOf('DOMICILIO')>=0;
}
function toNumber(v){
  if (v===null||v===undefined||v==='') return 0;
  if (typeof v==='number') return v;
  // Los CSV llegan como texto: admitimos separadores de miles y coma decimal.
  let s=String(v).trim().replace(/\s/g,'');
  if(/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s=s.replace(/\./g,'').replace(',','.');
  else if(/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s=s.replace(/,/g,'');
  else if(/^-?\d+,\d+$/.test(s)) s=s.replace(',','.');
  const n2 = parseFloat(s);
  return isNaN(n2) ? 0 : n2;
}
function excelSerialToDate(n){const utcDays=Math.floor(n-25569);return new Date(utcDays*86400*1000);}
function toDateSafe(v){
  if (v===null||v===undefined||v==='') return null;
  if (v instanceof Date && !isNaN(v)) return v;
  if (typeof v==='number') return excelSerialToDate(v);
  const s=String(v).trim();
  let m=s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if(m){let [,d,mo,y]=m; if(y.length===2)y='20'+y; const dt=new Date(Date.UTC(+y,+mo-1,+d)); if(!isNaN(dt))return dt;}
  m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if(m){const [,y,mo,d]=m; const dt=new Date(Date.UTC(+y,+mo-1,+d)); if(!isNaN(dt))return dt;}
  const dt2=new Date(s); return isNaN(dt2)?null:dt2;
}
function dateToISO(d){ if(!d) return ''; return d.toISOString().slice(0,10); }
function fmtInt(n){ if(n===null||n===undefined||isNaN(n)) return '—'; return n.toLocaleString('es-CO'); }
function fmtPct(n){ if(n===null||n===undefined||isNaN(n)) return '—'; return (n*100).toFixed(1)+'%'; }
function escHtml(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function pctClass(n){ if(n===null||n===undefined||isNaN(n)) return ''; if(n>=0.85) return 'pct-good'; if(n>=0.6) return 'pct-mid'; return 'pct-bad'; }
// Escala para indicadores de EFICIENCIA (entre más alto, mejor): >98% verde, 80%-98% amarillo, <80% rojo
function effClass(n){ if(n===null||n===undefined||isNaN(n)) return ''; if(n>0.98) return 'pct-good'; if(n>=0.80) return 'pct-mid'; return 'pct-bad'; }
// Escala para el ÍNDICE DE PENDIENTES (entre más bajo, mejor): <3% verde, 3%-80% amarillo, >80% rojo
function pendClass(n){ if(n===null||n===undefined||isNaN(n)) return ''; if(n<0.03) return 'pct-good'; if(n<=0.80) return 'pct-mid'; return 'pct-bad'; }
function showToast(msg,isError){
  const t=document.getElementById('toast'); t.textContent=msg;
  t.className='toast show'+(isError?' error':''); clearTimeout(showToast._h);
  showToast._h=setTimeout(()=>{t.className='toast';},3600);
}

/* =========================================================================
   4. Parseo de archivos
   ========================================================================= */
/* Palabras clave de respaldo: si ninguno de los alias exactos existe en el archivo,
   se busca un encabezado parecido. Se usan textos LARGOS y específicos a propósito:
   el archivo del Reporte trae unas 130 columnas y muchas comparten palabras
   ("Codigo Barras", "Estado de Facturacion", "Usuario Modificacion", "Bodega Origen"),
   así que una palabra suelta como "CODIGO" tomaría la columna equivocada y los datos
   quedarían mezclados. */
const FIELD_FALLBACK_KEYWORDS = {
  codigoCie10: ['DESCRIPCION CIE 10','DESCRIPCION CIE','CIE 10','CIE10','CIE-10','DESCRIPCION DIAGNOSTICO'],
  estadoDispensa: ['ESTADO DISPENSA','ESTADO DE LA DISPENSA','ESTADO DE DISPENSA'],
  usuarioCreacion: ['USUARIO CREACION','USUARIO DE CREACION','USUARIO CREADOR'],
  bodegaDetalle: ['BODEGA DETALLE','BODEGA'],
  fechaDispensacion: ['FECHA DISPENS','FECHA DE DISPENS'],
  cantidadAutorizada: ['CANTIDAD AUTORIZADA','CANT AUTORIZADA','CANTIDAD AUTORIZ'],
  soportes: ['CANTIDAD SOPORTES','CANTIDAD DE SOPORTES','CANTIDAD SOPORTE'],
  documento: ['DOCUMENTO'],
  eps: ['EPS(ENTIDAD OUTSORCING)','EPS (ENTIDAD OUTSORCING)','ENTIDAD OUTSORCING','ENTIDAD OUTSOURCING','SIGLA COMERCIAL CLIENTE','SIGLA COMERCIAL'],
  codigoArticulo: ['CODIGO ARTICULO','CODIGO DE ARTICULO','COD ARTICULO','ID ARTICULO'],
  unidades: ['UNIDADES DISPENSADAS','UNIDADES'],
  descripcion: ['DESCRIPCION ARTICULO','NOMBRE ARTICULO'],
  contrato: ['CONTRATO'],
  diferencia: ['DIFERENCIA'],
  // Columna "Recibido" de Traslados (valores tipo Recibido / No Recibido)
  recibido: ['RECIBIDO','ESTADO RECIB','NO RECIBIDO']
};
/* Busca una columna por palabra clave, pero SIEMPRE prefiriendo la coincidencia más
   precisa. En un archivo con ~130 columnas hay muchos encabezados que contienen
   "ESTADO", "CODIGO", "FECHA" o "DESCRIPCION", así que se revisa en este orden:
     1) el encabezado es exactamente la palabra buscada,
     2) el encabezado EMPIEZA por la palabra buscada,
     3) el encabezado contiene la palabra buscada (último recurso).
   Así "Estado" gana sobre "Estado de facturación" y no se toma una columna vecina. */
function findHeaderByKeyword(headerIndex, keywords){
  for (const kw of keywords){
    const objetivo = compactHeader(kw);
    if (!objetivo) continue;
    let porInicio = -1, porContenido = -1;
    for (const h of headerIndex.keys()){
      const ch = compactHeader(h);
      if (ch === objetivo) return headerIndex.get(h);
      if (porInicio < 0 && ch.startsWith(objetivo)) porInicio = headerIndex.get(h);
      if (porContenido < 0 && ch.includes(objetivo)) porContenido = headerIndex.get(h);
    }
    if (porInicio >= 0) return porInicio;
    if (porContenido >= 0) return porContenido;
  }
  return -1;
}
/* Índice de encabezados del archivo: nombre de columna → posición.
   Se guarda además una versión "compacta" (sin espacios, puntos ni paréntesis) para
   que "EPS(Entidad OutSorcing)" y "EPS (ENTIDAD OUTSORCING)" se reconozcan igual. */
function buildHeaderIndex(headerRow){
  const idx = new Map();
  const compact = new Map();
  (headerRow || []).forEach((h, i) => {
    const nh = normHeader(h);
    if (!nh) return;
    if (!idx.has(nh)) idx.set(nh, i);
    const ch = compactHeader(h);
    if (ch && !compact.has(ch)) compact.set(ch, i);
  });
  idx.compact = compact;
  return idx;
}
/* Ubica una columna por su nombre: primero tal cual, luego en versión compacta. */
function headerLookup(headerIndex, nombreColumna){
  const nh = normHeader(nombreColumna);
  if (headerIndex.has(nh)) return headerIndex.get(nh);
  const compact = headerIndex.compact;
  if (compact){
    const ch = compactHeader(nombreColumna);
    if (ch && compact.has(ch)) return compact.get(ch);
  }
  return -1;
}

/* ---------- Columnas OBLIGATORIAS por tabla ----------
   Sin estas columnas el archivo no sirve: los cálculos quedarían en cero y, peor aún,
   todas las filas se verían "iguales" y el control de duplicados las descartaría
   (era el caso del CSV separado por comas que no se reconocía y dejaba todo vacío).
   La clave es el nombre interno del campo; el texto es el nombre que ve el usuario. */
const COLUMNAS_OBLIGATORIAS = {
  reporte:    { documento:'Documento', fechaDispensacion:'Fecha de Dispensación', codigoArticulo:'Código de Articulo', unidades:'Unidades' },
  homologo:   { codigo:'Codigo', homologo:'Homologo' },
  bodegas:    { bodega:'Bodega', zona:'Zona' },
  agotados:   { codigoArticulo:'Molecula', estado:'Estado' },
  inventario: { codigoArticulo:'Codigo', bodegaDetalle:'Bodega Detalle', unidades:'Unidades' },
  sigla:      { sigla:'Sigla Comercial del Cliente' },
  traslados:  { fecha:'Fecha', codigo:'Codigo', cantidad:'Cantidad', recibido:'Recibido' },
  facturas:   { fechaFactura:'Fecha Factura', factura:'Factura', codigo:'Codigo', cantidad:'Cantidad' },
  invfisico:  { codigoArticulo:'Codigo', bodegaDetalle:'Bodega Detalle', unidades:'Unidades en fisico' }
};

/* ¿En qué columna del archivo está este campo? Usa la misma lógica que la lectura de
   datos: primero los nombres exactos (alias) y luego el respaldo por palabra clave. */
function columnaDeCampo(fieldName, aliases, headerIndex){
  for (const alias of (aliases || [])){
    const col = headerLookup(headerIndex, alias);
    if (col >= 0) return col;
  }
  if (FIELD_FALLBACK_KEYWORDS[fieldName]){
    const col = findHeaderByKeyword(headerIndex, FIELD_FALLBACK_KEYWORDS[fieldName]);
    if (col >= 0) return col;
  }
  return -1;
}

/* Devuelve los nombres (los que ve el usuario) de las columnas obligatorias ausentes.
   Además detecta el caso en que dos columnas obligatorias apuntan a la MISMA columna del
   archivo: eso pasa cuando el separador no se reconoce y toda la fila de encabezados
   quedó dentro de una sola celda, así que en la práctica esas columnas no existen. */
function columnasObligatoriasFaltantes(datasetDef, headerIndex){
  const requeridas = COLUMNAS_OBLIGATORIAS[datasetDef && datasetDef.key] || null;
  if (!requeridas) return [];
  const faltan = [];
  const usadas = new Map();
  for (const fieldName in requeridas){
    const aliases = (datasetDef.fields && datasetDef.fields[fieldName]) || [];
    const col = columnaDeCampo(fieldName, aliases, headerIndex);
    if (col < 0 || usadas.has(col)) faltan.push(requeridas[fieldName]);
    else usadas.set(col, fieldName);
  }
  return faltan;
}

/* Arma el aviso en español: qué falta, qué encabezados sí se leyeron y qué revisar. */
function errorColumnasFaltantes(datasetDef, headerIndex, faltan, fileName){
  const detectados = Array.from(headerIndex.keys());
  const muestra = detectados.slice(0, 12).join(' | ') + (detectados.length > 12 ? ' | …' : '');
  let msg = 'El archivo' + (fileName ? ' "' + fileName + '"' : '')
    + ' no sirve para "' + (datasetDef && datasetDef.title ? datasetDef.title : 'esta tabla') + '": '
    + 'faltan las columnas obligatorias ' + faltan.join(', ') + '.';
  msg += detectados.length
    ? ' Encabezados que se leyeron: ' + muestra + '.'
    : ' No se pudo leer ningún encabezado.';
  if (detectados.length <= 1){
    msg += ' Todo el contenido quedó en una sola columna: si es un CSV, revisa que las columnas estén separadas por coma, punto y coma o tabulación, y vuelve a exportarlo.';
  } else {
    msg += ' Revisa que la fila de encabezados esté entre las primeras filas y que los nombres de las columnas no se hayan cambiado.';
  }
  const err = new Error(msg);
  err.code = 'COLUMNAS_FALTANTES';
  err.columnasFaltantes = faltan;
  return err;
}
function mapRowToFields(rawRow, headerIndex, fieldsDef){
  const out={};
  for (const fieldName in fieldsDef){
    let val='', matched=false;
    for (const alias of fieldsDef[fieldName]){
      const col=headerLookup(headerIndex, alias);
      if (col>=0){
        matched=true;
        val=rawRow[col];
        if (val!==undefined && val!==null && val!=='') break;
      }
    }
    // Respaldo por palabra clave solo si el encabezado exacto no existe en el archivo
    if (!matched && FIELD_FALLBACK_KEYWORDS[fieldName]){
      const col=findHeaderByKeyword(headerIndex, FIELD_FALLBACK_KEYWORDS[fieldName]);
      if (col>=0) val=rawRow[col];
    }
    out[fieldName]= val===undefined ? '' : val;
  }
  return out;
}
// Completa en una fila ya guardada los campos que estén vacíos usando una fila
// recién leída del archivo. Sirve para "reparar" el acumulado histórico cuando se
// agregan columnas nuevas (Estado, Usuario Creación) que antes no se guardaban.
// Cuando una MISMA línea se vuelve a cargar y ahora sí trae soporte (antes 0 / "NO TIENE"),
// guardamos el soporte nuevo y la fecha del cargue en el que apareció. Eso permite el
// Reporte Comparativo Periódico de "soportes recuperados" entre cargues.
function registrarSoporteRecuperado(destino, origen, fechaISO, secCargue){
  const nuevo = toNumber(origen.soportes);
  const actual = toNumber(destino.soportes);
  if(nuevo>0 && actual===0){
    destino.soportes = origen.soportes;
    destino._fechaSoporte = fechaISO;
    // Número del cargue en el que llegó el soporte. El visor lo compara con el número
    // del cargue en el que la línea venía sin soporte: si es posterior, la línea pasa a
    // contar CON SOPORTE (soporte recuperado).
    if(secCargue) destino._secSoporte = secCargue;
    return true;
  }
  return false;
}
// Número consecutivo del CARGUE. Cada archivo cargado recibe un número mayor que todos
// los anteriores, sin importar la fecha del archivo: así el orden real de los cargues
// nunca se pierde y un cumplimiento que llega después (línea entregada o soporte) se
// reconoce siempre como posterior, aunque las fechas de los archivos vengan repetidas
// o desordenadas.
function siguienteSecCargue(rows){
  let max = 0;
  (rows||[]).forEach(r => { const n = Number(r && r._secCargue); if(n>max) max = n; });
  return max + 1;
}
function completarCamposFaltantes(destino, origen){
  let cambios=0;
  for (const f in origen){
    const nuevo=origen[f];
    if (nuevo===undefined || nuevo===null || nuevo==='') continue;
    const actual=destino[f];
    if (actual===undefined || actual===null || actual===''){ destino[f]=nuevo; cambios++; }
  }
  return cambios;
}
/* ---------- Lectura del libro: Excel (.xlsx/.xls) y texto plano (.csv/.txt) ----------
   Los CSV que exporta el sistema pueden venir separados por coma O por punto y coma
   (según la configuración regional). Aquí se detecta el separador real mirando la
   primera línea con contenido y se le indica a la librería cuál usar, para que las
   columnas no queden todas pegadas en una sola. */
function looksLikeTextFile(fileName, mimeType){
  const n = String(fileName || '').toLowerCase();
  const m = String(mimeType || '').toLowerCase();
  if (/\.(csv|tsv|txt)$/.test(n)) return true;
  return m === 'text/csv' || m === 'application/csv' || m === 'text/plain'
      || m === 'text/tab-separated-values';
}
function detectDelimiter(text){
  const lines = String(text || '').split(/\r?\n/);
  for (let i = 0; i < lines.length && i < 20; i++){
    const line = lines[i];
    if (!line || !line.trim()) continue;
    // Se cuentan solo los separadores que están FUERA de comillas, para no
    // confundirse con textos como "MEDICAMENTO X, 500 MG".
    let inQuotes = false, comas = 0, puntoComas = 0, tabs = 0;
    for (let c = 0; c < line.length; c++){
      const ch = line[c];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (inQuotes) continue;
      if (ch === ',') comas++;
      else if (ch === ';') puntoComas++;
      else if (ch === '\t') tabs++;
    }
    if (tabs > comas && tabs > puntoComas) return '\t';
    if (puntoComas > comas) return ';';
    if (comas > 0 || puntoComas > 0) return comas >= puntoComas ? ',' : ';';
  }
  return ',';
}
function decodeTextBuffer(buf){
  const bytes = new Uint8Array(buf);
  // Quita la marca BOM de UTF-8 si viene, así el primer encabezado no se ensucia.
  let start = 0;
  if (bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) start = 3;
  const body = start ? bytes.subarray(start) : bytes;
  let txt = '';
  try {
    txt = new TextDecoder('utf-8', { fatal: false }).decode(body);
  } catch (e) {
    txt = String.fromCharCode.apply(null, body);
  }
  // Si la decodificación UTF-8 dejó caracteres de reemplazo, el archivo casi seguro
  // viene en Windows-1252 (muy común en exportaciones de Excel en español).
  if (txt.indexOf('\uFFFD') >= 0) {
    try { txt = new TextDecoder('windows-1252', { fatal: false }).decode(body); } catch (e) { /* se queda el anterior */ }
  }
  return txt;
}
function readWorkbookFromBuffer(buf, fileName, mimeType){
  if (looksLikeTextFile(fileName, mimeType)) {
    const txt = decodeTextBuffer(buf);
    const FS = detectDelimiter(txt);
    // raw:true deja los valores como texto tal cual vienen en el CSV: evita que
    // fechas dd/mm/aaaa se interpreten al estilo mm/dd/aaaa. Las conversiones
    // posteriores las hacen toDateSafe() y toNumber().
    return XLSX.read(txt, { type: 'string', raw: true, cellDates: false, dense: true, FS: FS });
  }
  return XLSX.read(buf, { type: 'array', cellDates: true, dense: true });
}
async function parseFile(file, datasetDef){
  const buf=await file.arrayBuffer();
  const wb=readWorkbookFromBuffer(buf, file && file.name, file && file.type);
  const sheetName=wb.SheetNames[0];
  const ws=wb.Sheets[sheetName];
  const aoa=XLSX.utils.sheet_to_json(ws,{header:1,raw:true,defval:''});
  if(!aoa.length) throw new Error('El archivo está vacío.');

  return parseRowsFromAOA(aoa, datasetDef, file && file.name);
}

/* =========================================================================
   5. Estado en memoria
   ========================================================================= */
const state = { loaded:{}, processed:null };

async function refreshStatusFromDB(){
  const all=await idbGetAll();
  state.loaded={};
  restoreDriveFileLists();
  all.forEach(rec=>{ state.loaded[rec.key]={rowCount:rec.rows.length, fileName:rec.fileName, updatedAt:rec.updatedAt, batches:rec.batches||null}; });
  renderUploadCards(); updateTopStatus(); updateCalcButton();
}
function updateTopStatus(){
  const dot=document.getElementById('dbDot'); const txt=document.getElementById('dbStatusText');
  const n=Object.keys(state.loaded).length;
  const modo = dbFailed ? ' (modo sesión, sin sincronización en la nube)' : '';
  if(n===0){ dot.className='dot'+(dbFailed?' warn':''); txt.textContent='Sin datos cargados'+modo; }
  else{
    dot.className='dot'+(dbFailed?' warn':' on');
    const totalRows=Object.values(state.loaded).reduce((a,b)=>a+b.rowCount,0);
    txt.textContent=n+' fuente(s) cargadas · '+fmtInt(totalRows)+' filas en total'+modo;
  }
}
function renderDiagPanel(diag){
  const el=document.getElementById('diagPanel');
  if(!el) return;
  const pctPareto = diag.reporteFilas ? diag.reporteConPareto/diag.reporteFilas : 0;
  let level='ok', msg='';
  if(diag.homologoFilasConCodigo===0){
    level='bad';
    msg='La tabla Homólogo se cargó pero ninguna fila tiene un valor reconocible en la columna "Codigo". Revisa que el encabezado de esa columna en tu archivo diga exactamente "Codigo" (o similar) y que la fila de encabezados esté en las primeras filas del archivo.';
  }else if(pctPareto < 0.5){
    level='bad';
    msg='Menos de la mitad de las líneas del Reporte encontraron PARETO/NO PARETO en el Homólogo. Lo más probable es que el "Codigo" del Reporte no coincida con el "Codigo" del Homólogo (formato distinto, espacios, o el archivo Homólogo cargado no es el correcto).';
  }else if(pctPareto < 0.95){
    level='warn';
    msg='La mayoría de las líneas sí cruzaron, pero hay códigos del Reporte que no aparecen en el Homólogo cargado (ver ejemplos abajo). Puede ser normal si son artículos nuevos, o puede indicar que falta actualizar el Homólogo.';
  }else{
    level='ok';
    msg='El cruce con Homólogo está funcionando correctamente.';
  }
  el.className = 'diag-panel diag-'+level;
  el.style.display='flex';
  el.innerHTML = `
    <span class="pw-icon">${level==='ok'?'✓':'⚠'}</span>
    <div>
      <b>Diagnóstico del cruce con Homólogo:</b> ${msg}
      <div class="diag-stats">
        <span>Homólogo cargado: <b>${fmtInt(diag.homologoFilasCargadas)}</b> filas (${fmtInt(diag.homologoFilasConCodigo)} con "Codigo" válido)</span>
        <span>Líneas del Reporte con Pareto/No Pareto identificado: <b>${fmtInt(diag.reporteConPareto)}</b> de ${fmtInt(diag.reporteFilas)} (${fmtPct(pctPareto)})</span>
        <span>Códigos únicos del Reporte sin homólogo: <b>${fmtInt(diag.codigosSinHomologo)}</b> de ${fmtInt(diag.codigosUnicosReporte)}</span>
        ${diag.ejemplosSinHomologo.length ? `<span>Ejemplos de códigos sin cruce: <b>${diag.ejemplosSinHomologo.join(', ')}</b></span>` : ''}
      </div>
    </div>
  `;
}
function updateCalcButton(){
  const missing=DATASETS.filter(d=>d.required && !state.loaded[d.key]);
  const btn=document.getElementById('btnCalcular'); const note=document.getElementById('calcNote');
  btn.disabled=missing.length>0;
  note.textContent = missing.length ? ('Falta cargar: '+missing.map(d=>d.title).join(', ')+'.') : 'Listo para calcular con los datos guardados.';
}

/* =========================================================================
   6. UI — tarjetas de cargue
   ========================================================================= */

/* =========================================================================
   Google Drive Sync — Inventario del Punto
   ========================================================================= */

/* =========================================================================
   Google Drive Sync — Inventario del Punto
   ========================================================================= */
const DRIVE_FOLDER_ID = '1eHRKlKXViXc5F_2yNPIXFCYsd-V26EpU';            // Inventario General
const DRIVE_FOLDER_REPORTE = '1ziz50g2Qc6c59KcATGVbX-8VR4R_laru';       // Reportes de Dispensación
const DRIVE_FOLDER_HOMOLOGO = '11UzrdMdVlcwZFWusXg5fUastekt0eRPb';      // Tabla Homólogo
const DRIVE_FOLDER_TRASLADOS = '1DJrU4m0vzZY2AHaXPBdIu80gDEgZtJzK';     // Traslados entre bodegas
const DRIVE_FOLDER_FACTURAS = '1MOFehAcE_nKHGLc4QV4cAUUDGZIi99Ac';      // Facturas por punto de venta
const DRIVE_FOLDER_INVFISICO = '1zhP9VeJPGbUaoV99XuHYSPExheIQj5y0';     // Inventario Físico (conteo)
const DRIVE_FOLDER_PAQUETE = '1RbpCEBkBSTXuschQBnG2olZ4SSoqP90Y';        // Resultados de indicadores (paquete cifrado del visor)
// El panel necesita ESCRIBIR en Drive (subir el paquete y borrar el anterior),
// por eso el permiso no puede ser solo de lectura.
const DRIVE_SCOPES = 'https://www.googleapis.com/auth/drive';
let _driveSyncing = false;
let _driveSyncingReporte = false;
let _driveSyncingHomologo = false;
let _driveSyncingTraslados = false;
let _driveSyncingFacturas = false;
let _driveSyncingInvFisico = false;
let _driveFilesReporte = [];
let _driveFilesHomologo = []; // solo en memoria: Homologo no usa localStorage
let _driveFilesTraslados = []; // solo en memoria: Traslados no usa localStorage
let _driveFilesFacturas = []; // solo en memoria: Facturas no usa localStorage
let _driveFilesInvFisico = []; // solo en memoria: Inventario Fisico no usa localStorage
let _driveFiles = []; // archivos listados del folder de Drive

/* Fila de configuracion del acceso a Google (boton + ID actual acortado) */
function driveConfigRowHTML() {
  const id = getDriveClientId();
  let html = '<div class="drive-config-row">';
  html += '<button class="drive-config-btn" type="button" onclick="configureDriveClientId()">⚙ Configurar acceso a Google</button>';
  if (id) {
    html += '<span class="drive-config-id" title="ID de cliente OAuth guardado en este navegador">ID: <code>' + escapeHtmlTxt(shortDriveClientId(id)) + '</code></span>';
  } else {
    html += '<span class="drive-config-id sin-id">Sin ID de cliente configurado</span>';
  }
  html += '</div>';
  return html;
}

function inventarioCardHTML(d, loaded) {
  const syncing = _driveSyncing;
  let html = '';

  // Título con badge "solo Google Drive"
  html += '<h3>' + d.title + ' <span class="drive-badge">☁️ solo Google Drive</span></h3>';

  // Descripción
  html += '<p class="desc">' + d.desc + '</p>';

  // Columnas requeridas
  html += '<div class="cols">' + d.cols.join(' · ') + '</div>';

  // Info de la carpeta de Drive
  html += '<div class="drive-folder-info">📂 Carpeta Drive: <code>Inventario General</code><br>ID: <code>' + DRIVE_FOLDER_ID + '</code></div>';

  // Botón de sincronización
  html += '<button class="drive-sync-btn" id="btnDriveSyncInventario" onclick="syncInventarioFromDrive()"' + (syncing ? ' disabled' : '') + '>';
  html += syncing ? '<span class="spinner-inline"></span> Sincronizando…' : '☁️ Sincronizar carpeta';
  html += '</button>';

  // Configuracion del ID de cliente OAuth
  html += driveConfigRowHTML();

  if (_driveErrorInventario) {
    html += '<div class="drive-error">⚠️ ' + escapeHtmlTxt(_driveErrorInventario) + '</div>';
  }

  // Estado: filas cargadas + botón quitar
  html += '<div class="status-row">';
  if (loaded) {
    html += '<span class="rows">✓ ' + fmtInt(loaded.rowCount) + ' filas' + (loaded.batches && loaded.batches.length > 1 ? ' · ' + loaded.batches.length + ' cargues' : '') + '</span>';
    html += '<button class="clear" data-key="' + d.key + '">Quitar</button>';
  } else {
    html += '<span class="empty">Sin cargar</span><span></span>';
  }
  html += '</div>';

  // Archivo sincronizado
  if (loaded && loaded.fileName) {
    html += '<div class="filename">Archivo: ' + loaded.fileName + '</div>';
  }

  // Historial de archivos de Drive (si hay)
  if (_driveFiles.length > 0) {
    html += '<div class="drive-file-list">';
    for (let i = 0; i < _driveFiles.length; i++) {
      const f = _driveFiles[i];
      html += '<div class="drive-file-item">';
      html += '<span class="fname">📄 ' + f.name + '</span>';
      if (f.modifiedTime) {
        const dt = new Date(f.modifiedTime);
        html += '<span class="fdate">' + dt.toLocaleDateString('es') + ' ' + dt.toLocaleTimeString('es', {hour:'2-digit',minute:'2-digit'}) + '</span>';
      }
      html += '</div>';
    }
    html += '</div>';
  }

  // Última sincronización
  if (loaded && loaded.updatedAt) {
    const syncDate = new Date(loaded.updatedAt);
    html += '<div class="drive-last-sync">Última sincronización: <b>' + syncDate.toLocaleDateString('es') + ' ' + syncDate.toLocaleTimeString('es', {hour:'2-digit',minute:'2-digit'}) + '</b></div>';
  }

  return html;
}

/* ---------- Tarjeta "Reporte de Dispensación": solo Google Drive (acumulativo) ---------- */
function reporteCardHTML(d, loaded) {
  const syncing = _driveSyncingReporte;
  const nBatches = loaded && loaded.batches ? loaded.batches.length : (loaded ? 1 : 0);
  let html = '';

  html += '<h3>' + d.title + ' <span class="acumulativo-tag">· acumulativo</span> <span class="drive-badge">☁️ solo Google Drive</span></h3>';
  html += '<p class="desc">' + d.desc + '</p>';
  html += '<div class="cols">' + d.cols.join(' · ') + '</div>';

  html += '<div class="drive-folder-info">📂 Carpeta Drive: <code>Reportes de Dispensación</code><br>ID: <code>' + DRIVE_FOLDER_REPORTE + '</code></div>';

  html += '<button class="drive-sync-btn" id="btnDriveSyncReporte" onclick="syncReporteFromDrive()"' + (syncing ? ' disabled' : '') + '>';
  html += syncing ? '<span class="spinner-inline"></span> Sincronizando…' : '☁️ Sincronizar carpeta "Reportes de Dispensación" (Drive)';
  html += '</button>';

  html += driveConfigRowHTML();

  if (_driveErrorReporte) {
    html += '<div class="drive-error">⚠️ ' + escapeHtmlTxt(_driveErrorReporte) + '</div>';
  }

  html += '<div class="status-row">';
  if (loaded) {
    html += '<span class="rows">✓ ' + fmtInt(loaded.rowCount) + ' filas' + (nBatches > 0 ? ' · ' + fmtInt(nBatches) + (nBatches === 1 ? ' cargue' : ' cargues') : '') + '</span>';
    html += '<button class="clear" data-key="' + d.key + '">Borrar acumulado</button>';
  } else {
    html += '<span class="empty">Sin cargar</span><span></span>';
  }
  html += '</div>';

  if (loaded && loaded.updatedAt) {
    const sd = new Date(loaded.updatedAt);
    html += '<div class="drive-last-sync">Última sincronización: <b>' + sd.toLocaleDateString('es') + ' ' + sd.toLocaleTimeString('es', {hour:'2-digit',minute:'2-digit'}) + '</b> · ' + fmtInt(loaded.rowCount) + ' filas acumuladas.</div>';
  }

  return html;
}

/* ---------- Tarjeta "Homólogo": solo Google Drive (reemplaza, no acumula) ---------- */
function homologoCardHTML(d, loaded) {
  const syncing = _driveSyncingHomologo;
  let html = '';

  html += '<h3>' + d.title + ' <span class="drive-badge">☁️ solo Google Drive</span></h3>';
  html += '<p class="desc">' + d.desc + '</p>';
  html += '<div class="cols">' + d.cols.join(' · ') + '</div>';

  html += '<div class="drive-folder-info">📂 Carpeta Drive: <code>Homólogo</code><br>ID: <code>' + DRIVE_FOLDER_HOMOLOGO + '</code></div>';

  html += '<button class="drive-sync-btn" id="btnDriveSyncHomologo" onclick="syncHomologoFromDrive()"' + (syncing ? ' disabled' : '') + '>';
  html += syncing ? '<span class="spinner-inline"></span> Sincronizando…' : '☁️ Sincronizar carpeta "Homólogo" (Drive)';
  html += '</button>';

  html += driveConfigRowHTML();

  if (_driveErrorHomologo) {
    html += '<div class="drive-error">⚠️ ' + escapeHtmlTxt(_driveErrorHomologo) + '</div>';
  }

  html += '<div class="status-row">';
  if (loaded) {
    html += '<span class="rows">✓ ' + fmtInt(loaded.rowCount) + ' filas</span>';
    html += '<button class="clear" data-key="' + d.key + '">Quitar</button>';
  } else {
    html += '<span class="empty">Sin cargar</span><span></span>';
  }
  html += '</div>';

  if (loaded && loaded.fileName) {
    html += '<div class="filename">Archivo: ' + escapeHtmlTxt(loaded.fileName) + '</div>';
  }

  if (_driveFilesHomologo.length > 0) {
    html += '<div class="drive-file-list">';
    for (let i = 0; i < _driveFilesHomologo.length; i++) {
      const f = _driveFilesHomologo[i];
      html += '<div class="drive-file-item">';
      html += '<span class="fname">📄 ' + escapeHtmlTxt(f.name) + '</span>';
      if (f.modifiedTime) {
        const dt = new Date(f.modifiedTime);
        html += '<span class="fdate">' + dt.toLocaleDateString('es') + ' ' + dt.toLocaleTimeString('es', {hour:'2-digit',minute:'2-digit'}) + '</span>';
      }
      html += '</div>';
    }
    html += '</div>';
  }

  if (loaded && loaded.updatedAt) {
    const sd = new Date(loaded.updatedAt);
    html += '<div class="drive-last-sync">Última sincronización: <b>' + sd.toLocaleDateString('es') + ' ' + sd.toLocaleTimeString('es', {hour:'2-digit',minute:'2-digit'}) + '</b></div>';
  }

  return html;
}

/* ---------- Tarjeta "Traslados": solo Google Drive (ACUMULATIVA) ---------- */
function trasladosCardHTML(d, loaded) {
  const syncing = _driveSyncingTraslados;
  const nBatches = loaded && loaded.batches ? loaded.batches.length : (loaded ? 1 : 0);
  let html = '';

  html += '<h3>' + d.title + ' <span class="drive-badge">☁️ solo Google Drive</span></h3>';
  html += '<p class="desc">' + d.desc + '</p>';
  html += '<div class="cols">' + d.cols.join(' · ') + '</div>';

  html += '<div class="drive-folder-info">📂 Carpeta Drive: <code>Traslados</code><br>ID: <code>' + DRIVE_FOLDER_TRASLADOS + '</code></div>';

  html += '<button class="drive-sync-btn" id="btnDriveSyncTraslados" onclick="syncTrasladosFromDrive()"' + (syncing ? ' disabled' : '') + '>';
  html += syncing ? '<span class="spinner-inline"></span> Sincronizando…' : '☁️ Sincronizar carpeta "Traslados" (Drive)';
  html += '</button>';

  html += driveConfigRowHTML();

  if (_driveErrorTraslados) {
    html += '<div class="drive-error">⚠️ ' + escapeHtmlTxt(_driveErrorTraslados) + '</div>';
  }

  html += '<div class="status-row">';
  if (loaded) {
    // Solo dos datos: cuántas líneas hay acumuladas y en cuántos cargues llegaron
    html += '<span class="rows">✓ ' + fmtInt(loaded.rowCount) + ' filas' + (nBatches > 0 ? ' · ' + fmtInt(nBatches) + (nBatches === 1 ? ' cargue' : ' cargues') : '') + '</span>';
    html += '<button class="clear" data-key="' + d.key + '">Borrar acumulado</button>';
  } else {
    html += '<span class="empty">Sin cargar</span><span></span>';
  }
  html += '</div>';

  return html;
}

/* ---------- Tarjeta "Inventario Físico": solo Google Drive (reemplaza, no acumula) ---------- */
function invFisicoCardHTML(d, loaded) {
  const syncing = _driveSyncingInvFisico;
  const nBatches = loaded && loaded.batches ? loaded.batches.length : (loaded ? 1 : 0);
  let html = '';

  html += '<h3>' + d.title + ' <span class="drive-badge">☁️ solo Google Drive</span></h3>';
  html += '<p class="desc">' + d.desc + '</p>';
  html += '<div class="cols">' + d.cols.join(' · ') + '</div>';

  html += '<div class="drive-folder-info">📂 Carpeta Drive: <code>Inventario Físico</code><br>ID: <code>' + DRIVE_FOLDER_INVFISICO + '</code></div>';

  html += '<button class="drive-sync-btn" id="btnDriveSyncInvFisico" onclick="syncInvFisicoFromDrive()"' + (syncing ? ' disabled' : '') + '>';
  html += syncing ? '<span class="spinner-inline"></span> Sincronizando…' : '☁️ Sincronizar carpeta "Inventario Físico" (Drive)';
  html += '</button>';

  html += driveConfigRowHTML();

  if (_driveErrorInvFisico) {
    html += '<div class="drive-error">⚠️ ' + escapeHtmlTxt(_driveErrorInvFisico) + '</div>';
  }

  html += '<div class="status-row">';
  if (loaded) {
    html += '<span class="rows">✓ ' + fmtInt(loaded.rowCount) + ' filas' + (nBatches > 0 ? ' · ' + fmtInt(nBatches) + (nBatches === 1 ? ' cargue' : ' cargues') : '') + '</span>';
    html += '<button class="clear" data-key="' + d.key + '">Borrar acumulado</button>';
  } else {
    html += '<span class="empty">Sin cargar</span><span></span>';
  }
  html += '</div>';

  if (loaded && loaded.updatedAt) {
    const sd = new Date(loaded.updatedAt);
    html += '<div class="drive-last-sync">Última sincronización: <b>' + sd.toLocaleDateString('es') + ' ' + sd.toLocaleTimeString('es', {hour:'2-digit',minute:'2-digit'}) + '</b></div>';
  }

  return html;
}

/* ---------- Tarjeta "Facturas": solo Google Drive (ACUMULATIVA) ---------- */
function facturasCardHTML(d, loaded) {
  const syncing = _driveSyncingFacturas;
  const nBatches = loaded && loaded.batches ? loaded.batches.length : (loaded ? 1 : 0);
  let html = '';

  html += '<h3>' + d.title + ' <span class="drive-badge">☁️ solo Google Drive</span></h3>';
  html += '<p class="desc">' + d.desc + '</p>';
  html += '<div class="cols">' + d.cols.join(' · ') + '</div>';

  html += '<div class="drive-folder-info">📂 Carpeta Drive: <code>Facturas</code><br>ID: <code>' + DRIVE_FOLDER_FACTURAS + '</code></div>';

  html += '<button class="drive-sync-btn" id="btnDriveSyncFacturas" onclick="syncFacturasFromDrive()"' + (syncing ? ' disabled' : '') + '>';
  html += syncing ? '<span class="spinner-inline"></span> Sincronizando…' : '☁️ Sincronizar carpeta "Facturas" (Drive)';
  html += '</button>';

  html += driveConfigRowHTML();

  if (_driveErrorFacturas) {
    html += '<div class="drive-error">⚠️ ' + escapeHtmlTxt(_driveErrorFacturas) + '</div>';
  }

  html += '<div class="status-row">';
  if (loaded) {
    // Solo dos datos: cuántas líneas hay acumuladas y en cuántos cargues llegaron
    html += '<span class="rows">✓ ' + fmtInt(loaded.rowCount) + ' filas' + (nBatches > 0 ? ' · ' + fmtInt(nBatches) + (nBatches === 1 ? ' cargue' : ' cargues') : '') + '</span>';
    html += '<button class="clear" data-key="' + d.key + '">Borrar acumulado</button>';
  } else {
    html += '<span class="empty">Sin cargar</span><span></span>';
  }
  html += '</div>';

  return html;
}

/* --- Autorizacion de Google Drive con Google Identity Services (sin Firebase) --- */

let _driveToken = null;          // token en memoria para no repetir el popup
let _driveTokenAt = 0;           // marca de tiempo de obtencion
let _driveTokenClient = null;    // cliente GIS reutilizable
let _driveTokenClientId = '';    // ID con el que se creo el cliente GIS

/* El ID de cliente OAuth se guarda en el navegador. Se puede fijar aqui
   (DRIVE_CLIENT_ID_DEFAULT) o pedirselo al usuario la primera vez. */
const DRIVE_CLIENT_ID_DEFAULT = '';
const DRIVE_CLIENT_ID_STORAGE = 'drive_oauth_client_id';

function getDriveClientId() {
  try {
    const saved = localStorage.getItem(DRIVE_CLIENT_ID_STORAGE);
    if (saved && saved.trim()) return saved.trim();
  } catch (e) { /* sin localStorage */ }
  return DRIVE_CLIENT_ID_DEFAULT.trim();
}

/* Limpia lo que pegue el usuario: espacios, saltos de linea, comillas,
   y el caso de pegar algo como  "client_id": "123-abc.apps.googleusercontent.com"  */
function cleanDriveClientId(raw) {
  let s = String(raw == null ? '' : raw).replace(/\s+/g, ' ').trim();
  s = s.replace(/^["'\s]+|["',;\s]+$/g, '');
  const m = s.match(/[0-9][0-9A-Za-z._-]*\.apps\.googleusercontent\.com/);
  if (m) return m[0];
  return s;
}

function isValidDriveClientId(id) {
  return /^[0-9][0-9A-Za-z._-]*\.apps\.googleusercontent\.com$/.test(String(id || '').trim());
}

/* Version corta para mostrar en la tarjeta sin ocupar toda la linea */
function shortDriveClientId(id) {
  const s = String(id || '');
  if (s.length <= 26) return s;
  return s.slice(0, 14) + '…' + s.slice(-22);
}

function setDriveClientId(id) {
  const clean = cleanDriveClientId(id);
  try {
    if (clean) localStorage.setItem(DRIVE_CLIENT_ID_STORAGE, clean);
    else localStorage.removeItem(DRIVE_CLIENT_ID_STORAGE);
  } catch (e) {}
  _driveTokenClient = null;   // fuerza recrear el cliente con el ID nuevo
  _driveToken = null;
  _driveTokenAt = 0;
  return clean;
}

function forgetDriveClientId() {
  setDriveClientId('');
}

const DRIVE_CLIENT_ID_HELP =
  'Pega el ID de cliente OAuth de Google.\n\n'
  + 'Debe verse asi:  123456789012-abc123def456.apps.googleusercontent.com\n\n'
  + 'Como obtenerlo (una sola vez):\n'
  + '1) console.cloud.google.com > selecciona tu proyecto\n'
  + '2) APIs y servicios > Biblioteca > habilita "Google Drive API"\n'
  + '3) APIs y servicios > Credenciales > Crear credenciales > ID de cliente de OAuth\n'
  + '4) Tipo de aplicacion: Aplicacion web\n'
  + '5) En "Origenes autorizados de JavaScript" agrega exactamente:\n'
  + '   ';

function driveOriginActual() {
  try { return window.location.origin || '(origen desconocido)'; } catch (e) { return '(origen desconocido)'; }
}

/* Pide el ID de cliente y valida el formato antes de guardarlo.
   Devuelve '' si el usuario cancela. */
function askDriveClientId() {
  const actual = getDriveClientId();
  let sugerencia = actual;
  for (let intento = 0; intento < 3; intento++) {
    const texto = window.prompt(DRIVE_CLIENT_ID_HELP + driveOriginActual(), sugerencia);
    if (texto === null) return '';
    const limpio = cleanDriveClientId(texto);
    if (!limpio) {
      // Campo vacio: se interpreta como "borrar el ID guardado"
      forgetDriveClientId();
      return '';
    }
    if (isValidDriveClientId(limpio)) return setDriveClientId(limpio);
    sugerencia = limpio;
    window.alert('Ese ID no tiene el formato correcto.\n\n'
      + 'Recibido: ' + limpio + '\n\n'
      + 'Debe terminar en .apps.googleusercontent.com (no es la clave de API, ni el secreto de cliente, ni el ID del proyecto).');
  }
  return '';
}

/* Boton "engranaje" de las tarjetas: configurar / cambiar el ID de cliente */
function configureDriveClientId() {
  const antes = getDriveClientId();
  const nuevo = askDriveClientId();
  if (nuevo) {
    clearDriveError('inventario');
    clearDriveError('reporte');
    showToast('ID de cliente OAuth guardado. Ya puedes pulsar "Sincronizar carpeta".');
  } else if (antes && !getDriveClientId()) {
    showToast('Se borro el ID de cliente OAuth guardado.');
  }
  renderUploadCards();
}

async function authenticateDrive(forceConsent) {
  // Reutiliza el token si aun es fresco (los de Google duran ~1 hora; usamos 45 min)
  if (!forceConsent && _driveToken && (Date.now() - _driveTokenAt) < 45 * 60 * 1000) {
    return _driveToken;
  }

  if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
    throw new Error('GIS_NOT_LOADED');
  }

  // 1) ID de cliente: debe existir y tener formato valido ANTES de abrir el popup.
  //    Asi evitamos la pantalla "Acceso bloqueado / Error 401: invalid_client".
  let clientId = getDriveClientId();
  if (clientId && !isValidDriveClientId(clientId)) {
    // Habia un ID guardado con formato incorrecto: se descarta y se vuelve a pedir
    forgetDriveClientId();
    clientId = '';
  }
  if (!clientId) clientId = askDriveClientId();
  if (!clientId) throw new Error('NO_CLIENT_ID');
  if (!isValidDriveClientId(clientId)) throw new Error('BAD_CLIENT_ID');

  // 2) Si el ID cambio respecto al cliente ya creado, hay que recrearlo
  if (_driveTokenClient && _driveTokenClientId !== clientId) {
    _driveTokenClient = null;
  }

  let token;
  try {
    token = await new Promise((resolve, reject) => {
      try {
        if (!_driveTokenClient) {
          _driveTokenClient = google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: DRIVE_SCOPES,
            callback: (resp) => {
              if (resp && resp.access_token) { resolve(resp.access_token); return; }
              const e = new Error(resp && resp.error ? resp.error : 'OAUTH_NO_TOKEN');
              e.oauthDetail = (resp && (resp.error_description || resp.error)) || '';
              reject(e);
            },
            error_callback: (err) => {
              const tipo = (err && err.type) || '';
              if (tipo === 'popup_closed') { reject(new Error('POPUP_CLOSED')); return; }
              if (tipo === 'popup_failed_to_open') { reject(new Error('POPUP_BLOCKED')); return; }
              const e = new Error((err && err.message) || 'OAUTH_ERROR');
              e.oauthDetail = tipo;
              reject(e);
            }
          });
          _driveTokenClientId = clientId;
        }
        // 'consent' asegura que se vuelva a mostrar la casilla de permiso de Drive
        _driveTokenClient.requestAccessToken({ prompt: forceConsent ? 'consent' : '' });
      } catch (err) {
        reject(err);
      }
    });
  } catch (err) {
    // Google dice que el cliente no existe / no sirve para este sitio:
    // se olvida el ID guardado para que la proxima vez se pueda pegar el correcto.
    const texto = ((err && err.message) || '') + ' ' + ((err && err.oauthDetail) || '');
    if (/invalid_client|client was not found|unauthorized_client|deleted_client|invalid_request/i.test(texto)) {
      forgetDriveClientId();
      const e = new Error('INVALID_CLIENT');
      e.oauthDetail = (err && (err.oauthDetail || err.message)) || '';
      throw e;
    }
    throw err;
  }

  const hasScope = await driveTokenHasDriveScope(token);
  if (hasScope === false) throw new Error('NO_SCOPE');

  _driveToken = token;
  _driveTokenAt = Date.now();
  return _driveToken;
}

async function syncInventarioFromDrive() {
  if (_driveSyncing) return;
  _driveSyncing = true;
  renderUploadCards(); // re-render to show spinner

  try {
    clearDriveError('inventario');
    // Step 1: Authenticate
    const accessToken = await authenticateDrive();

    // Step 2: List files in the Drive folder
    const files = await listDriveFiles(accessToken, DRIVE_FOLDER_ID);
    if (!files || !files.length) {
      throw new Error('NO_FILES');
    }
    // Guardar lista de archivos para mostrar en la tarjeta
    _driveFiles = files.map(f => ({ name: f.name, modifiedTime: f.modifiedTime }));
    try { localStorage.setItem('inventario_drive_files', JSON.stringify(_driveFiles)); } catch(e) {}

    // Step 3: Find the most recent Excel/CSV file
    const excelFile = files.sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''))[0];

    // Step 4: Download and parse
    const arrayBuffer = await downloadDriveFile(accessToken, excelFile.id, excelFile.mimeType);
    const wb = readWorkbookFromBuffer(arrayBuffer, excelFile.name, excelFile.mimeType);
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    if (!aoa.length) throw new Error('El archivo está vacío.');

    // Step 5: Map to fields using DATASETS definition
    const def = DATASETS.find(d => d.key === 'inventario');
    const rows = parseRowsFromAOA(aoa, def, excelFile.name);

    if (!rows.length) {
      showToast('No se encontraron filas de datos en el archivo de Drive.', true);
      return;
    }

    // Step 6: Guardar en el almacen local del navegador (nunca en la nube)
    const record = {
      key: 'inventario',
      rows,
      fileName: excelFile.name,
      batches: null,
      updatedAt: new Date().toISOString()
    };
    await idbPut(record);

    state.loaded['inventario'] = { rowCount: rows.length, fileName: excelFile.name, updatedAt: record.updatedAt, batches: null };
    showToast('"' + def.title + '" sincronizado desde Drive: ' + fmtInt(rows.length) + ' filas.');
    renderUploadCards();
    updateTopStatus();
    updateCalcButton();
  } catch (err) {
    console.error('Drive sync error (inventario):', err);
    showDriveError('inventario', driveErrorMessage(err), err);
  } finally {
    _driveSyncing = false;
    renderUploadCards(); // re-render to remove spinner
  }
}

/* ---------- Sincronización Drive del Reporte de Dispensación (ACUMULATIVA) ----------
   Lee TODOS los archivos de la carpeta y los acumula con deduplicación,
   igual que el cargue manual diario. Persiste por el camino normal (Firestore/idbPut). */
async function syncReporteFromDrive() {
  if (_driveSyncingReporte) return;
  _driveSyncingReporte = true;
  renderUploadCards();

  const KEY = 'reporte';
  const def = DATASETS.find(d => d.key === KEY);

  try {
    clearDriveError('reporte');
    const accessToken = await authenticateDrive();

    const files = await listDriveFiles(accessToken, DRIVE_FOLDER_REPORTE);
    if (!files || !files.length) throw new Error('NO_FILES');

    _driveFilesReporte = files.map(f => ({ name: f.name, modifiedTime: f.modifiedTime }));
    try { localStorage.setItem('reporte_drive_files', JSON.stringify(_driveFilesReporte)); } catch(e) {}

    // Procesar del más antiguo al más reciente para que el historial de cargues quede en orden
    const ordered = files.slice().sort((a, b) => String(a.modifiedTime || '').localeCompare(String(b.modifiedTime || '')));

    const existing = await idbGet(KEY);
    const prevRows = existing ? existing.rows : [];
    const prevBatches = existing && existing.batches
      ? existing.batches
      : (existing ? [{ fileName: existing.fileName, rowCount: prevRows.length, addedCount: prevRows.length, uploadedAt: existing.updatedAt }] : []);

    const seen = new Map();
    // Al reconstruir el acumulado se numeran las líneas repetidas igual que al leer un
    // archivo, para que las repeticiones legítimas de un mismo documento se conserven.
    const contadorPrevio = nuevoContadorRepeticiones();
    prevRows.forEach(r => { const k = dedupKeyFor(KEY, r, contadorPrevio); if(!seen.has(k)) seen.set(k, r); });
    const merged = prevRows.slice();
    const batches = prevBatches.slice();
    // Número de cargue: cada archivo que se lee recibe un consecutivo mayor que todos
    // los anteriores. Así el visor sabe cuál cargue llegó antes y cuál después aunque
    // dos archivos tengan la misma fecha o vengan desordenados.
    let secCargue = siguienteSecCargue(prevRows);

    let totalAdded = 0, totalSkipped = 0, totalReparadas = 0, totalSoportesNuevos = 0, lastFileName = '';
    // Archivos que se dejaron por fuera porque les faltaban columnas obligatorias.
    const omitidos = [];

    for (let i = 0; i < ordered.length; i++) {
      const f = ordered[i];
      showToast('Leyendo desde Drive: ' + f.name + '…');
      let rows;
      try {
        const buf = await downloadDriveFile(accessToken, f.id, f.mimeType);
        const wb = readWorkbookFromBuffer(buf, f.name, f.mimeType);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
        if (!aoa.length) continue;
        rows = parseRowsFromAOA(aoa, def, f.name);
      } catch (fileErr) {
        console.warn('No se pudo leer ' + f.name + ':', fileErr);
        if (fileErr && fileErr.code === 'COLUMNAS_FALTANTES') {
          omitidos.push(f.name + ' (faltan: ' + (fileErr.columnasFaltantes || []).join(', ') + ')');
        } else {
          omitidos.push(f.name + ' (no se pudo leer)');
        }
        continue;
      }
      if (!rows || !rows.length) continue;

      let added = 0, skipped = 0, reparadas = 0, soportesNuevos = 0;
      // Numeración de repeticiones propia de este archivo: si el archivo trae la misma
      // línea tres veces, se comparan una a una con las tres del acumulado.
      const contador = nuevoContadorRepeticiones();
      // La fecha de cargue es la fecha REAL del archivo en Drive (última modificación),
      // NO el momento de sincronizar: así cada archivo cae en el corte que le corresponde
      // (1-10 / 11-20 / 21-31) y los cambios entre cargues se ven de un corte a otro.
      const nowISO = f.modifiedTime ? new Date(f.modifiedTime).toISOString() : new Date().toISOString();
      // Consecutivo propio de ESTE archivo dentro de la lectura (los archivos vienen
      // ordenados del más antiguo al más reciente).
      const secArchivo = secCargue++;
      for (let j = 0; j < rows.length; j++) {
        const k = dedupKeyFor(KEY, rows[j], contador);
        if (seen.has(k)) {
          skipped++;
          const prevRow = seen.get(k);
          // La línea ya estaba: se CONSERVA la fecha y el número del cargue en que
          // apareció por primera vez. Nunca se mueve hacia atrás, porque esa marca es la
          // que permite reconocer después un cumplimiento llegado en un cargue posterior.
          if (!prevRow._fechaCargue) prevRow._fechaCargue = nowISO;
          if (!prevRow._secCargue) prevRow._secCargue = secArchivo;
          // La fila ya estaba guardada: completamos los campos que estén vacíos
          // (Estado, Usuario Creación, etc.) para no perder datos del acumulado antiguo.
          if (completarCamposFaltantes(prevRow, rows[j])) reparadas++;
          // Si la línea ahora llega CON soporte y antes estaba en 0, lo registramos.
          if (registrarSoporteRecuperado(prevRow, rows[j], nowISO, secArchivo)) soportesNuevos++;
          continue;
        }
        rows[j]._fechaCargue = nowISO;
        rows[j]._secCargue = secArchivo;
        seen.set(k, rows[j]); merged.push(rows[j]); added++;
      }
      totalAdded += added; totalSkipped += skipped; totalReparadas += reparadas; totalSoportesNuevos += soportesNuevos;
      lastFileName = f.name;

      // Solo registramos un "cargue" si aportó filas nuevas
      if (added > 0) {
        batches.push({ fileName: f.name, rowCount: rows.length, addedCount: added, skippedCount: skipped, uploadedAt: new Date().toISOString() });
      }
    }

    // Aviso claro de lo que quedó por fuera, con el nombre del archivo.
    const avisoOmitidos = omitidos.length
      ? ' Se omitieron ' + omitidos.length + ' archivo(s): ' + omitidos.join('; ') + '.'
      : '';

    if (!merged.length) {
      showToast('No se encontraron filas de datos en los archivos de Drive.' + avisoOmitidos, true);
      return;
    }

    await idbPut({ key: KEY, rows: merged, fileName: lastFileName || (existing && existing.fileName) || '', batches, updatedAt: new Date().toISOString() });

    // Resumen claro: cuántas líneas se leyeron en total, cuántas eran nuevas y cuántas
    // ya estaban cargadas. Como la sincronización vuelve a leer TODOS los archivos de
    // la carpeta, es normal que la cifra de "ya cargadas" sea alta.
    showToast('"' + def.title + '" sincronizado desde Drive: +' + fmtInt(totalAdded) + ' filas nuevas de '
      + fmtInt(totalAdded + totalSkipped) + ' leídas en ' + fmtInt(ordered.length - omitidos.length) + ' archivo(s)'
      + (totalSkipped ? (' (' + fmtInt(totalSkipped) + ' ya estaban cargadas)') : '')
      + (totalReparadas ? (' · ' + fmtInt(totalReparadas) + ' filas actualizadas con Estado/Usuario') : '')
      + (totalSoportesNuevos ? (' · ' + fmtInt(totalSoportesNuevos) + ' líneas que ahora SÍ traen soporte') : '')
      + '. Total acumulado: ' + fmtInt(merged.length) + ' filas.' + avisoOmitidos, omitidos.length > 0);

    if (omitidos.length) showDriveError('reporte', 'Archivos omitidos por columnas faltantes: ' + omitidos.join('; '));

    await refreshStatusFromDB();
  } catch (err) {
    console.error('Drive sync error (reporte):', err);
    showDriveError('reporte', driveErrorMessage(err), err);
  } finally {
    _driveSyncingReporte = false;
    renderUploadCards();
  }
}

/* ---------- Sincronización Drive de "Homólogo" (REEMPLAZA, no acumula) ----------
   Lee el archivo más reciente de la carpeta de Drive y sustituye por completo el
   catálogo maestro. Los datos quedan solo en el almacén local del navegador. */
async function syncHomologoFromDrive() {
  if (_driveSyncingHomologo) return;
  _driveSyncingHomologo = true;
  renderUploadCards();

  const KEY = 'homologo';
  const def = DATASETS.find(d => d.key === KEY);

  try {
    clearDriveError('homologo');
    const accessToken = await authenticateDrive();

    const files = await listDriveFiles(accessToken, DRIVE_FOLDER_HOMOLOGO);
    if (!files || !files.length) throw new Error('NO_FILES');

    _driveFilesHomologo = files.map(f => ({ name: f.name, modifiedTime: f.modifiedTime }));

    // El más reciente manda: este catálogo reemplaza, no acumula
    const newest = files.slice().sort((a, b) => String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')))[0];

    showToast('Leyendo desde Drive: ' + newest.name + '…');
    const buf = await downloadDriveFile(accessToken, newest.id, newest.mimeType);
    const wb = readWorkbookFromBuffer(buf, newest.name, newest.mimeType);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    if (!aoa.length) throw new Error('El archivo está vacío.');

    const rows = parseRowsFromAOA(aoa, def, newest.name);
    if (!rows.length) {
      showToast('No se encontraron filas de datos en el archivo de Drive.', true);
      return;
    }

    await idbPut({ key: KEY, rows, fileName: newest.name, batches: null, updatedAt: new Date().toISOString() });

    showToast('"' + def.title + '" sincronizado desde Drive: ' + fmtInt(rows.length) + ' filas (catálogo reemplazado).');

    await refreshStatusFromDB();
  } catch (err) {
    console.error('Drive sync error (homologo):', err);
    showDriveError('homologo', driveErrorMessage(err), err);
  } finally {
    _driveSyncingHomologo = false;
    renderUploadCards();
  }
}

/* ---------- Acumulador común para las carpetas de Drive que SUMAN datos ----------
   Lee TODOS los archivos de la carpeta (del más antiguo al más reciente) y los suma
   a lo que ya estaba guardado, sin duplicar las líneas que ya se habían cargado.
   Nunca borra el acumulado: lo único que lo borra es el botón "Borrar acumulado".
   Devuelve un resumen con lo que se agregó, lo que ya estaba y lo que se omitió. */
async function acumularCarpetaDrive(accessToken, files, KEY, def) {
  // Del más antiguo al más reciente, para que el historial de cargues quede en orden
  const ordered = files.slice().sort((a, b) => String(a.modifiedTime || '').localeCompare(String(b.modifiedTime || '')));

  const existing = await idbGet(KEY);
  const prevRows = existing ? existing.rows : [];
  const prevBatches = existing && existing.batches
    ? existing.batches
    : (existing ? [{ fileName: existing.fileName, rowCount: prevRows.length, addedCount: prevRows.length, uploadedAt: existing.updatedAt }] : []);

  const seen = new Map();
  // Las líneas repetidas legítimas (la misma línea varias veces en un documento) se
  // numeran igual al reconstruir el acumulado y al leer el archivo, para conservarlas.
  const contadorPrevio = nuevoContadorRepeticiones();
  prevRows.forEach(r => { const k = dedupKeyFor(KEY, r, contadorPrevio); if (!seen.has(k)) seen.set(k, r); });

  const merged = prevRows.slice();
  const batches = prevBatches.slice();
  // Consecutivo de cargue: cada archivo leído recibe un número mayor que los anteriores.
  let secCargue = siguienteSecCargue(prevRows);

  let totalAdded = 0, totalSkipped = 0, lastFileName = '';
  const omitidos = []; // archivos dejados por fuera (columnas faltantes o ilegibles)

  for (let i = 0; i < ordered.length; i++) {
    const f = ordered[i];
    showToast('Leyendo desde Drive: ' + f.name + '…');
    let rows;
    try {
      const buf = await downloadDriveFile(accessToken, f.id, f.mimeType);
      const wb = readWorkbookFromBuffer(buf, f.name, f.mimeType);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      if (!aoa.length) continue;
      rows = parseRowsFromAOA(aoa, def, f.name);
    } catch (fileErr) {
      console.warn('No se pudo leer ' + f.name + ':', fileErr);
      if (fileErr && fileErr.code === 'COLUMNAS_FALTANTES') {
        omitidos.push(f.name + ' (faltan: ' + (fileErr.columnasFaltantes || []).join(', ') + ')');
      } else {
        omitidos.push(f.name + ' (no se pudo leer)');
      }
      continue;
    }
    if (!rows || !rows.length) continue;

    // La fecha de cargue es la fecha REAL del archivo en Drive, no el momento de
    // sincronizar: así cada archivo queda ubicado en el periodo que le corresponde.
    const nowISO = f.modifiedTime ? new Date(f.modifiedTime).toISOString() : new Date().toISOString();
    const secArchivo = secCargue++;
    const contador = nuevoContadorRepeticiones();
    let added = 0, skipped = 0;
    for (let j = 0; j < rows.length; j++) {
      const k = dedupKeyFor(KEY, rows[j], contador);
      if (seen.has(k)) {
        skipped++;
        const prevRow = seen.get(k);
        // Se conserva la fecha y el número del cargue en que la línea apareció por
        // primera vez; no se mueve hacia atrás.
        if (!prevRow._fechaCargue) prevRow._fechaCargue = nowISO;
        if (!prevRow._secCargue) prevRow._secCargue = secArchivo;
        // La línea ya estaba: completamos los campos que estuvieran vacíos
        completarCamposFaltantes(prevRow, rows[j]);
        continue;
      }
      rows[j]._fechaCargue = nowISO;
      rows[j]._secCargue = secArchivo;
      seen.set(k, rows[j]); merged.push(rows[j]); added++;
    }
    totalAdded += added; totalSkipped += skipped; lastFileName = f.name;

    // Solo cuenta como "cargue" el archivo que aportó líneas nuevas
    if (added > 0) {
      batches.push({ fileName: f.name, rowCount: rows.length, addedCount: added, skippedCount: skipped, uploadedAt: new Date().toISOString() });
    }
  }

  return { merged, batches, totalAdded, totalSkipped, omitidos, lastFileName, existing, leidos: ordered.length - omitidos.length };
}

// Mensaje de resumen común para las carpetas que acumulan
function mensajeAcumulado(def, res) {
  const avisoOmitidos = res.omitidos.length
    ? ' Se omitieron ' + res.omitidos.length + ' archivo(s): ' + res.omitidos.join('; ') + '.'
    : '';
  return '"' + def.title + '" sincronizado desde Drive: +' + fmtInt(res.totalAdded) + ' filas nuevas de '
    + fmtInt(res.totalAdded + res.totalSkipped) + ' leídas en ' + fmtInt(res.leidos) + ' archivo(s)'
    + (res.totalSkipped ? (' (' + fmtInt(res.totalSkipped) + ' ya estaban cargadas)') : '')
    + '. Total acumulado: ' + fmtInt(res.merged.length) + ' filas en ' + fmtInt(res.batches.length) + ' cargue(s).'
    + avisoOmitidos;
}

/* ---------- Sincronización Drive de "Traslados" (ACUMULATIVA) ----------
   Suma los traslados nuevos de la carpeta a los que ya estaban cargados; no reemplaza.
   Los datos quedan solo en el almacén local del navegador. */
async function syncTrasladosFromDrive() {
  if (_driveSyncingTraslados) return;
  _driveSyncingTraslados = true;
  renderUploadCards();

  const KEY = 'traslados';
  const def = DATASETS.find(d => d.key === KEY);

  try {
    clearDriveError('traslados');
    const accessToken = await authenticateDrive();

    const files = await listDriveFiles(accessToken, DRIVE_FOLDER_TRASLADOS);
    if (!files || !files.length) throw new Error('NO_FILES');

    _driveFilesTraslados = files.map(f => ({ name: f.name, modifiedTime: f.modifiedTime }));

    const res = await acumularCarpetaDrive(accessToken, files, KEY, def);

    if (!res.merged.length) {
      showToast('No se encontraron filas de datos en los archivos de Drive.', true);
      return;
    }

    await idbPut({ key: KEY, rows: res.merged, fileName: res.lastFileName || (res.existing && res.existing.fileName) || '', batches: res.batches, updatedAt: new Date().toISOString() });

    showToast(mensajeAcumulado(def, res), res.omitidos.length > 0);
    if (res.omitidos.length) showDriveError('traslados', 'Archivos omitidos: ' + res.omitidos.join('; '));

    await refreshStatusFromDB();
  } catch (err) {
    console.error('Drive sync error (traslados):', err);
    showDriveError('traslados', driveErrorMessage(err), err);
  } finally {
    _driveSyncingTraslados = false;
    renderUploadCards();
  }
}

/* ---------- Sincronización Drive de "Facturas" (ACUMULATIVA) ----------
   Suma las facturas nuevas de la carpeta a las que ya estaban cargadas; no reemplaza.
   Los datos quedan solo en el almacén local del navegador. */
async function syncFacturasFromDrive() {
  if (_driveSyncingFacturas) return;
  _driveSyncingFacturas = true;
  renderUploadCards();

  const KEY = 'facturas';
  const def = DATASETS.find(d => d.key === KEY);

  try {
    clearDriveError('facturas');
    const accessToken = await authenticateDrive();

    const files = await listDriveFiles(accessToken, DRIVE_FOLDER_FACTURAS);
    if (!files || !files.length) throw new Error('NO_FILES');

    _driveFilesFacturas = files.map(f => ({ name: f.name, modifiedTime: f.modifiedTime }));

    const res = await acumularCarpetaDrive(accessToken, files, KEY, def);

    if (!res.merged.length) {
      showToast('No se encontraron filas de datos en los archivos de Drive.', true);
      return;
    }

    await idbPut({ key: KEY, rows: res.merged, fileName: res.lastFileName || (res.existing && res.existing.fileName) || '', batches: res.batches, updatedAt: new Date().toISOString() });

    showToast(mensajeAcumulado(def, res), res.omitidos.length > 0);
    if (res.omitidos.length) showDriveError('facturas', 'Archivos omitidos: ' + res.omitidos.join('; '));

    await refreshStatusFromDB();
  } catch (err) {
    console.error('Drive sync error (facturas):', err);
    showDriveError('facturas', driveErrorMessage(err), err);
  } finally {
    _driveSyncingFacturas = false;
    renderUploadCards();
  }
}

/* ---------- Sincronización Drive de "Inventario Físico" (REEMPLAZA, no acumula) ----------
   Lee el archivo más reciente de la carpeta de Drive del conteo físico y sustituye
   por completo la tabla. Los datos quedan solo en el almacén local del navegador. */
async function syncInvFisicoFromDrive() {
  if (_driveSyncingInvFisico) return;
  _driveSyncingInvFisico = true;
  renderUploadCards();

  const KEY = 'invfisico';
  const def = DATASETS.find(d => d.key === KEY);

  try {
    clearDriveError('invfisico');
    const accessToken = await authenticateDrive();

    const files = await listDriveFiles(accessToken, DRIVE_FOLDER_INVFISICO);
    if (!files || !files.length) throw new Error('NO_FILES');

    _driveFilesInvFisico = files.map(f => ({ name: f.name, modifiedTime: f.modifiedTime }));

    const newest = files.slice().sort((a, b) => String(b.modifiedTime || '').localeCompare(String(a.modifiedTime || '')))[0];

    showToast('Leyendo desde Drive: ' + newest.name + '…');
    const buf = await downloadDriveFile(accessToken, newest.id, newest.mimeType);
    const wb = readWorkbookFromBuffer(buf, newest.name, newest.mimeType);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
    if (!aoa.length) throw new Error('El archivo está vacío.');

    const rows = parseRowsFromAOA(aoa, def, newest.name);
    if (!rows.length) {
      showToast('No se encontraron filas de datos en el archivo de Drive.', true);
      return;
    }

    await idbPut({ key: KEY, rows, fileName: newest.name, batches: null, updatedAt: new Date().toISOString() });

    showToast('"' + def.title + '" sincronizado desde Drive: ' + fmtInt(rows.length) + ' filas (tabla reemplazada).');

    await refreshStatusFromDB();
  } catch (err) {
    console.error('Drive sync error (invfisico):', err);
    showDriveError('invfisico', driveErrorMessage(err), err);
  } finally {
    _driveSyncingInvFisico = false;
    renderUploadCards();
  }
}

/* ---------- Capa de diagnostico para llamadas a Google Drive ----------
   Antes cualquier fallo se convertia en un mensaje generico de "sin permiso",
   lo que hacia imposible saber que estaba pasando realmente. Ahora se conserva
   el codigo HTTP y el mensaje textual que devuelve la API de Drive. */
async function driveApiFetch(url, accessToken) {
  let resp;
  try {
    resp = await fetch(url, { headers: { 'Authorization': 'Bearer ' + accessToken } });
  } catch (netErr) {
    const e = new Error('DRIVE_NETWORK');
    e.driveDetail = netErr && netErr.message ? netErr.message : 'fallo de red';
    throw e;
  }
  if (!resp.ok) {
    let detail = '';
    try {
      const j = await resp.json();
      if (j && j.error) detail = j.error.message || j.error.status || '';
    } catch (e) { /* respuesta sin JSON */ }
    const e = new Error('DRIVE_HTTP_' + resp.status);
    e.httpStatus = resp.status;
    e.driveDetail = detail;
    throw e;
  }
  return resp;
}

// Verifica si el token realmente incluye permiso de lectura de Drive
async function driveTokenHasDriveScope(accessToken) {
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(accessToken));
    if (!r.ok) return null; // no se pudo verificar
    const j = await r.json();
    return String(j.scope || '').indexOf('drive') >= 0;
  } catch (e) { return null; }
}

function isSpreadsheetFile(f) {
  const m = String(f.mimeType || '').toLowerCase();
  const n = String(f.name || '').toLowerCase();
  if (m.indexOf('spreadsheet') >= 0) return true;
  if (m === 'application/vnd.ms-excel' || m === 'text/csv' || m === 'application/csv') return true;
  return /\.(xlsx|xlsm|xlsb|xls|csv|tsv)$/.test(n);
}

async function listDriveFiles(accessToken, folderId) {
  const fid = folderId || DRIVE_FOLDER_ID;
  // Consulta permisiva: todo lo que no sea carpeta. El filtrado por tipo de
  // archivo se hace despues en el navegador, asi un mimeType inesperado
  // (p. ej. octet-stream) ya no hace que la carpeta parezca vacia.
  const q = "'" + fid + "' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'";
  const url = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q)
    + '&fields=files(id,name,mimeType,modifiedTime,size)'
    + '&orderBy=modifiedTime desc&pageSize=200'
    + '&supportsAllDrives=true&includeItemsFromAllDrives=true';
  const resp = await driveApiFetch(url, accessToken);
  const data = await resp.json();
  const all = data.files || [];
  if (!all.length) {
    const e = new Error('NO_FILES');
    e.driveDetail = 'La carpeta ' + fid + ' respondio 0 archivos para esta cuenta de Google.';
    throw e;
  }
  const ok = all.filter(isSpreadsheetFile);
  if (!ok.length) {
    const e = new Error('NO_SPREADSHEETS');
    e.driveDetail = 'Se vieron ' + all.length + ' archivo(s) pero ninguno se reconocio como Excel/CSV: '
      + all.slice(0, 5).map(function(f){ return f.name + ' [' + f.mimeType + ']'; }).join(', ');
    throw e;
  }
  return ok;
}

async function downloadDriveFile(accessToken, fileId, mimeType) {
  let url;
  if (mimeType === 'application/vnd.google-apps.spreadsheet') {
    url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '/export?mimeType=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  } else {
    url = 'https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media&supportsAllDrives=true';
  }
  const resp = await driveApiFetch(url, accessToken);
  return resp.arrayBuffer();
}

/* Traduce cualquier fallo de Drive/Auth a un mensaje concreto y accionable. */
function driveErrorMessage(err) {
  const code = (err && err.code) || '';
  const msg = (err && err.message) || '';
  const detail = (err && err.driveDetail) || '';

  // El archivo se descargó bien, pero le faltan columnas obligatorias: el aviso ya
  // viene redactado en español con el nombre del archivo y qué columnas faltan.
  if (code === 'COLUMNAS_FALTANTES') return msg;

  // --- Errores de autorizacion de Google (OAuth / Google Identity Services) ---
  if (msg === 'GIS_NOT_LOADED')
    return 'No se pudo cargar el servicio de acceso de Google. Revisa la conexion o el bloqueador de anuncios y recarga la pagina.';
  if (msg === 'NO_CLIENT_ID')
    return 'Falta el ID de cliente OAuth de Google. Pulsa "⚙ Configurar acceso a Google" en esta tarjeta y pega el ID que termina en .apps.googleusercontent.com (Google Cloud > APIs y servicios > Credenciales).';
  if (msg === 'BAD_CLIENT_ID')
    return 'El ID de cliente que pegaste no tiene el formato correcto. Debe terminar en .apps.googleusercontent.com. Pulsa "⚙ Configurar acceso a Google" y pegalo de nuevo (no es la clave de API ni el secreto de cliente).';
  if (msg === 'INVALID_CLIENT')
    return 'Google respondio "Acceso bloqueado / Error 401: invalid_client": el ID de cliente OAuth no existe en Google Cloud o no corresponde a este sitio.\n'
      + 'Que revisar:\n'
      + '1) Que el ID este creado como tipo "Aplicacion web" y NO haya sido borrado.\n'
      + '2) Que en "Origenes autorizados de JavaScript" figure exactamente: ' + driveOriginActual() + '\n'
      + '3) Que la Google Drive API este habilitada en ese mismo proyecto.\n'
      + 'Ya se borro el ID guardado: pulsa "⚙ Configurar acceso a Google" y pega el correcto.'
      + (err && err.oauthDetail ? ' [' + err.oauthDetail + ']' : '');
  if (msg === 'POPUP_BLOCKED')
    return 'El navegador bloqueo la ventana de Google. Permite las ventanas emergentes de este sitio e intenta de nuevo.';
  if (msg === 'POPUP_CLOSED')
    return 'Se cerro la ventana de Google antes de terminar. Vuelve a intentarlo y acepta el permiso de lectura de Drive.';
  if (msg === 'access_denied')
    return 'Se rechazo el permiso en la pantalla de Google. Vuelve a sincronizar y acepta "Ver tus archivos de Google Drive".';
  if (msg === 'idpiframe_initialization_failed' || msg === 'invalid_client' || msg === 'unauthorized_client' || /client_?id|invalid_client/i.test(msg))
    return 'El ID de cliente OAuth no es valido para este sitio. Verifica en Google Cloud > Credenciales que este origen figure en "Origenes autorizados de JavaScript": ' + driveOriginActual() + '. Luego pulsa "⚙ Configurar acceso a Google" y pega el ID correcto.';
  if (msg === 'OAUTH_NO_TOKEN' || msg === 'OAUTH_ERROR')
    return 'Google no devolvio un token de acceso. Vuelve a intentarlo y acepta el permiso de lectura de Drive.' + (err && err.oauthDetail ? ' [' + err.oauthDetail + ']' : '');
  if (msg === 'NO_SCOPE')
    return 'Se autorizo el acceso pero NO se concedio el permiso "Ver tus archivos de Google Drive". Vuelve a sincronizar y acepta esa casilla en la pantalla de Google.';

  // --- Errores de la API de Drive ---
  if (err && err.httpStatus === 401)
    return 'Google rechazo el token (401): la sesion expiro o falta el permiso de lectura de Drive. Vuelve a sincronizar y acepta el permiso.' + (detail ? ' [' + detail + ']' : '');
  if (err && err.httpStatus === 403) {
    if (/insufficient|scope|permission/i.test(detail))
      return 'El token no tiene permiso de lectura de Drive (403). En la pantalla de Google debes aceptar "Ver tus archivos de Google Drive". [' + detail + ']';
    if (/has not been used|disabled|not enabled|Drive API/i.test(detail))
      return 'La API de Google Drive no esta habilitada en tu proyecto de Google Cloud. Habilitala en Google Cloud > APIs y servicios > Google Drive API. [' + detail + ']';
    if (/rateLimit|quota|userRateLimit/i.test(detail))
      return 'Google limito temporalmente las peticiones (403). Espera un minuto e intenta de nuevo. [' + detail + ']';
    return 'Google Drive rechazo la peticion (403). [' + (detail || 'sin detalle') + ']';
  }
  if (err && err.httpStatus === 404)
    return 'La carpeta no existe o la cuenta con la que iniciaste sesion no la ve (404). Verifica el ID de la carpeta y que sea la misma cuenta duena del Drive. [' + (detail || '') + ']';
  if (err && err.httpStatus)
    return 'Error ' + err.httpStatus + ' de Google Drive. [' + (detail || 'sin detalle') + ']';
  if (msg === 'DRIVE_NETWORK' || code === 'network-request-failed')
    return 'Error de red al contactar Google. Revisa la conexion, la VPN o el bloqueador de anuncios. [' + (detail || '') + ']';

  // --- Contenido de la carpeta ---
  if (msg === 'NO_FILES')
    return 'La carpeta respondio 0 archivos para la cuenta con la que iniciaste sesion. Asegurate de iniciar sesion con la MISMA cuenta que ve los archivos, o comparte la carpeta con esa cuenta. [' + (detail || '') + ']';
  if (msg === 'NO_SPREADSHEETS')
    return 'La carpeta tiene archivos, pero ninguno se reconocio como Excel/CSV. [' + (detail || '') + ']';
  if (msg === 'NO_PERMISSION')
    return 'No tienes permiso de lectura sobre la carpeta de Google Drive.';

  return 'Fallo la sincronizacion con Drive: ' + (msg || 'error desconocido') + (detail ? ' [' + detail + ']' : '');
}

/* Guarda el error para mostrarlo DENTRO de la tarjeta (el toast desaparece muy rapido)
   y ademas lo muestra como aviso. */
let _driveErrorInventario = '';
let _driveErrorReporte = '';
let _driveErrorHomologo = '';
let _driveErrorTraslados = '';
let _driveErrorFacturas = '';
let _driveErrorInvFisico = '';
function escapeHtmlTxt(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function showDriveError(which, message, err) {
  const tech = err ? ((err.message || '') + (err.code ? ' / ' + err.code : '') + (err.driveDetail ? ' / ' + err.driveDetail : '')) : '';
  if (tech) console.warn('Detalle tecnico Drive (' + which + '):', tech);
  let full = message;
  if (_driveAccountEmail) full += '\nSesion iniciada con: ' + _driveAccountEmail;
  if (which === 'reporte') _driveErrorReporte = full;
  else if (which === 'homologo') _driveErrorHomologo = full;
  else if (which === 'traslados') _driveErrorTraslados = full;
  else if (which === 'facturas') _driveErrorFacturas = full;
  else if (which === 'invfisico') _driveErrorInvFisico = full;
  else _driveErrorInventario = full;
  showToast(message, true);
}
function clearDriveError(which) {
  if (which === 'reporte') _driveErrorReporte = '';
  else if (which === 'homologo') _driveErrorHomologo = '';
  else if (which === 'traslados') _driveErrorTraslados = '';
  else if (which === 'facturas') _driveErrorFacturas = '';
  else if (which === 'invfisico') _driveErrorInvFisico = '';
  else _driveErrorInventario = '';
}

function parseRowsFromAOA(aoa, datasetDef, fileName) {
  let headerRowIdx = 0, bestScore = -1;
  const allAliases = new Set();
  Object.values(datasetDef.fields).forEach(arr => arr.forEach(a => allAliases.add(compactHeader(a))));
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    let score = 0;
    (aoa[i] || []).forEach(c => { if (allAliases.has(compactHeader(c))) score++; });
    if (score > bestScore) { bestScore = score; headerRowIdx = i; }
  }
  const headerIndex = buildHeaderIndex(aoa[headerRowIdx]);
  // Antes de leer una sola fila comprobamos que el archivo traiga las columnas
  // obligatorias. Si no, se avisa con nombre y no se importa nada: así no entran
  // filas vacías al acumulado ni aparecen totales que no cuadran.
  const faltan = columnasObligatoriasFaltantes(datasetDef, headerIndex);
  if (faltan.length) throw errorColumnasFaltantes(datasetDef, headerIndex, faltan, fileName);
  const rows = [];
  for (let r = headerRowIdx + 1; r < aoa.length; r++) {
    const raw = aoa[r];
    if (!raw || raw.every(c => c === '' || c === null || c === undefined)) continue;
    rows.push(mapRowToFields(raw, headerIndex, datasetDef.fields));
  }
  return rows;
}

// Restaura la lista de archivos vistos en Drive (solo para mostrarla en las tarjetas)
function restoreDriveFileLists() {
  try {
    const storedFiles = localStorage.getItem('inventario_drive_files');
    if (storedFiles) {
      try { _driveFiles = JSON.parse(storedFiles); } catch(e) { _driveFiles = []; }
    }
    const storedFilesRep = localStorage.getItem('reporte_drive_files');
    if (storedFilesRep) {
      try { _driveFilesReporte = JSON.parse(storedFilesRep); } catch(e) { _driveFilesReporte = []; }
    }
  } catch(e) { /* ignore */ }
}

// Carga Inventario y Reporte desde el almacen local del navegador (datos de Drive)
async function loadDriveOnlyFromLocal() {
  restoreDriveFileLists();
  for (let i = 0; i < DRIVE_ONLY_KEYS.length; i++) {
    const key = DRIVE_ONLY_KEYS[i];
    try {
      const rec = await idbGet(key);
      if (rec && rec.rows && rec.rows.length) {
        state.loaded[key] = {
          rowCount: rec.rows.length,
          fileName: rec.fileName || '',
          updatedAt: rec.updatedAt || '',
          batches: rec.batches || null
        };
      }
    } catch(e) { /* ignore */ }
  }
}

function renderUploadCards(){
  const grid=document.getElementById('uploadGrid'); grid.innerHTML='';
  DATASETS.forEach(d=>{
    const loaded=state.loaded[d.key];
    const card=document.createElement('div');
    card.className='card '+(d.required?'required':'optional')+(loaded?' loaded':'');
    const nBatches = loaded && loaded.batches ? loaded.batches.length : (loaded ? 1 : 0);
    if(d.key === 'inventario') {
      card.className = 'card drive-only required' + (loaded ? ' loaded' : '');
      card.innerHTML = inventarioCardHTML(d, loaded);
    } else if(d.key === 'reporte') {
      card.className = 'card drive-reporte required' + (loaded ? ' loaded' : '');
      card.innerHTML = reporteCardHTML(d, loaded);
    } else if(d.key === 'homologo') {
      card.className = 'card drive-only required' + (loaded ? ' loaded' : '');
      card.innerHTML = homologoCardHTML(d, loaded);
    } else if(d.key === 'traslados') {
      card.className = 'card drive-only optional' + (loaded ? ' loaded' : '');
      card.innerHTML = trasladosCardHTML(d, loaded);
    } else if(d.key === 'facturas') {
      card.className = 'card drive-only optional' + (loaded ? ' loaded' : '');
      card.innerHTML = facturasCardHTML(d, loaded);
    } else if(d.key === 'invfisico') {
      card.className = 'card drive-only optional' + (loaded ? ' loaded' : '');
      card.innerHTML = invFisicoCardHTML(d, loaded);
    } else {
      card.innerHTML = `<h3>${d.title}${d.accumulate ? ' <span class="acumulativo-tag">· acumulativo</span>' : ''}</h3>
      <p class="desc">${d.desc}</p>
      <div class="cols">${d.cols.join(' · ')}</div>
      <label class="drop" data-key="${d.key}">
        <input type="file" accept=".xlsx,.xls,.csv" data-key="${d.key}">
        <div class="hint"><b>Clic para cargar</b> o arrastra el archivo aquí${d.accumulate ? '<br><span style="color:var(--green);">se suma a lo ya cargado</span>' : ''}</div>
      </label>
      <div class="status-row">
        ${loaded
          ? `<span class="rows">✓ ${fmtInt(loaded.rowCount)} filas${d.accumulate && nBatches>1 ? ' · '+nBatches+' cargues' : ''}</span><button class="clear" data-key="${d.key}">${d.accumulate ? 'Borrar acumulado' : 'Quitar'}</button>`
          : `<span class="empty">Sin cargar</span><span></span>`}
      </div>
      ${loaded && loaded.fileName ? `<div class="filename">${d.accumulate ? 'Último archivo: ' : ''}${loaded.fileName}</div>` : ''}
      ${d.accumulate && loaded && loaded.batches && loaded.batches.length ? `<div class="filename" style="margin-top:4px;">${loaded.batches.slice(-3).map(b=>`${b.fileName} (+${fmtInt(b.addedCount!==undefined?b.addedCount:b.rowCount)})`).join(' · ')}${loaded.batches.length>3?' · …':''}</div>` : ''}`;
    }
    grid.appendChild(card);
  });
  grid.querySelectorAll('input[type=file]').forEach(inp=>{
    inp.addEventListener('change', e=>handleFileSelected(e.target.dataset.key, e.target.files[0]));
  });
  grid.querySelectorAll('.drop').forEach(dz=>{
    dz.addEventListener('dragover', e=>{e.preventDefault(); dz.classList.add('drag');});
    dz.addEventListener('dragleave', ()=>dz.classList.remove('drag'));
    dz.addEventListener('drop', e=>{
      e.preventDefault(); dz.classList.remove('drag');
      const f=e.dataTransfer.files[0]; if(f) handleFileSelected(dz.dataset.key, f);
    });
  });
  grid.querySelectorAll('button.clear').forEach(btn=>{
    btn.addEventListener('click', async e=>{
      e.preventDefault(); const key=btn.dataset.key;
      const def=DATASETS.find(d=>d.key===key);
      if(def.accumulate){
        if(!confirm('Esto borra TODO el acumulado de "'+def.title+'" (todos los días que has cargado), no solo el último archivo. ¿Continuar?')) return;
      }
      await idbDelete(key);
      showToast('Se eliminó "'+def.title+'".');
      refreshStatusFromDB();
    });
  });
}

// Clave de deduplicación para el cargue acumulativo del Reporte de Dispensación:
// identifica una misma línea aunque se vuelva a cargar el mismo día/archivo.
// Se usan varios datos de la línea (no solo el documento y el código) porque un mismo
// documento puede tener varias líneas parecidas: si la clave es muy corta, líneas
// distintas se confunden entre sí y el archivo nuevo aparece como "0 filas nuevas".
function reporteRowDedupKey(r){
  // La fecha y las cantidades se normalizan para que una misma línea leída desde
  // .xlsx (valores nativos) o desde .csv (texto) genere exactamente la misma clave.
  const f = dateToISO(toDateSafe(r.fechaDispensacion));
  return [r.documento, r.codigoArticulo, r.bodegaDetalle, r.contrato, f,
          toNumber(r.unidades), toNumber(r.cantidadAutorizada), toNumber(r.diferencia)]
    .map(v => String(v===undefined||v===null?'':v).trim().toUpperCase())
    .join('|');
}
// Contador de repeticiones: cuando un archivo trae VARIAS líneas realmente iguales
// (misma fórmula repetida en el mismo documento), cada una recibe su propio número
// de orden (#1, #2, #3...). Así se conservan todas, y si se vuelve a cargar el mismo
// archivo se siguen reconociendo como las mismas y no se duplican.
function nuevoContadorRepeticiones(){ return new Map(); }

// Clave de deduplicación de "Traslados": identifica una línea de traslado (documento,
// fecha, bodegas, código y cantidad). Sirve para que al volver a sincronizar la carpeta
// de Drive los traslados que ya estaban cargados no se dupliquen.
function trasladoRowDedupKey(r){
  const f = dateToISO(toDateSafe(r.fecha));
  return ['T', r.traslado, f, r.bodegaOrigen, r.bodegaDestino, r.codigo, toNumber(r.cantidad), r.recibido, r.usuario]
    .map(v => String(v===undefined||v===null?'':v).trim().toUpperCase())
    .join('|');
}

// Clave de deduplicación de "Facturas": identifica una línea de factura (número de
// factura, fecha, código, cantidad y punto de venta).
function facturaRowDedupKey(r){
  const f = dateToISO(toDateSafe(r.fechaFactura));
  return ['F', r.factura, f, r.codigo, toNumber(r.cantidad), r.puntoVenta]
    .map(v => String(v===undefined||v===null?'':v).trim().toUpperCase())
    .join('|');
}

function dedupKeyFor(key, r, contador){
  const base = key === 'traslados' ? trasladoRowDedupKey(r)
             : key === 'facturas'  ? facturaRowDedupKey(r)
             : reporteRowDedupKey(r);
  if (!contador) return base;
  const n = (contador.get(base) || 0) + 1;
  contador.set(base, n);
  return base + '#' + n;
}

async function handleFileSelected(key,file){
  if(!file) return;
  const def=DATASETS.find(d=>d.key===key);
  showToast('Leyendo '+file.name+'…');
  try{
    const rows=await parseFile(file,def);
    if(!rows.length){ showToast('No se encontraron filas de datos en '+file.name,true); return; }

    if(def.accumulate){
      // ---- Cargue acumulativo (diario): se suma a lo que ya había guardado ----
      const existing = await idbGet(key);
      const prevRows = existing ? existing.rows : [];
      const prevBatches = existing && existing.batches
        ? existing.batches
        : (existing ? [{fileName:existing.fileName, rowCount:prevRows.length, addedCount:prevRows.length, uploadedAt:existing.updatedAt}] : []);
      const seen = new Map();
      // Se numeran las repeticiones del acumulado igual que las del archivo nuevo, para
      // que las líneas repetidas legítimas (misma fórmula varias veces) no se pierdan.
      const contadorPrevio = nuevoContadorRepeticiones();
      prevRows.forEach(r => { const k = dedupKeyFor(key, r, contadorPrevio); if(!seen.has(k)) seen.set(k, r); });
      const merged = prevRows.slice();
      // La fecha de cargue es la fecha REAL del archivo (última modificación), no el
      // momento de subirlo: así cada archivo cae en el corte que le corresponde y un
      // recargue posterior sí se ve como cambio de un corte a otro.
      const nowISO = (file && file.lastModified ? new Date(file.lastModified) : new Date()).toISOString();
      // Número de este cargue: siempre mayor que el de todos los cargues anteriores.
      const secArchivo = siguienteSecCargue(prevRows);
      let added=0, skipped=0, reparadas=0, soportesNuevos=0;
      const contador = nuevoContadorRepeticiones();
      rows.forEach(r=>{
        const k=dedupKeyFor(key,r,contador);
        if(seen.has(k)){
          skipped++;
          const prevRow=seen.get(k);
          // Se conserva la fecha y el número del cargue en que la línea apareció por
          // primera vez: es la referencia para reconocer cumplimientos posteriores.
          if(!prevRow._fechaCargue) prevRow._fechaCargue = nowISO;
          if(!prevRow._secCargue) prevRow._secCargue = secArchivo;
          // Fila ya guardada: rellenamos los campos vacíos (Estado, Usuario Creación...)
          if(completarCamposFaltantes(prevRow, r)) reparadas++;
          // ¿La línea llegó ahora CON soporte cuando antes estaba en 0 / NO TIENE?
          if(key==='reporte' && registrarSoporteRecuperado(prevRow, r, nowISO, secArchivo)) soportesNuevos++;
          return;
        }
        // Guardamos la fecha de cargue en cada fila: sirve para el Reporte Comparativo
        // Periódico (cortes de 1-10 / 11-20 / 21-31), comparando cargue contra cargue.
        r._fechaCargue = nowISO;
        r._secCargue = secArchivo;
        seen.set(k, r); merged.push(r); added++;
      });
      const batches = prevBatches.concat([{fileName:file.name, rowCount:rows.length, addedCount:added, skippedCount:skipped, uploadedAt:new Date().toISOString()}]);
      await idbPut({key, rows:merged, fileName:file.name, batches, updatedAt:new Date().toISOString()});
      showToast('"'+def.title+'": +'+fmtInt(added)+' filas nuevas de '+fmtInt(rows.length)+' leídas'+(skipped?(' ('+fmtInt(skipped)+' ya estaban cargadas)'):'')+(reparadas?(' · '+fmtInt(reparadas)+' filas actualizadas con Estado/Usuario'):'')+(soportesNuevos?(' · '+fmtInt(soportesNuevos)+' líneas que ahora SÍ traen soporte'):'')+'. Total acumulado: '+fmtInt(merged.length)+' filas.');
    }else{
      await idbPut({key, rows, fileName:file.name, updatedAt:new Date().toISOString()});
      showToast('"'+def.title+'" cargado: '+fmtInt(rows.length)+' filas.');
    }await refreshStatusFromDB();
}catch(err){
  console.error(err);
  // Si faltan columnas obligatorias el mensaje ya explica en español cuáles son y
  // menciona el archivo: se muestra tal cual, sin prefijos técnicos.
  if(err && err.code==='COLUMNAS_FALTANTES') showToast(err.message, true);
  else showToast('Error leyendo '+file.name+': '+err.message,true);
}
}
/* =========================================================================
   Copia de seguridad (respaldo) y restauracion de TODOS los datos cargados
   ========================================================================= */
const BACKUP_APP_ID = 'medisfarma-dashboard';
const BACKUP_VERSION = 1;

// Las fechas (objetos Date) se guardan marcadas para poder devolverlas
// exactamente igual al restaurar la copia.
function backupEncodeValue(v){
  if(v instanceof Date) return isNaN(v) ? null : {__date: v.toISOString()};
  return v;
}
function backupEncodeRows(rows){
  return (rows||[]).map(r=>{
    if(!r || typeof r!=='object') return r;
    const o={};
    Object.keys(r).forEach(k=>{ o[k]=backupEncodeValue(r[k]); });
    return o;
  });
}
function backupDecodeRows(rows){
  return (rows||[]).map(r=>{
    if(!r || typeof r!=='object') return r;
    const o={};
    Object.keys(r).forEach(k=>{
      const v=r[k];
      if(v && typeof v==='object' && typeof v.__date==='string'){
        const d=new Date(v.__date); o[k]=isNaN(d)?null:d;
      }else{ o[k]=v; }
    });
    return o;
  });
}
function backupStamp(){
  const d=new Date();
  const p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes());
}
function descargarArchivo(nombre, blob){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=nombre;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}

async function construirRespaldo(){
  const all=await idbGetAll();
  const datasets=all.filter(r=>r && r.key && r.rows).map(r=>({
    key: r.key,
    title: (DATASETS.find(d=>d.key===r.key)||{}).title || r.key,
    fileName: r.fileName || '',
    updatedAt: r.updatedAt || '',
    batches: r.batches || null,
    rowCount: r.rows.length,
    rows: backupEncodeRows(r.rows)
  }));
  let driveFiles=null;
  try{
    driveFiles={
      inventario: JSON.parse(localStorage.getItem('inventario_drive_files')||'null'),
      reporte: JSON.parse(localStorage.getItem('reporte_drive_files')||'null')
    };
  }catch(e){ driveFiles=null; }
  return {
    app: BACKUP_APP_ID,
    version: BACKUP_VERSION,
    generadoEn: new Date().toISOString(),
    totalFilas: datasets.reduce((a,b)=>a+b.rowCount,0),
    driveFiles,
    datasets
  };
}

async function descargarRespaldoJSON(){
  const btn=document.getElementById('btnBackup');
  try{
    if(btn){ btn.disabled=true; }
    showToast('Preparando la copia de seguridad…');
    const backup=await construirRespaldo();
    if(!backup.datasets.length){ showToast('No hay datos cargados para respaldar.',true); return; }
    const blob=new Blob([JSON.stringify(backup)],{type:'application/json'});
    descargarArchivo('Respaldo_Medisfarma_'+backupStamp()+'.json', blob);
    showToast('Copia de seguridad descargada: '+backup.datasets.length+' fuente(s) · '+fmtInt(backup.totalFilas)+' filas. Guárdala en un lugar seguro.');
  }catch(err){
    console.error(err);
    showToast('No se pudo generar la copia de seguridad: '+err.message,true);
  }finally{ if(btn){ btn.disabled=false; } }
}

/* =========================================================================
   Paquete cifrado para el VISOR (solo lectura)
   El administrador publica aqui un archivo .medisfarma protegido con
   contrasena; quien consulta lo abre en la app de resultados y unicamente
   puede ver los indicadores (no puede cargar fuentes).
   ========================================================================= */
const PAQUETE_APP_ID = 'medisfarma-paquete';
const PAQUETE_VERSION = 1;
const PAQUETE_ITERACIONES = 150000; // PBKDF2: coste de derivacion de la clave

// Convierte datos binarios a texto base64 por bloques (evita desbordar la pila
// con archivos grandes).
function bytesABase64(bytes){
  const chunk=0x8000; let s='';
  for(let i=0;i<bytes.length;i+=chunk){
    s+=String.fromCharCode.apply(null, bytes.subarray(i, i+chunk));
  }
  return btoa(s);
}
function base64ABytes(b64){
  const bin=atob(String(b64||''));
  const out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
  return out;
}
// Deriva la clave AES-256 a partir de la contrasena escrita por el administrador.
async function paqueteDerivarClave(password, salt, usos){
  const base=await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name:'PBKDF2', salt, iterations: PAQUETE_ITERACIONES, hash:'SHA-256' },
    base, { name:'AES-GCM', length:256 }, false, usos
  );
}
// Comprime el texto si el navegador lo permite (el paquete pesa mucho menos).
async function paqueteComprimir(texto){
  const bytes=new TextEncoder().encode(texto);
  if(typeof CompressionStream==='undefined') return { datos: bytes, comprimido:false };
  try{
    const cs=new CompressionStream('gzip');
    const escritor=cs.writable.getWriter();
    escritor.write(bytes); escritor.close();
    const buf=await new Response(cs.readable).arrayBuffer();
    return { datos: new Uint8Array(buf), comprimido:true };
  }catch(e){ return { datos: bytes, comprimido:false }; }
}

/* Arma el paquete cifrado: pide la contrasena, comprime y cifra todo lo
   cargado. Devuelve null si el usuario cancela o si algo no cuadra (el aviso
   al usuario ya se muestra aqui). Lo usan tanto la descarga como el envio a
   la carpeta de Drive. */
async function paqueteConstruirSobre(){
  if(!(window.crypto && crypto.subtle)){
    showToast('Este navegador no permite cifrar el paquete. Usa Chrome o Edge actualizado.',true); return null;
  }
  const backup=await construirRespaldo();
  if(!backup.datasets.length){ showToast('No hay datos cargados para publicar.',true); return null; }
  const pass=prompt('Contrasena para proteger el paquete del visor (minimo 6 caracteres).\n\nLa misma contrasena se le entrega a quienes solo consultan.');
  if(pass===null) return null;
  if(String(pass).length<6){ showToast('La contrasena debe tener al menos 6 caracteres.',true); return null; }
  const pass2=prompt('Escribe otra vez la contrasena para confirmarla.');
  if(pass2===null) return null;
  if(pass2!==pass){ showToast('Las contrasenas no coinciden. No se genero el paquete.',true); return null; }
  showToast('Cifrando el paquete para el visor…');
  await new Promise(r=>setTimeout(r,30));
  const { datos, comprimido }=await paqueteComprimir(JSON.stringify(backup));
  const salt=crypto.getRandomValues(new Uint8Array(16));
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const clave=await paqueteDerivarClave(pass, salt, ['encrypt']);
  const cifrado=await crypto.subtle.encrypt({name:'AES-GCM', iv}, clave, datos);
  const sobre={
    app: PAQUETE_APP_ID,
    version: PAQUETE_VERSION,
    generadoEn: new Date().toISOString(),
    fuentes: backup.datasets.length,
    totalFilas: backup.totalFilas,
    comprimido,
    iteraciones: PAQUETE_ITERACIONES,
    salt: bytesABase64(salt),
    iv: bytesABase64(iv),
    datos: bytesABase64(new Uint8Array(cifrado))
  };
  return { sobre, backup };
}

async function publicarPaqueteVisor(){
  const btn=document.getElementById('btnPublicar');
  try{
    const armado=await paqueteConstruirSobre();
    if(!armado) return;
    if(btn){ btn.disabled=true; }
    const blob=new Blob([JSON.stringify(armado.sobre)],{type:'application/json'});
    descargarArchivo('Paquete_Visor_Medisfarma_'+backupStamp()+'.medisfarma', blob);
    showToast('Paquete publicado: '+armado.backup.datasets.length+' fuente(s) · '+fmtInt(armado.backup.totalFilas)+' filas. Envialo junto con la contrasena a quienes solo consultan.');
  }catch(err){
    console.error(err);
    showToast('No se pudo publicar el paquete: '+err.message,true);
  }finally{ if(btn){ btn.disabled=false; } }
}

/* =========================================================================
   Envio del paquete a la carpeta de Drive "Resultados de los indicadores"
   La carpeta NO es acumulativa: antes de subir el paquete nuevo se borran
   los archivos que ya estuvieran alli, para que el visor siempre encuentre
   uno solo (el mas reciente).
   ========================================================================= */
const PAQUETE_DRIVE_MIME = 'application/octet-stream';
const PAQUETE_TIMEOUT_OAUTH = 120000;  // 2 min esperando la ventana de Google
const PAQUETE_TIMEOUT_LISTA  = 45000;   // 45 s consultando la carpeta
const PAQUETE_TIMEOUT_SUBIDA = 900000;  // 15 min de subida (paquetes grandes)

/* Evita que un paso se quede esperando para siempre: si tarda mas de lo
   permitido, se corta y se avisa al usuario con un mensaje claro. */
function conTiempoLimite(promesa, ms, codigo){
  return new Promise((resolve, reject)=>{
    let listo=false;
    const t=setTimeout(()=>{ if(!listo){ listo=true; reject(new Error(codigo)); } }, ms);
    Promise.resolve(promesa).then(
      v=>{ if(!listo){ listo=true; clearTimeout(t); resolve(v); } },
      e=>{ if(!listo){ listo=true; clearTimeout(t); reject(e); } }
    );
  });
}

/* Sube el paquete mostrando el porcentaje de avance. Se usa XMLHttpRequest
   porque es el unico que informa del progreso de subida. */
function driveSubirConProgreso(url, accessToken, cuerpo, contentType, alAvanzar){
  return new Promise((resolve, reject)=>{
    const xhr=new XMLHttpRequest();
    xhr.open('POST', url, true);
    xhr.setRequestHeader('Authorization', 'Bearer '+accessToken);
    xhr.setRequestHeader('Content-Type', contentType);
    xhr.timeout=PAQUETE_TIMEOUT_SUBIDA;
    if(xhr.upload && typeof alAvanzar==='function'){
      xhr.upload.onprogress=(ev)=>{
        if(ev.lengthComputable && ev.total>0) alAvanzar(Math.round(ev.loaded*100/ev.total));
      };
    }
    xhr.onload=()=>{
      if(xhr.status>=200 && xhr.status<300){ resolve(xhr.responseText); return; }
      let detail='';
      try{ const j=JSON.parse(xhr.responseText); if(j && j.error) detail=j.error.message||j.error.status||''; }catch(e){}
      const e=new Error('DRIVE_HTTP_'+xhr.status); e.httpStatus=xhr.status; e.driveDetail=detail; reject(e);
    };
    xhr.onerror=()=>{ const e=new Error('DRIVE_NETWORK'); e.driveDetail='fallo de red al subir'; reject(e); };
    xhr.ontimeout=()=>{ reject(new Error('SUBIDA_TIMEOUT')); };
    xhr.onabort=()=>{ reject(new Error('SUBIDA_CANCELADA')); };
    xhr.send(cuerpo);
  });
}

// Llamada a Drive con metodo y cuerpo (subir / borrar). driveApiFetch solo
// sirve para lecturas simples, asi que aqui se maneja el resto de verbos.
async function driveApiSend(url, accessToken, metodo, cuerpo, cabeceras){
  const headers=Object.assign({ 'Authorization': 'Bearer ' + accessToken }, cabeceras||{});
  let resp;
  try{
    resp=await fetch(url, { method: metodo, headers, body: cuerpo });
  }catch(netErr){
    const e=new Error('DRIVE_NETWORK');
    e.driveDetail=netErr && netErr.message ? netErr.message : 'fallo de red';
    throw e;
  }
  if(!resp.ok){
    let detail='';
    try{ const j=await resp.json(); if(j && j.error) detail=j.error.message || j.error.status || ''; }catch(e){}
    const e=new Error('DRIVE_HTTP_'+resp.status);
    e.httpStatus=resp.status;
    e.driveDetail=detail;
    throw e;
  }
  return resp;
}

// Lista TODO lo que haya en la carpeta del paquete (sin filtrar por tipo).
async function listarArchivosCarpetaPaquete(accessToken){
  const q = "'" + DRIVE_FOLDER_PAQUETE + "' in parents and trashed=false and mimeType!='application/vnd.google-apps.folder'";
  const url = 'https://www.googleapis.com/drive/v3/files?q=' + encodeURIComponent(q)
    + '&fields=files(id,name,mimeType,modifiedTime,size)'
    + '&orderBy=modifiedTime desc&pageSize=200'
    + '&supportsAllDrives=true&includeItemsFromAllDrives=true';
  const resp=await driveApiFetch(url, accessToken);
  const data=await resp.json();
  return data.files || [];
}

// Verifica que el permiso concedido permita escribir (no solo leer).
async function driveTokenPuedeEscribir(accessToken){
  try{
    const r=await fetch('https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=' + encodeURIComponent(accessToken));
    if(!r.ok) return null; // no se pudo verificar
    const j=await r.json();
    const scopes=String(j.scope||'');
    return /auth\/drive(\s|$)|auth\/drive\.file/.test(scopes);
  }catch(e){ return null; }
}

async function enviarPaqueteACarpetaDrive(){
  const btn=document.getElementById('btnEnviarDrive');
  const etiqueta='Enviar los resultados de los indicadores a la carpeta';
  const paso=(txt)=>{ if(btn) btn.textContent=txt; };
  try{
    /* IMPORTANTE: primero se abre la ventana de Google, ANTES de pedir la
       contrasena y cifrar. Si se hace al final, el navegador ya no ve un clic
       reciente y bloquea la ventana emergente sin avisar: el boton se queda
       "Enviando a la carpeta..." para siempre. */
    if(btn){ btn.disabled=true; }
    paso('Conectando con Google…');
    showToast('Conectando con Google Drive…');
    let token=await conTiempoLimite(authenticateDrive(), PAQUETE_TIMEOUT_OAUTH, 'OAUTH_TIMEOUT');

    // Si el permiso guardado era solo de lectura, se pide de nuevo con consentimiento.
    let puedeEscribir=null;
    try{ puedeEscribir=await conTiempoLimite(driveTokenPuedeEscribir(token), 20000, 'TOKENINFO_TIMEOUT'); }
    catch(e){ puedeEscribir=null; } // si no se pudo verificar, se sigue e intenta subir
    if(puedeEscribir===false){
      showToast('Falta el permiso para guardar en Drive: acepta la casilla en la ventana de Google.');
      token=await conTiempoLimite(authenticateDrive(true), PAQUETE_TIMEOUT_OAUTH, 'OAUTH_TIMEOUT');
      let reintento=null;
      try{ reintento=await conTiempoLimite(driveTokenPuedeEscribir(token), 20000, 'TOKENINFO_TIMEOUT'); }catch(e){ reintento=null; }
      if(reintento===false) throw new Error('NO_SCOPE_ESCRITURA');
    }

    // 1) Revisar la carpeta (si no existe o no hay acceso, se falla ya, antes de cifrar)
    paso('Revisando la carpeta…');
    let previos=[];
    previos=await conTiempoLimite(listarArchivosCarpetaPaquete(token), PAQUETE_TIMEOUT_LISTA, 'LISTA_TIMEOUT');

    // 2) Ahora si: contrasena, compresion y cifrado
    paso('Preparando el paquete…');
    const armado=await paqueteConstruirSobre();
    if(!armado) return;

    // 3) Borrar lo que ya hubiera en la carpeta (no acumulativo)
    paso('Reemplazando el anterior…');
    let borrados=0;
    for(let i=0;i<previos.length;i++){
      try{
        await conTiempoLimite(
          driveApiSend('https://www.googleapis.com/drive/v3/files/'+previos[i].id+'?supportsAllDrives=true', token, 'DELETE'),
          PAQUETE_TIMEOUT_LISTA, 'BORRADO_TIMEOUT');
        borrados++;
      }catch(e){ console.warn('No se pudo borrar '+previos[i].name, e); }
    }

    // 4) Subir el paquete nuevo (multipart: metadatos + contenido en un solo envio)
    const nombre='Paquete_Visor_Medisfarma_'+backupStamp()+'.medisfarma';
    const metadatos={ name: nombre, parents: [DRIVE_FOLDER_PAQUETE], mimeType: PAQUETE_DRIVE_MIME };
    const limite='medisfarma'+Date.now();
    const cuerpo=new Blob([
      '--'+limite+'\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n',
      JSON.stringify(metadatos),
      '\r\n--'+limite+'\r\nContent-Type: '+PAQUETE_DRIVE_MIME+'\r\n\r\n',
      JSON.stringify(armado.sobre),
      '\r\n--'+limite+'--\r\n'
    ], { type: 'multipart/related; boundary='+limite });
    const mb=(cuerpo.size/1048576);
    paso('Subiendo 0%…');
    showToast('Subiendo el paquete a la carpeta de Drive ('+(mb<1?'<1':mb.toFixed(1))+' MB)…');
    await driveSubirConProgreso(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name&supportsAllDrives=true',
      token, cuerpo, 'multipart/related; boundary='+limite,
      (pct)=>{ paso('Subiendo '+pct+'%…'); }
    );

    showToast('Resultados enviados a la carpeta de Drive: '+armado.backup.datasets.length+' fuente(s) · '
      + fmtInt(armado.backup.totalFilas) + ' filas'
      + (borrados ? ' (se reemplazo el paquete anterior)' : '')
      + '. Entrega la contrasena a quienes consultan el visor.');
  }catch(err){
    console.error(err);
    const cod=(err&&err.message)||'';
    if(cod==='NO_SCOPE_ESCRITURA'){
      showToast('Google no concedio el permiso para guardar archivos en Drive. Vuelve a intentarlo y acepta esa casilla.',true);
    }else if(cod==='OAUTH_TIMEOUT'){
      showToast('El navegador no mostro la ventana de Google. Permite las ventanas emergentes de este sitio (icono a la derecha de la barra de direcciones), recarga con Ctrl+F5 y vuelve a pulsar el boton.',true);
    }else if(cod==='LISTA_TIMEOUT'||cod==='BORRADO_TIMEOUT'){
      showToast('Google Drive no respondio al revisar la carpeta de resultados. Revisa la conexion e intenta de nuevo.',true);
    }else if(cod==='SUBIDA_TIMEOUT'){
      showToast('La subida tardo demasiado y se detuvo. Usa una conexion mas estable y vuelve a intentarlo; el paquete es grande.',true);
    }else if(cod==='SUBIDA_CANCELADA'){
      showToast('Se interrumpio la subida del paquete. Vuelve a intentarlo.',true);
    }else{
      showToast('No se pudo enviar el paquete a la carpeta: '+driveErrorMessage(err),true);
    }
  }finally{ if(btn){ btn.disabled=false; btn.textContent=etiqueta; } }
}

function backupSheetName(key, usados){
  let base=String(key).slice(0,28).replace(/[\[\]\*\/\\\?:]/g,'_');
  let name=base, i=2;
  while(usados.indexOf(name)>=0){ name=base.slice(0,26)+'_'+i; i++; }
  usados.push(name);
  return name;
}
async function descargarRespaldoExcel(){
  const btn=document.getElementById('btnBackupExcel');
  const MAX_FILAS=200000;
  try{
    if(btn){ btn.disabled=true; }
    showToast('Armando el archivo de Excel con todos los datos…');
    const all=await idbGetAll();
    const conDatos=all.filter(r=>r && r.rows && r.rows.length);
    if(!conDatos.length){ showToast('No hay datos cargados para exportar.',true); return; }
    const wb=XLSX.utils.book_new();
    const usados=[]; let recortadas=false;
    const resumen=[['Fuente','Clave','Filas','Último archivo','Actualizado']];
    conDatos.forEach(rec=>{
      const def=DATASETS.find(d=>d.key===rec.key)||{};
      resumen.push([def.title||rec.key, rec.key, rec.rows.length, rec.fileName||'', rec.updatedAt||'']);
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Resumen');
    conDatos.forEach(rec=>{
      let filas=rec.rows;
      if(filas.length>MAX_FILAS){ filas=filas.slice(0,MAX_FILAS); recortadas=true; }
      const ws=XLSX.utils.json_to_sheet(filas);
      XLSX.utils.book_append_sheet(wb, ws, backupSheetName(rec.key, usados));
    });
    XLSX.writeFile(wb, 'Datos_Medisfarma_'+backupStamp()+'.xlsx');
    showToast('Excel descargado con '+conDatos.length+' hoja(s) de datos.'+(recortadas?' Algunas hojas se recortaron a '+fmtInt(MAX_FILAS)+' filas por límite de Excel; usa la copia .json para el respaldo completo.':''));
  }catch(err){
    console.error(err);
    showToast('No se pudo generar el Excel: '+err.message,true);
  }finally{ if(btn){ btn.disabled=false; } }
}

async function restaurarRespaldo(file){
  if(!file) return;
  try{
    showToast('Leyendo la copia de seguridad…');
    const texto=await file.text();
    let backup;
    try{ backup=JSON.parse(texto); }
    catch(e){ showToast('El archivo no es una copia de seguridad válida (JSON dañado).',true); return; }
    if(!backup || backup.app!==BACKUP_APP_ID || !Array.isArray(backup.datasets)){
      showToast('Ese archivo no es una copia de seguridad de este tablero.',true); return;
    }
    const validos=backup.datasets.filter(d=>d && d.key && Array.isArray(d.rows) && DATASETS.some(x=>x.key===d.key));
    if(!validos.length){ showToast('La copia no contiene fuentes reconocibles.',true); return; }
    const detalle=validos.map(d=>'· '+((DATASETS.find(x=>x.key===d.key)||{}).title||d.key)+': '+fmtInt(d.rows.length)+' filas').join('\n');
    const fecha=backup.generadoEn?new Date(backup.generadoEn).toLocaleString('es-CO'):'sin fecha';
    if(!confirm('Restaurar la copia del '+fecha+'?\n\n'+detalle+'\n\nEsto REEMPLAZA los datos actuales de esas fuentes.')) return;
    let ok=0;
    for(let i=0;i<validos.length;i++){
      const d=validos[i];
      showToast('Restaurando '+((DATASETS.find(x=>x.key===d.key)||{}).title||d.key)+'… ('+(i+1)+'/'+validos.length+')');
      await idbPut({key:d.key, rows:backupDecodeRows(d.rows), fileName:d.fileName||'', batches:d.batches||null, updatedAt:d.updatedAt||new Date().toISOString()});
      ok++;
    }
    if(backup.driveFiles){
      try{
        if(backup.driveFiles.inventario) localStorage.setItem('inventario_drive_files', JSON.stringify(backup.driveFiles.inventario));
        if(backup.driveFiles.reporte) localStorage.setItem('reporte_drive_files', JSON.stringify(backup.driveFiles.reporte));
      }catch(e){ /* cuota: no es crítico */ }
    }
    state.processed=null;
    await refreshStatusFromDB();
    showEmptyResults();
    showToast('Copia restaurada: '+ok+' fuente(s). Pulsa "Calcular indicadores" para ver los resultados.');
  }catch(err){
    console.error(err);
    showToast('No se pudo restaurar la copia: '+err.message,true);
  }
}

document.getElementById('btnPublicar').addEventListener('click', publicarPaqueteVisor);
(function(){
  const b=document.getElementById('btnEnviarDrive');
  if(b) b.addEventListener('click', enviarPaqueteACarpetaDrive);
})();
document.getElementById('btnBackup').addEventListener('click', descargarRespaldoJSON);
document.getElementById('btnBackupExcel').addEventListener('click', descargarRespaldoExcel);
document.getElementById('btnRestaurar').addEventListener('click', ()=>{
  const inp=document.getElementById('inputRestaurar');
  inp.value=''; inp.click();
});
document.getElementById('inputRestaurar').addEventListener('change', e=>{
  const f=e.target.files[0];
  if(f) restaurarRespaldo(f);
});

document.getElementById('btnLimpiarTodo').addEventListener('click', async ()=>{
  if(!confirm('¿Borrar todos los datos cargados (nube y datos de Drive guardados en este navegador)?\n\nRecomendación: descarga primero la copia de seguridad, así podrás restaurarlos después.')) return;
  await idbClearAll(); state.processed=null;
  showToast('Se borraron todos los datos cargados.');
  refreshStatusFromDB(); showEmptyResults();
});

/* ---- logo corporativo fijo (embebido en el archivo, no editable) ---- */


/* =========================================================================
   7. Utilidades del panel (enlace a resultados, sesión, arranque)
   ========================================================================= */

function pintarCabeceraSesion(sesion){
  const el = document.getElementById('userChip');
  if(el) el.textContent = sesion.nombre + ' · ' + sesion.user;
}

function pintarEnlaceResultados(){
  const a = document.getElementById('linkResultados');
  if(!a) return;
  const url = getResultsUrl();
  if(url){
    a.href = url;
    a.style.display = 'inline-flex';
  }else{
    a.removeAttribute('href');
    a.style.display = 'none';
  }
}

function configurarUrlResultados(){
  const actual = getResultsUrl();
  const val = prompt('Dirección web de la app "Resultados de los Indicadores"\n\nEjemplo: https://mi-usuario.github.io/Resultados-de-los-Indicadores/', actual || '');
  if(val === null) return;
  const limpio = String(val).trim();
  if(limpio && !/^https?:\/\//i.test(limpio)){
    showToast('La dirección debe empezar por http:// o https://', true);
    return;
  }
  setResultsUrl(limpio);
  pintarEnlaceResultados();
  showToast(limpio ? 'Enlace a resultados guardado en este navegador.' : 'Enlace a resultados eliminado.');
}

/* En este panel no se calcula nada: el botón principal lleva a la app de
   resultados. Esta versión reemplaza a la del núcleo compartido (misma firma,
   solo cambia el texto que ve el usuario).                                  */
function updateCalcButton(){
  const missing = DATASETS.filter(d=>d.required && !state.loaded[d.key]);
  const btn  = document.getElementById('btnCalcular');
  const note = document.getElementById('calcNote');
  if(!btn || !note) return;
  btn.disabled = missing.length > 0;
  note.textContent = missing.length
    ? ('Falta cargar: ' + missing.map(d=>d.title).join(', ') + '.')
    : 'Fuentes obligatorias completas. Los datos ya están disponibles para la app de resultados.';
}

function irAResultados(){
  const url = getResultsUrl();
  if(!url){
    showToast('Primero configura la dirección de la app de resultados.', true);
    configurarUrlResultados();
    return;
  }
  window.open(url, '_blank', 'noopener');
}

/* =========================================================================
   8. Init
   ========================================================================= */
async function abrirPanel(sesion){
  sesionActual = sesion;
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = '';
  pintarCabeceraSesion(sesion);
  aplicarPermisos(sesion.rol);
  pintarEnlaceResultados();

  restoreDriveFileLists();
  renderUploadCards();
  await refreshStatusFromDB();
  // Inventario y Reporte se leen del almacen local del navegador (datos de Drive)
  await loadDriveOnlyFromLocal();
  renderUploadCards(); updateTopStatus(); updateCalcButton();
  startFirestoreListener();
}

(function arranque(){
  document.getElementById('loginBtn').addEventListener('click', intentarLogin);
  document.getElementById('loginForm').addEventListener('submit', e=>{ e.preventDefault(); intentarLogin(); });
  document.getElementById('btnSalir').addEventListener('click', cerrarSesion);
  document.getElementById('btnUrlResultados').addEventListener('click', configurarUrlResultados);
  document.getElementById('btnCalcular').addEventListener('click', irAResultados);
  const ver = document.getElementById('loginVer');
  if(ver) ver.addEventListener('click', ()=>{
    const inp = document.getElementById('loginPass');
    const visible = inp.type === 'text';
    inp.type = visible ? 'password' : 'text';
    ver.textContent = visible ? 'Ver' : 'Ocultar';
    ver.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
  });

  const s = leerSesionGuardada();
  if(s){ abrirPanel(s); }
  else{ document.getElementById('loginUser').focus(); }
})();
