import { useEffect, useState } from 'react';
import { getOcupadoGoogle } from '../lib/functions';

/**
 * Lo ocupado en el Google Calendar de esos profesionales ese día, para el
 * panel (agenda del día, turno nuevo): `{ ocupados: { [professionalId]: [{ startTime, endTime }] },
 * bloquea: { [professionalId]: boolean } }` — `bloquea` es la preferencia de
 * cada profesional (sus actividades bloquean turnos, o solo se muestran).
 * Mientras carga, o si falla, viene vacío: el panel se ve igual que sin
 * Google, nada se traba.
 *
 * La respuesta se guarda con la clave que la pidió (mismo patrón que los
 * horarios ocupados de BookingPage): si cambia el día o los profesionales,
 * deja de valer sola, sin un setState sincrónico en el efecto.
 */
export function useOcupadoGoogle(businessId, professionalIds, fecha) {
  const ids = (professionalIds || []).filter(Boolean);
  const clave = `${businessId}|${ids.join(',')}|${fecha}`;
  const [resultado, setResultado] = useState({ clave: '', ocupados: {}, bloquea: {} });

  useEffect(() => {
    if (!businessId || ids.length === 0 || !fecha) return;
    let vigente = true;
    getOcupadoGoogle({ businessId, professionalIds: ids, fecha })
      .then(({ ocupados, bloquea }) => { if (vigente) setResultado({ clave, ocupados: ocupados || {}, bloquea: bloquea || {} }); })
      .catch((err) => {
        console.error('[useOcupadoGoogle] No se pudo leer Google Calendar:', err);
        if (vigente) setResultado({ clave, ocupados: {}, bloquea: {} });
      });
    return () => { vigente = false; };
    // `clave` resume businessId, ids y fecha.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  return resultado.clave === clave ? resultado : SIN_DATOS;
}

const SIN_DATOS = { ocupados: {}, bloquea: {} };

/** ¿[inicio, fin) ('HH:MM') choca con algo de la lista? */
export function chocaCon(ocupados, inicio, fin) {
  return (ocupados || []).some((o) => inicio < o.endTime && (fin || inicio) > o.startTime);
}
