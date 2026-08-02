// Cálculo de cuotas e intereses para un préstamo.
//
// tasa_interes: se interpreta como porcentaje POR CUOTA/PERIODO (no anual).
//   Ej: préstamo semanal con tasa 5 => 5% de interés por cada semana.
//
// tipo_interes:
//   - "fijo":  interés simple sobre el monto original, repartido en cuotas iguales.
//              total_pagar = monto + (monto * tasa/100 * num_cuotas)
//   - "saldo": cuota fija calculada por amortización sobre saldo (como un
//              crédito bancario clásico): cada cuota paga interés sobre lo
//              que falta por pagar, no sobre el monto original completo.
//   - "capitalizado": igual a "saldo" al generar el préstamo, pero si una
//              cuota se paga atrasada, el interés de los días de mora se
//              suma (capitaliza) al saldo pendiente y las cuotas futuras
//              se recalculan (ver utils/interest.js -> recalcularPorMora).

const DIAS_POR_FRECUENCIA = {
  diario: 1,
  semanal: 7,
  quincenal: 15,
  mensual: 30,
};

function sumarDias(fechaISO, dias) {
  const f = new Date(fechaISO + "T00:00:00");
  f.setDate(f.getDate() + dias);
  return f.toISOString().slice(0, 10);
}

function calcularValorCuota({ monto, tasa, tipo, num_cuotas }) {
  const i = tasa / 100;
  if (tipo === "saldo" || tipo === "capitalizado") {
    if (i === 0) return monto / num_cuotas;
    const cuota = (monto * i) / (1 - Math.pow(1 + i, -num_cuotas));
    return cuota;
  }
  // fijo
  const interesTotal = monto * i * num_cuotas;
  return (monto + interesTotal) / num_cuotas;
}

function generarCuotas({ monto, tasa, tipo, frecuencia, num_cuotas, fecha_inicio }) {
  const diasPeriodo = DIAS_POR_FRECUENCIA[frecuencia] || 1;
  const valorCuota = Math.round(calcularValorCuota({ monto, tasa, tipo, num_cuotas }) * 100) / 100;

  const cuotas = [];
  let fecha = fecha_inicio;
  for (let n = 1; n <= num_cuotas; n++) {
    fecha = sumarDias(fecha, diasPeriodo);
    cuotas.push({
      numero: n,
      fecha_vencimiento: fecha,
      valor: valorCuota,
    });
  }
  // Ajuste de redondeo: la última cuota absorbe la diferencia de centavos
  const totalCalculado = valorCuota * num_cuotas;
  const totalDeseado = Math.round(valorCuota * num_cuotas * 100) / 100;
  if (cuotas.length) {
    const diff = Math.round((totalDeseado - totalCalculado) * 100) / 100;
    cuotas[cuotas.length - 1].valor = Math.round((cuotas[cuotas.length - 1].valor + diff) * 100) / 100;
  }

  const total_pagar = Math.round(cuotas.reduce((s, c) => s + c.valor, 0) * 100) / 100;

  return { valor_cuota: valorCuota, total_pagar, cuotas };
}

module.exports = { generarCuotas, DIAS_POR_FRECUENCIA, sumarDias };
