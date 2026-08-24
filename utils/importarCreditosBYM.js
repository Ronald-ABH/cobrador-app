// Importador puntual desde la app "créditos b y m" (la que usaba el papá
// de Ronald antes). Esa app no maneja préstamos con cuotas como Cobrador
// App: lleva un balance corriente por cliente, con movimientos "D"
// (débito: se presta plata, sube la deuda) y "P" (pago: baja la deuda).
// Aquí solo se trae el SALDO PENDIENTE ACTUAL de cada cliente (no los 5
// años de historial), reconstruido como un préstamo nuevo de Cobrador App
// que arranca hoy — la frecuencia y el valor de cuota se infieren de cómo
// pagaba ese cliente en la app vieja, para que el calendario de cobro
// quede parecido a como ya estaba acostumbrado.
const { db } = require("../db");
const { generarCuotas, DIAS_POR_FRECUENCIA, sumarDias } = require("./interest");
const { hoyISO } = require("./fecha");

// Valida que un texto tenga forma de fecha YYYY-MM-DD (la app vieja siempre
// exporta las fechas así, pero si el campo viene vacío o corrupto es mejor
// ignorarlo que reventar el import).
function esFechaValida(v) {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// El mismo cliente real puede tener varios saldos separados en el archivo
// viejo (el papá de Ronald a veces creaba un "cliente" nuevo por cada
// préstamo en vez de reusar el mismo, incluso para la misma persona). Por
// eso el cliente se fusiona por nombre+teléfono, pero cada préstamo se
// marca con el _id original de esa fila del archivo — así, si el import se
// corre dos veces, no se duplica ESE préstamo puntual, pero sí se permite
// que un mismo cliente termine con varios préstamos si de verdad tenía
// varios saldos por separado.
const MARCA_IMPORT_PREFIJO = "[IMPORT-CREDITOSBYM:id=";
const MAX_CUOTAS = 200;

// --- Parser de CSV muy simple: cada línea es un registro, separado por
// comas, con campos entre comillas dobles (y "" como comilla escapada
// dentro de un campo). El archivo de esta app no trae saltos de línea
// dentro de un campo, así que basta con procesar línea por línea.
function parsearLineaCSV(linea) {
  const campos = [];
  let actual = "";
  let entreComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const ch = linea[i];
    if (entreComillas) {
      if (ch === '"') {
        if (linea[i + 1] === '"') {
          actual += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        actual += ch;
      }
    } else if (ch === '"') {
      entreComillas = true;
    } else if (ch === ",") {
      campos.push(actual);
      actual = "";
    } else {
      actual += ch;
    }
  }
  campos.push(actual);
  return campos;
}

function mediana(numeros) {
  if (!numeros.length) return 0;
  const s = [...numeros].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function diasEntreFechas(fechaA, fechaB) {
  const a = new Date(fechaA + "T00:00:00Z");
  const b = new Date(fechaB + "T00:00:00Z");
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function inferirFrecuencia(gapsDias) {
  if (!gapsDias.length) return "diario";
  const g = mediana(gapsDias);
  if (g <= 2) return "diario";
  if (g <= 10) return "semanal";
  if (g <= 22) return "quincenal";
  return "mensual";
}

function normalizarTexto(v) {
  return (v || "").toString().trim().replace(/\s+/g, " ");
}

function parsearCSV(contenido) {
  const lineas = contenido.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const headers = {};
  const clientesRaw = [];
  const transaccionesRaw = [];

  for (const linea of lineas) {
    const campos = parsearLineaCSV(linea);
    const tag = campos[0];
    if (tag === "{Customer:Header}") {
      headers.customer = campos.slice(1);
    } else if (tag === "{Transaction:Header}") {
      headers.transaction = campos.slice(1);
    } else if (tag === "{Customer}") {
      clientesRaw.push(campos.slice(1));
    } else if (tag === "{Transactions}") {
      transaccionesRaw.push(campos.slice(1));
    }
  }

  if (!headers.customer || !headers.transaction) {
    throw new Error(
      "El archivo no tiene el formato esperado (faltan las cabeceras {Customer:Header} o {Transaction:Header})"
    );
  }

  const clientes = clientesRaw.map((fila) => {
    const obj = {};
    headers.customer.forEach((campo, i) => (obj[campo] = fila[i]));
    return obj;
  });
  const transacciones = transaccionesRaw.map((fila) => {
    const obj = {};
    headers.transaction.forEach((campo, i) => (obj[campo] = fila[i]));
    return obj;
  });

  return { clientes, transacciones };
}

function importarCSV(contenido) {
  const { clientes, transacciones } = parsearCSV(contenido);

  // Agrupar transacciones por cliente y ordenarlas cronológicamente
  const txPorCliente = new Map();
  for (const t of transacciones) {
    if (t.is_deleted === "1") continue;
    if (!txPorCliente.has(t.customer_id)) txPorCliente.set(t.customer_id, []);
    txPorCliente.get(t.customer_id).push(t);
  }
  for (const lista of txPorCliente.values()) {
    lista.sort((a, b) => {
      if (a.transaction_date !== b.transaction_date) {
        return a.transaction_date < b.transaction_date ? -1 : 1;
      }
      return (a.creation_date || "") < (b.creation_date || "") ? -1 : 1;
    });
  }

  const resumen = {
    clientesEnArchivo: clientes.length,
    clientesCreados: 0,
    clientesYaExistian: 0,
    prestamosCreados: 0,
    prestamosOmitidosYaImportados: 0,
    clientesConSaldoPendiente: 0,
    clientesSinSaldoPendiente: 0,
    carteraTotalImportada: 0,
    advertencias: [],
  };

  const buscarClienteExistente = db.prepare(
    `SELECT id FROM clientes WHERE lower(trim(nombre)) = lower(trim(?)) AND (telefono = ? OR (telefono IS NULL AND (? IS NULL OR ? = '')))`
  );
  const insertarCliente = db.prepare(
    `INSERT INTO clientes (nombre, telefono, direccion, referencia, notas) VALUES (?, ?, ?, ?, ?)`
  );
  const buscarPrestamoImportado = db.prepare(
    `SELECT id FROM prestamos WHERE cliente_id = ? AND notas LIKE '%' || ? || '%'`
  );
  const insertarPrestamo = db.prepare(
    `INSERT INTO prestamos
      (cliente_id, monto, tasa_interes, tipo_interes, frecuencia, num_cuotas, fecha_inicio, valor_cuota, total_pagar, notas)
     VALUES (?, ?, 0, 'fijo', ?, ?, ?, ?, ?, ?)`
  );
  const insertarCuota = db.prepare(
    `INSERT INTO cuotas (prestamo_id, numero, fecha_vencimiento, valor) VALUES (?, ?, ?, ?)`
  );

  const tx = db.transaction(() => {
    for (const c of clientes) {
      const nombre = normalizarTexto(c.name);
      if (!nombre) {
        resumen.advertencias.push(`Se omitió un cliente sin nombre (id original ${c._id}).`);
        continue;
      }
      const telefono = normalizarTexto(c.mobile) || null;
      const direccion = normalizarTexto(c.address) || null;
      const referencia = normalizarTexto(c.reference) || null;

      let clienteId;
      const existente = buscarClienteExistente.get(nombre, telefono, telefono, telefono);
      if (existente) {
        clienteId = existente.id;
        resumen.clientesYaExistian++;
      } else {
        const info = insertarCliente.run(
          nombre,
          telefono,
          direccion,
          referencia,
          "Importado desde app anterior (créditos b y m)."
        );
        clienteId = info.lastInsertRowid;
        resumen.clientesCreados++;
      }

      const lista = txPorCliente.get(c._id) || [];
      const ultima = lista[lista.length - 1];
      const saldoActual = ultima ? Math.round(Number(ultima.end_balance) || 0) : 0;

      if (saldoActual <= 0.01) {
        resumen.clientesSinSaldoPendiente++;
        continue;
      }
      resumen.clientesConSaldoPendiente++;

      const marcaEsteRegistro = `${MARCA_IMPORT_PREFIJO}${c._id}]`;
      const yaImportado = buscarPrestamoImportado.get(clienteId, marcaEsteRegistro);
      if (yaImportado) {
        resumen.prestamosOmitidosYaImportados++;
        continue;
      }

      const pagos = lista.filter((t) => t.transaction_type === "P").map((t) => Math.abs(Number(t.amount) || 0));
      const fechasPago = lista.filter((t) => t.transaction_type === "P").map((t) => t.transaction_date);
      const gaps = [];
      for (let i = 1; i < fechasPago.length; i++) {
        gaps.push(diasEntreFechas(fechasPago[i - 1], fechasPago[i]));
      }

      const cuotaTipica = pagos.length ? mediana(pagos) : saldoActual;
      const frecuencia = inferirFrecuencia(gaps);
      let numCuotas = cuotaTipica > 0 ? Math.round(saldoActual / cuotaTipica) : 1;
      if (!Number.isFinite(numCuotas) || numCuotas < 1) numCuotas = 1;
      if (numCuotas > MAX_CUOTAS) {
        resumen.advertencias.push(
          `${nombre}: se limitó a ${MAX_CUOTAS} cuotas (el cálculo automático daba ${numCuotas}) — revisar manualmente.`
        );
        numCuotas = MAX_CUOTAS;
      }

      // La app anterior sí llevaba la próxima fecha de pago esperada de cada
      // cliente (scheduled_date, o rescheduled_date si el cobrador la
      // reprogramó manualmente). generarCuotas() siempre pone la cuota #1 un
      // período completo DESPUÉS de fecha_inicio — nunca en fecha_inicio
      // mismo — así que para que la cuota #1 quede exactamente en esa fecha
      // real (y no siempre "un período desde hoy", que dejaba a todo el
      // mundo fuera de la Agenda el día del import) hay que "retroceder" el
      // fecha_inicio un período completo.
      const diasPeriodo = DIAS_POR_FRECUENCIA[frecuencia] || 1;
      const fechaObjetivo = esFechaValida(c.rescheduled_date)
        ? c.rescheduled_date
        : esFechaValida(c.scheduled_date)
        ? c.scheduled_date
        : null;
      const fechaInicio = fechaObjetivo ? sumarDias(fechaObjetivo, -diasPeriodo) : hoyISO();

      const { valor_cuota, total_pagar, cuotas } = generarCuotas({
        monto: saldoActual,
        tasa: 0,
        tipo: "fijo",
        frecuencia,
        num_cuotas: numCuotas,
        fecha_inicio: fechaInicio,
      });

      const notasPrestamo = fechaObjetivo
        ? `${marcaEsteRegistro} Saldo pendiente importado de la app anterior el ${hoyISO()}, con próximo pago esperado el ${fechaObjetivo} (según la app anterior). Cuota histórica típica: $${Math.round(
            cuotaTipica
          )} cada ~${frecuencia}.`
        : `${marcaEsteRegistro} Saldo pendiente importado de la app anterior el ${hoyISO()}. Cuota histórica típica: $${Math.round(
            cuotaTipica
          )} cada ~${frecuencia}.`;

      const infoPrestamo = insertarPrestamo.run(
        clienteId,
        saldoActual,
        frecuencia,
        numCuotas,
        fechaInicio,
        valor_cuota,
        total_pagar,
        notasPrestamo
      );
      const prestamoId = infoPrestamo.lastInsertRowid;
      for (const cu of cuotas) {
        insertarCuota.run(prestamoId, cu.numero, cu.fecha_vencimiento, cu.valor);
      }

      resumen.prestamosCreados++;
      resumen.carteraTotalImportada += saldoActual;
    }
  });

  tx();

  return resumen;
}

// --- Corrección puntual de los préstamos que ya se importaron ANTES de que
// este archivo usara scheduled_date/rescheduled_date (esos quedaron con la
// cuota #1 fechada "un período desde el día del import", en vez de la fecha
// real que traía la app anterior). Se sube otra vez el mismo CSV y, para
// cada préstamo que tenga la marca de import de ese cliente, se recalculan
// las fechas de sus cuotas. Por seguridad, si un préstamo ya tiene algún
// pago registrado (porque ya se cobró algo desde que se importó), NO se le
// tocan las cuotas — se reporta como advertencia para revisar a mano.
function corregirFechasImportacion(contenido) {
  const { clientes } = parsearCSV(contenido);

  const resumen = {
    clientesEnArchivo: clientes.length,
    prestamosRevisados: 0,
    prestamosCorregidos: 0,
    prestamosSinCambios: 0,
    prestamosOmitidosPorTenerPagos: 0,
    clientesSinFechaEnArchivo: 0,
    advertencias: [],
  };

  const buscarPrestamoImportado = db.prepare(
    `SELECT p.id, p.cliente_id, p.monto, p.tasa_interes, p.tipo_interes, p.frecuencia, p.num_cuotas, p.fecha_inicio, c.nombre AS cliente_nombre
     FROM prestamos p JOIN clientes c ON c.id = p.cliente_id
     WHERE p.notas LIKE '%' || ? || '%'`
  );
  const contarPagos = db.prepare(`SELECT COUNT(*) AS n FROM pagos WHERE prestamo_id = ?`);
  const borrarCuotas = db.prepare(`DELETE FROM cuotas WHERE prestamo_id = ?`);
  const insertarCuota = db.prepare(
    `INSERT INTO cuotas (prestamo_id, numero, fecha_vencimiento, valor) VALUES (?, ?, ?, ?)`
  );
  const actualizarPrestamo = db.prepare(`UPDATE prestamos SET fecha_inicio = ? WHERE id = ?`);

  const tx = db.transaction(() => {
    for (const c of clientes) {
      const fechaObjetivo = esFechaValida(c.rescheduled_date)
        ? c.rescheduled_date
        : esFechaValida(c.scheduled_date)
        ? c.scheduled_date
        : null;
      if (!fechaObjetivo) {
        resumen.clientesSinFechaEnArchivo++;
        continue;
      }

      const marca = `${MARCA_IMPORT_PREFIJO}${c._id}]`;
      const prestamo = buscarPrestamoImportado.get(marca);
      if (!prestamo) continue; // este cliente no tenía saldo pendiente al importar, no hay nada que corregir

      resumen.prestamosRevisados++;

      const pagos = contarPagos.get(prestamo.id).n;
      if (pagos > 0) {
        resumen.prestamosOmitidosPorTenerPagos++;
        resumen.advertencias.push(
          `${prestamo.cliente_nombre}: ya tiene pagos registrados desde el import — no se le tocaron las fechas, revisar a mano si hace falta.`
        );
        continue;
      }

      const diasPeriodo = DIAS_POR_FRECUENCIA[prestamo.frecuencia] || 1;
      const nuevaFechaInicio = sumarDias(fechaObjetivo, -diasPeriodo);

      if (nuevaFechaInicio === prestamo.fecha_inicio) {
        resumen.prestamosSinCambios++;
        continue;
      }

      const { cuotas } = generarCuotas({
        monto: prestamo.monto,
        tasa: prestamo.tasa_interes,
        tipo: prestamo.tipo_interes,
        frecuencia: prestamo.frecuencia,
        num_cuotas: prestamo.num_cuotas,
        fecha_inicio: nuevaFechaInicio,
      });

      borrarCuotas.run(prestamo.id);
      for (const cu of cuotas) {
        insertarCuota.run(prestamo.id, cu.numero, cu.fecha_vencimiento, cu.valor);
      }
      actualizarPrestamo.run(nuevaFechaInicio, prestamo.id);
      resumen.prestamosCorregidos++;
    }
  });

  tx();

  return resumen;
}

module.exports = { importarCSV, corregirFechasImportacion };
