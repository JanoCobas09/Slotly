-- ============================================================================
-- Quién elige al profesional en la reserva
-- ============================================================================
-- Pedido del usuario: que el cliente pueda elegir "cualquier profesional", o
-- que el negocio ofrezca solo el servicio y el profesional se asigne solo.
--   'elige'              → el cliente lo elige (lo de siempre, por defecto)
--   'elige_o_cualquiera' → además puede tocar "Cualquier profesional"
--   'automatico'         → no ve el paso del profesional
-- Cuando no elige el cliente, la reserva asigna entre los libres en ese
-- horario el que tiene menos turnos ese día (src/utils/asignacionProfesional.js)
-- y manda a create_appointment un profesional concreto: el servidor lo valida
-- como cualquier otro turno, no hace falta tocarlo.
--
-- Ningún negocio existente cambia hasta que lo configure en Configuración.
alter table businesses
  add column if not exists modo_profesional text not null default 'elige'
    check (modo_profesional in ('elige', 'elige_o_cualquiera', 'automatico'));
